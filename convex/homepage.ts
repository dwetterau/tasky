import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  httpAction,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent } from "./auth";
import { decryptApiKey } from "./apiKeys";
import {
  exportSchema,
  identitySchema,
  timezoneSchema,
  LIMITS,
} from "../packages/home-feed/src/index";
import { projectHomepage } from "./lib/homepageProjection";
import { collectHomepagePortfolio } from "./lib/homepagePortfolio";
import { syncPriceHistoryForUser } from "./portfolio";
import {
  homepageHeaders,
  verifyHomepageRequest,
} from "./lib/homepageTransport";

/**
 * Crash-recovery window for a homepage price sync. Keep this comfortably
 * longer than the action runtime so scheduler delay cannot permit overlap.
 * A finished run releases the lease immediately.
 */
const PRICE_SYNC_LEASE_MS = 30 * 60_000;

function interval() {
  return Math.max(
    60_000,
    Math.min(
      3600_000,
      Number(process.env.HOMEPAGE_EXPORT_INTERVAL_MS) || 600_000,
    ),
  );
}

export const enroll = internalMutation({
  args: { userId: v.string(), timezone: v.string() },
  handler: async (ctx, args) => {
    identitySchema.parse(args.userId);
    timezoneSchema.parse(args.timezone);
    const user = await authComponent.getAnyUserById(ctx, args.userId);
    if (!user) throw new Error("Unknown homepage user");
    const ids = (process.env.HOMEPAGE_ALLOWED_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim());
    const emails = (process.env.HOMEPAGE_ALLOWED_EMAILS ?? "")
      .toLowerCase()
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (
      !ids.includes(args.userId) &&
      !(user.emailVerified && emails.includes(user.email.toLowerCase()))
    )
      throw new Error("Homepage enrollment is not allowed");
    const existing = await ctx.db
      .query("homepageEnrollments")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing) return { enrolled: true };
    const id = await ctx.db.insert("homepageEnrollments", {
      ...args,
      enabled: true,
      revision: 0,
      attempt: 0,
      nextRunAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.homepage.prepare, { id });
    return { enrolled: true };
  },
});

export const prepare = internalAction({
  args: { id: v.id("homepageEnrollments") },
  handler: async (ctx, { id }) => {
    const row = await ctx.runQuery(internal.homepage.pending, { id });
    if (!row?.enabled || row.nextRunAt > Date.now()) return;
    const portfolioSnapshot = row.pendingBody
      ? undefined
      : JSON.stringify(
          await collectHomepagePortfolio(
            ctx,
            row.userId,
            row.portfolioSnapshot,
          ),
        );
    await ctx.runMutation(internal.homepage.freeze, { id, portfolioSnapshot });
  },
});

export const requestExport = internalMutation({
  args: { userId: v.string() },
  returns: v.object({
    scheduled: v.boolean(),
    queued: v.boolean(),
  }),
  handler: async (ctx, { userId }) => {
    const row = await ctx.db
      .query("homepageEnrollments")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!row?.enabled) throw new Error("Not enrolled");
    if (row.pendingBody) {
      // Never replace an in-flight outbox payload. Queue a fresh snapshot for
      // immediately after that exact payload is acknowledged.
      await ctx.db.patch(row._id, { exportRequested: true });
      return { scheduled: false, queued: true };
    }
    await ctx.db.patch(row._id, {
      nextRunAt: Date.now(),
      exportRequested: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.homepage.prepare, { id: row._id });
    return { scheduled: true, queued: false };
  },
});

