import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  httpAction,
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
import {
  homepageHeaders,
  verifyHomepageRequest,
} from "./lib/homepageTransport";

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

export const prepare = internalMutation({
  args: { id: v.id("homepageEnrollments") },
  handler: async (ctx, { id }) => {
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
      });
      const body = JSON.stringify(envelope);
      if (new TextEncoder().encode(body).length > LIMITS.bytes)
        throw new Error("Homepage export exceeds limit");
      await ctx.db.patch(id, {
        pendingBody: body,
        pendingExportId: exportId,
        revision: sourceRevision,
        attempt: 0,
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
    const delay = args.ok
      ? interval()
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

/** Only the scoped homepage service can enroll or retrieve an enrolled user's
 * AccuWeather credential. There is deliberately no arbitrary key-type argument. */
export const service = httpAction(async (ctx, request) => {
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
    return new Response("{}", { status: 404, headers });
  } catch {
    return new Response('{"error":"Homepage service request failed"}', {
      status: 400,
      headers,
    });
  }
});