export const freeze = internalMutation({
  args: {
    id: v.id("homepageEnrollments"),
    portfolioSnapshot: v.optional(v.string()),
  },
  handler: async (ctx, { id, portfolioSnapshot }) => {
    const row = await ctx.db.get(id);
    if (!row?.enabled || row.nextRunAt > Date.now()) return;
    if (!row.pendingBody) {
      const now = Date.now();
      const payload = await projectHomepage(ctx, row.userId, row.timezone, now);
      const sourceRevision = row.revision + 1;
      const exportId = `${row.userId}-${sourceRevision}`;
      const envelope = exportSchema.parse({
        schemaVersion: 1,
        userId: row.userId,
        timezone: row.timezone,
        exportId,
        sourceRevision,
        exportedAt: now,
        payload,
        ...(portfolioSnapshot
          ? { portfolio: JSON.parse(portfolioSnapshot) }
          : {}),
      });
      const body = JSON.stringify(envelope);
      if (new TextEncoder().encode(body).length > LIMITS.bytes)
        throw new Error("Homepage export exceeds limit");
      await ctx.db.patch(id, {
        pendingBody: body,
        pendingExportId: exportId,
        revision: sourceRevision,
        attempt: 0,
        ...(portfolioSnapshot ? { portfolioSnapshot } : {}),
      });
    }
    // A lease prevents the cron from double-dispatching while an action is running.
    await ctx.db.patch(id, { nextRunAt: Date.now() + 5 * 60_000 });
    await ctx.scheduler.runAfter(0, internal.homepage.deliver, { id });
  },
});
export const dispatch = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("homepageEnrollments")
      .withIndex("by_enabled_next_run", (q) =>
        q.eq("enabled", true).lte("nextRunAt", Date.now()),
      )
      .take(25);
    for (const row of rows)
      await ctx.scheduler.runAfter(0, internal.homepage.prepare, {
        id: row._id,
      });
  },
});
export const pending = internalQuery({
  args: { id: v.id("homepageEnrollments") },
  handler: (ctx, { id }) => ctx.db.get(id),
});
export const deliveryResult = internalMutation({
  args: {
    id: v.id("homepageEnrollments"),
    exportId: v.string(),
    ok: v.boolean(),
    permanent: v.boolean(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.pendingExportId !== args.exportId) return;
    const attempt = row.attempt + 1;
    const runQueuedExport = args.ok && row.exportRequested === true;
    const delay = args.ok
      ? runQueuedExport
        ? 0
        : interval()
      : args.permanent
        ? 3600_000
        : Math.min(900_000, 10_000 * 2 ** Math.min(attempt, 7));
    await ctx.db.patch(row._id, {
      nextRunAt: Date.now() + delay,
      attempt: args.ok ? 0 : attempt,
      lastError: args.ok
        ? undefined
        : args.permanent
          ? "configuration"
          : "delivery_failed",
      ...(args.ok
        ? {
            pendingBody: undefined,
            pendingExportId: undefined,
            lastSuccessAt: Date.now(),
            ...(runQueuedExport ? { exportRequested: undefined } : {}),
          }
        : {}),
    });
    await ctx.scheduler.runAfter(delay, internal.homepage.prepare, {
      id: row._id,
    });
  },
});
export const deliver = internalAction({
  args: { id: v.id("homepageEnrollments") },
  handler: async (ctx, { id }) => {
    const row = await ctx.runQuery(internal.homepage.pending, { id });
    if (!row?.enabled || !row.pendingBody || !row.pendingExportId) return;
    let ok = false;
    let permanent = false;
    try {
      const home = new URL(process.env.HOMEPAGE_ORIGIN!);
      if (
        home.protocol !== "https:" ||
        home.origin !== process.env.HOMEPAGE_ORIGIN
      )
        throw new Error("Invalid homepage origin");
      const path = "/internal/tasky";
      const response = await fetch(`${home.origin}${path}`, {
        method: "POST",
        redirect: "error",
        headers: await homepageHeaders(
          process.env.HOMEPAGE_INGESTION_SECRET!,
          path,
          row.pendingBody,
        ),
        body: row.pendingBody,
        signal: AbortSignal.timeout(20_000),
      });
      ok = response.ok;
      permanent =
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429;
      await response.body?.cancel();
    } catch {
      /* Record a coarse code only; never log source data or credentials. */
    }
    await ctx.runMutation(internal.homepage.deliveryResult, {
      id,
      exportId: row.pendingExportId,
      ok,
      permanent,
    });
  },
});

export const weatherKey = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const enrollment = await ctx.db
      .query("homepageEnrollments")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (!enrollment?.enabled) throw new Error("Not enrolled");
    return ctx.db
      .query("apiKeys")
      .withIndex("by_user_type", (q) =>
        q.eq("userId", args.userId).eq("type", "accuweather"),
      )
      .order("desc")
      .first();
  },
});

async function enrolledHomepageUser(
  ctx: QueryCtx | MutationCtx,
  userId: string,
) {
  identitySchema.parse(userId);
  return await ctx.db
    .query("homepageEnrollments")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

export const beginPriceSync = internalMutation({
  args: { userId: v.string() },
  returns: v.object({ started: v.boolean() }),
  handler: async (ctx, { userId }) => {
    const row = await enrolledHomepageUser(ctx, userId);
    if (!row?.enabled) throw new Error("Not enrolled");
    const now = Date.now();
    if (
      row.priceSyncStartedAt !== undefined &&
      now - row.priceSyncStartedAt < PRICE_SYNC_LEASE_MS
    ) {
      return { started: false };
    }
    await ctx.db.patch(row._id, { priceSyncStartedAt: now });
    await ctx.scheduler.runAfter(0, internal.homepage.runPriceSync, {
      userId,
      startedAt: now,
    });
    return { started: true };
  },
});

export const priceSyncOwned = internalQuery({
  args: { userId: v.string(), startedAt: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { userId, startedAt }) => {
    const row = await enrolledHomepageUser(ctx, userId);
    return row?.enabled === true && row.priceSyncStartedAt === startedAt;
  },
});

export const releasePriceSync = internalMutation({
  args: { userId: v.string(), startedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { userId, startedAt }) => {
    const row = await enrolledHomepageUser(ctx, userId);
    if (row?.priceSyncStartedAt === startedAt) {
      await ctx.db.patch(row._id, { priceSyncStartedAt: undefined });
    }
    return null;
  },
});

export const runPriceSync = internalAction({
  args: { userId: v.string(), startedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { userId, startedAt }) => {
    let succeeded = false;
    try {
      succeeded = (await syncPriceHistoryForUser(ctx, userId)).success;
      if (succeeded) {
        const owned = await ctx.runQuery(internal.homepage.priceSyncOwned, {
          userId,
          startedAt,
        });
        if (owned) {
          await ctx.runMutation(internal.homepage.requestExport, { userId });
        }
      }
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "homepage_price_sync_failed",
          error: error instanceof Error ? error.name : "UnknownError",
        }),
      );
    } finally {
      await ctx.runMutation(internal.homepage.releasePriceSync, {
        userId,
        startedAt,
      });
    }
    return null;
  },
});

/** Only the homepage Worker can call these routes. Requests are HMAC-signed
 * with the provisioning secret and scoped to an enrolled user id. */
export async function handleHomepageService(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation">,
  request: Request,
) {
  const headers = {
    "cache-control": "private, no-store",
    "content-type": "application/json",
  };
  try {
    if (Number(request.headers.get("content-length") || 0) > 2048)
      return new Response("{}", { status: 413, headers });
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2048) {
          await reader.cancel();
          return new Response("{}", { status: 413, headers });
        }
        chunks.push(value);
      }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const body = new TextDecoder().decode(bytes);
    if (
      !(await verifyHomepageRequest(
        request,
        body,
        process.env.HOMEPAGE_PROVISIONING_SECRET!,
      ))
    )
      return new Response("{}", { status: 401, headers });
    const input = JSON.parse(body);
    const userId = identitySchema.parse(input.userId);
    const path = new URL(request.url).pathname;
    if (path === "/api/homepage/enroll") {
      const timezone = timezoneSchema.parse(input.timezone);
      const result = await ctx.runMutation(internal.homepage.enroll, {
        userId,
        timezone,
      });
      return new Response(JSON.stringify(result), { headers });
    }
    if (path === "/api/homepage/weather-key") {
      const row = await ctx.runQuery(internal.homepage.weatherKey, { userId });
      return new Response(
        JSON.stringify(
          row
            ? {
                keyId: row._id,
                apiKey: await decryptApiKey(row.encryptedValue, row.iv),
              }
            : { apiKey: null },
        ),
        { headers },
      );
    }
    if (path === "/api/homepage/sync-prices") {
      const result = await ctx.runMutation(internal.homepage.beginPriceSync, {
        userId,
      });
      return new Response(JSON.stringify(result), { headers });
    }
    return new Response("{}", { status: 404, headers });
  } catch {
    return new Response('{"error":"Homepage service request failed"}', {
      status: 400,
      headers,
    });
  }
}

export const service = httpAction(async (ctx, request) => {
  return await handleHomepageService(ctx, request);
});
