// Per-user webhook forwarding: an unguessable inbound URL receives a webhook
// and forwards its body to a destination. The only destination today is the
// Claude Code routine "fire" API; the only source with special handling is
// Strava (subscription handshake, event filtering, one-time athlete consent).
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { decryptApiKey, encryptApiKey } from "./apiKeys";
import { getAuthUserId, siteUrl } from "./auth";
import { stravaAspectType, webhookForwardSource } from "./schema";

export const INBOUND_PATH_PREFIX = "/api/webhooks/in/";
export const STRAVA_OAUTH_CALLBACK_PATH = "/api/webhooks/strava/callback";

const ROUTINE_API_BASE = "https://api.anthropic.com/v1/claude_code/routines";
const STRAVA_API_BASE = "https://www.strava.com/api/v3";
const STRAVA_OAUTH_BASE = "https://www.strava.com/oauth";
// Leaves room for the header lines under the routine API's 65,536-char limit.
const MAX_BODY_CHARS = 60_000;
const MAX_FORWARDS_PER_USER = 20;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;
const DELIVERY_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const RECENT_DELIVERIES = 5;

type Forward = Doc<"webhookForwards">;
type StravaAspect = "create" | "update" | "delete";

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return (
    prefix +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

function convexSiteUrl(): string {
  const url = process.env.CONVEX_SITE_URL;
  if (!url) throw new Error("Missing CONVEX_SITE_URL");
  return url.replace(/\/$/, "");
}

export function inboundUrl(token: string): string {
  return `${convexSiteUrl()}${INBOUND_PATH_PREFIX}${token}`;
}

function stravaVerifyToken(tokenHash: string): Promise<string> {
  return sha256Hex(`strava-verify:${tokenHash}`);
}

/**
 * Accepts a routine ID or the "Fire URL" copied from the routine's API
 * trigger. Only the ID is kept, so a forward can never send the routine token
 * to a host other than the Anthropic API.
 */
export function parseRoutineId(input: string): string {
  const match = input.trim().match(/^(?:.*\/routines\/)?(trig_[A-Za-z0-9]+)(?:\/fire\/?)?$/);
  if (!match) {
    throw new Error("Routine must be a trig_... ID or its fire URL");
  }
  return match[1];
}

export type EventDecision =
  | { action: "forward"; summary: string; dedupeKey?: string }
  | { action: "skip"; reason: string };

/** Decides whether an inbound POST body should be forwarded. */
export function evaluateEvent(
  forward: Pick<Forward, "source" | "strava">,
  body: string,
): EventDecision {
  if (forward.source !== "strava") {
    return { action: "forward", summary: `POST (${body.length} chars)` };
  }
  let event: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { action: "skip", reason: "not a Strava event" };
    }
    event = parsed as Record<string, unknown>;
  } catch {
    return { action: "skip", reason: "not JSON" };
  }
  const strava = forward.strava;
  const { object_type, object_id, aspect_type, owner_id, event_time } = event;
  if (
    strava?.subscriptionId !== undefined &&
    event.subscription_id !== strava.subscriptionId
  ) {
    return { action: "skip", reason: "subscription mismatch" };
  }
  if (strava?.athleteId !== undefined && owner_id !== strava.athleteId) {
    return { action: "skip", reason: "other athlete" };
  }
  if (object_type !== "activity") {
    return { action: "skip", reason: "not an activity event" };
  }
  const aspects: StravaAspect[] = strava?.aspectTypes ?? ["create"];
  if (!aspects.includes(aspect_type as StravaAspect)) {
    return { action: "skip", reason: `aspect ${String(aspect_type)} not forwarded` };
  }
  return {
    action: "forward",
    summary: `activity ${String(aspect_type)} ${String(object_id)}`,
    dedupeKey: `strava:activity:${String(object_id)}:${String(aspect_type)}:${String(event_time)}`,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Inbound HTTP endpoint

export const inboundHandler = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const token = url.pathname.slice(INBOUND_PATH_PREFIX.length);
  if (!token || token.includes("/")) return json({ error: "not found" }, 404);
  const forward = await ctx.runQuery(internal.webhookForwards.getByTokenHash, {
    tokenHash: await sha256Hex(token),
  });
  if (!forward) return json({ error: "not found" }, 404);

  if (req.method === "GET") {
    // Strava subscription validation handshake.
    if (
      forward.source === "strava" &&
      url.searchParams.get("hub.mode") === "subscribe" &&
      url.searchParams.get("hub.verify_token") ===
        (await stravaVerifyToken(forward.tokenHash))
    ) {
      return json({ "hub.challenge": url.searchParams.get("hub.challenge") });
    }
    return json({ error: "forbidden" }, 403);
  }

  const body = await req.text();
  if (body.length > MAX_BODY_CHARS) return json({ error: "payload too large" }, 413);
  if (!forward.enabled) return json({ status: "disabled" });
  const decision = evaluateEvent(forward, body);
  if (decision.action === "skip") {
    return json({ status: "skipped", reason: decision.reason });
  }
  // Acknowledge fast (Strava allows two seconds); delivery runs in the background.
  const result = await ctx.runMutation(internal.webhookForwards.enqueue, {
    forwardId: forward._id,
    body,
    summary: decision.summary,
    dedupeKey: decision.dedupeKey,
  });
  return json({ status: result });
});

export const getByTokenHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("webhookForwards")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique(),
});

async function enqueueDelivery(
  ctx: MutationCtx,
  forward: Forward,
  args: { body: string; summary: string; dedupeKey?: string },
): Promise<"queued" | "duplicate"> {
  if (args.dedupeKey !== undefined) {
    const existing = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_forward_dedupe", (q) =>
        q.eq("forwardId", forward._id).eq("dedupeKey", args.dedupeKey),
      )
      .first();
    if (existing) return "duplicate";
  }
  const receivedAt = Date.now();
  const text = [
    "Webhook forwarded by Tasky.",
    `forward: ${forward.name}`,
    `source: ${forward.source}`,
    `received_at: ${new Date(receivedAt).toISOString()}`,
    "",
    args.body,
  ].join("\n");
  const deliveryId = await ctx.db.insert("webhookDeliveries", {
    userId: forward.userId,
    forwardId: forward._id,
    receivedAt,
    status: "pending",
    summary: args.summary,
    dedupeKey: args.dedupeKey,
    text,
    attempts: 0,
  });
  await ctx.scheduler.runAfter(0, internal.webhookForwards.deliver, { deliveryId });
  return "queued";
}

export const enqueue = internalMutation({
  args: {
    forwardId: v.id("webhookForwards"),
    body: v.string(),
    summary: v.string(),
    dedupeKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const forward = await ctx.db.get(args.forwardId);
    if (!forward) return "duplicate" as const;
    return await enqueueDelivery(ctx, forward, args);
  },
});

// ---------------------------------------------------------------------------
// Delivery to the Claude Code routine API

export const getDeliveryContext = internalQuery({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.status !== "pending" || delivery.text === undefined) {
      return null;
    }
    const forward = await ctx.db.get(delivery.forwardId);
    if (!forward) return null;
    return { text: delivery.text, destination: forward.destination };
  },
});

export const deliver = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.webhookForwards.getDeliveryContext, args);
    if (!context) return;
    const { destination, text } = context;
    let outcome: {
      responseStatus?: number;
      sessionUrl?: string;
      error?: string;
      retryAfterMs?: number;
    };
    try {
      const token = await decryptApiKey(destination.encryptedToken, destination.iv);
      const response = await fetch(`${ROUTINE_API_BASE}/${destination.routineId}/fire`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "experimental-cc-routine-2026-04-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });
      const payload = (await response.json().catch(() => null)) as {
        claude_code_session_url?: string;
        error?: { type?: string; message?: string };
      } | null;
      if (response.ok) {
        outcome = {
          responseStatus: response.status,
          sessionUrl: payload?.claude_code_session_url,
        };
      } else {
        const retryAfter = Number(response.headers.get("Retry-After"));
        outcome = {
          responseStatus: response.status,
          error: `${payload?.error?.type ?? "error"}: ${payload?.error?.message ?? response.statusText}`.slice(0, 300),
          // A fire has no idempotency key, so only retry responses that
          // guarantee no session was created.
          retryAfterMs:
            response.status === 429 || response.status === 503
              ? Math.min(
                  Number.isFinite(retryAfter) && retryAfter > 0
                    ? retryAfter * 1000
                    : 60_000,
                  MAX_RETRY_DELAY_MS,
                )
              : undefined,
        };
      }
    } catch (error) {
      outcome = {
        error: (error instanceof Error ? error.message : "request failed").slice(0, 300),
      };
    }
    await ctx.runMutation(internal.webhookForwards.recordResult, {
      deliveryId: args.deliveryId,
      ...outcome,
    });
  },
});

export const recordResult = internalMutation({
  args: {
    deliveryId: v.id("webhookDeliveries"),
    responseStatus: v.optional(v.number()),
    sessionUrl: v.optional(v.string()),
    error: v.optional(v.string()),
    retryAfterMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery) return;
    const attempts = delivery.attempts + 1;
    const base = {
      attempts,
      responseStatus: args.responseStatus,
      sessionUrl: args.sessionUrl,
      error: args.error,
    };
    if (args.error === undefined) {
      await ctx.db.patch(delivery._id, { ...base, status: "delivered", text: undefined });
    } else if (args.retryAfterMs !== undefined && attempts < MAX_ATTEMPTS) {
      await ctx.db.patch(delivery._id, base);
      await ctx.scheduler.runAfter(args.retryAfterMs, internal.webhookForwards.deliver, {
        deliveryId: delivery._id,
      });
    } else {
      await ctx.db.patch(delivery._id, { ...base, status: "failed", text: undefined });
    }
  },
});

export const cleanupDeliveries = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - DELIVERY_RETENTION_MS;
    const stale = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_received", (q) => q.lt("receivedAt", cutoff))
      .take(500);
    for (const row of stale) await ctx.db.delete(row._id);
  },
});

// ---------------------------------------------------------------------------
// Management API (settings UI)

async function requireUserId(ctx: Parameters<typeof getAuthUserId>[0]): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

async function requireOwnedForward(
  ctx: MutationCtx,
  id: Id<"webhookForwards">,
): Promise<Forward> {
  const userId = await requireUserId(ctx);
  const forward = await ctx.db.get(id);
  if (!forward || forward.userId !== userId) {
    throw new Error("Webhook forward not found or access denied");
  }
  return forward;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const forwards = await ctx.db
      .query("webhookForwards")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
    return await Promise.all(
      forwards.map(async (forward) => {
        const deliveries = await ctx.db
          .query("webhookDeliveries")
          .withIndex("by_forward_received", (q) => q.eq("forwardId", forward._id))
          .order("desc")
          .take(RECENT_DELIVERIES);
        return {
          _id: forward._id,
          _creationTime: forward._creationTime,
          name: forward.name,
          source: forward.source,
          enabled: forward.enabled,
          url: inboundUrl(await decryptApiKey(forward.encryptedToken, forward.tokenIv)),
          routineId: forward.destination.routineId,
          strava: forward.strava
            ? {
                clientId: forward.strava.clientId,
                aspectTypes: forward.strava.aspectTypes,
                subscriptionId: forward.strava.subscriptionId ?? null,
                athleteId: forward.strava.athleteId ?? null,
              }
            : null,
          deliveries: deliveries.map((delivery) => ({
            _id: delivery._id,
            receivedAt: delivery.receivedAt,
            status: delivery.status,
            summary: delivery.summary,
            attempts: delivery.attempts,
            responseStatus: delivery.responseStatus ?? null,
            sessionUrl: delivery.sessionUrl ?? null,
            error: delivery.error ?? null,
          })),
        };
      }),
    );
  },
});

const createArgs = {
  name: v.string(),
  source: webhookForwardSource,
  routine: v.string(), // trig_... ID or fire URL
  routineToken: v.string(),
  stravaClientId: v.optional(v.string()),
  stravaClientSecret: v.optional(v.string()),
  stravaAspectTypes: v.optional(v.array(stravaAspectType)),
};

async function encryptedDestination(routine: string, routineToken: string) {
  const token = routineToken.trim();
  if (!token) throw new Error("Routine token is required");
  const encrypted = await encryptApiKey(token);
  return {
    kind: "claude_routine" as const,
    routineId: parseRoutineId(routine),
    encryptedToken: encrypted.encryptedValue,
    iv: encrypted.iv,
  };
}

export const createForUser = internalMutation({
  args: { userId: v.string(), ...createArgs },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) throw new Error("Name is required");
    const existing = await ctx.db
      .query("webhookForwards")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    if (existing.length >= MAX_FORWARDS_PER_USER) {
      throw new Error(`At most ${MAX_FORWARDS_PER_USER} webhook forwards are allowed`);
    }
    const destination = await encryptedDestination(args.routine, args.routineToken);
    let strava: Forward["strava"];
    if (args.source === "strava") {
      const clientId = args.stravaClientId?.trim();
      const clientSecret = args.stravaClientSecret?.trim();
      if (!clientId || !/^\d+$/.test(clientId)) {
        throw new Error("Strava client ID must be numeric");
      }
      if (!clientSecret) throw new Error("Strava client secret is required");
      const aspectTypes: StravaAspect[] = [
        ...new Set<StravaAspect>(args.stravaAspectTypes ?? ["create"]),
      ];
      if (aspectTypes.length === 0) {
        throw new Error("Select at least one Strava event type");
      }
      const encrypted = await encryptApiKey(clientSecret);
      strava = {
        clientId,
        encryptedClientSecret: encrypted.encryptedValue,
        iv: encrypted.iv,
        aspectTypes,
      };
    }
    const token = randomToken("whk_");
    const encryptedToken = await encryptApiKey(token);
    return await ctx.db.insert("webhookForwards", {
      userId: args.userId,
      name,
      source: args.source,
      enabled: true,
      tokenHash: await sha256Hex(token),
      encryptedToken: encryptedToken.encryptedValue,
      tokenIv: encryptedToken.iv,
      destination,
      strava,
      updatedAt: Date.now(),
    });
  },
});

export const create = mutation({
  args: createArgs,
  handler: async (ctx, args): Promise<Id<"webhookForwards">> => {
    const userId = await requireUserId(ctx);
    return await ctx.runMutation(internal.webhookForwards.createForUser, {
      userId,
      ...args,
    });
  },
});

export const setEnabled = mutation({
  args: { id: v.id("webhookForwards"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const forward = await requireOwnedForward(ctx, args.id);
    await ctx.db.patch(forward._id, { enabled: args.enabled, updatedAt: Date.now() });
  },
});

/** Replaces the routine and its token, e.g. after regenerating the token. */
export const updateRoutine = mutation({
  args: { id: v.id("webhookForwards"), routine: v.string(), routineToken: v.string() },
  handler: async (ctx, args) => {
    const forward = await requireOwnedForward(ctx, args.id);
    await ctx.db.patch(forward._id, {
      destination: await encryptedDestination(args.routine, args.routineToken),
      updatedAt: Date.now(),
    });
  },
});

/** Fires the routine with a synthetic payload to check the destination. */
export const sendTest = mutation({
  args: { id: v.id("webhookForwards") },
  handler: async (ctx, args) => {
    const forward = await requireOwnedForward(ctx, args.id);
    await enqueueDelivery(ctx, forward, {
      body: JSON.stringify({ test: true, message: "Test event sent from Tasky settings" }),
      summary: "test event",
    });
  },
});

export const remove = mutation({
  args: { id: v.id("webhookForwards") },
  handler: async (ctx, args) => {
    const forward = await requireOwnedForward(ctx, args.id);
    if (forward.strava?.subscriptionId !== undefined) {
      await ctx.scheduler.runAfter(0, internal.webhookForwards.deleteStravaSubscription, {
        clientId: forward.strava.clientId,
        encryptedClientSecret: forward.strava.encryptedClientSecret,
        iv: forward.strava.iv,
        subscriptionId: forward.strava.subscriptionId,
      });
    }
    const deliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_forward_received", (q) => q.eq("forwardId", forward._id))
      .collect();
    for (const delivery of deliveries) await ctx.db.delete(delivery._id);
    await ctx.db.delete(forward._id);
  },
});

// ---------------------------------------------------------------------------
// Strava: push subscription management
//
// A Strava API application has exactly one push subscription, and only sends
// events for athletes who have authorized that application.

type StravaSubscription = { id: number; callback_url: string };
type StravaResult = { ok: true } | { ok: false; error: string };

function stravaCredentials(clientId: string, clientSecret: string): URLSearchParams {
  return new URLSearchParams({ client_id: clientId, client_secret: clientSecret });
}

async function stravaErrorText(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return `Strava returned ${response.status}${text ? `: ${text.slice(0, 300)}` : ""}`;
}

async function listStravaSubscriptions(
  clientId: string,
  clientSecret: string,
): Promise<StravaSubscription[]> {
  const response = await fetch(
    `${STRAVA_API_BASE}/push_subscriptions?${stravaCredentials(clientId, clientSecret)}`,
  );
  if (!response.ok) throw new Error(await stravaErrorText(response));
  return (await response.json()) as StravaSubscription[];
}

async function deleteStravaSubscriptionById(
  clientId: string,
  clientSecret: string,
  subscriptionId: number,
): Promise<void> {
  const response = await fetch(
    `${STRAVA_API_BASE}/push_subscriptions/${subscriptionId}?${stravaCredentials(clientId, clientSecret)}`,
    { method: "DELETE" },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(await stravaErrorText(response));
  }
}

export const getOwned = internalQuery({
  args: { id: v.id("webhookForwards"), userId: v.string() },
  handler: async (ctx, args) => {
    const forward = await ctx.db.get(args.id);
    return forward && forward.userId === args.userId ? forward : null;
  },
});

export const patchStrava = internalMutation({
  args: {
    id: v.id("webhookForwards"),
    subscriptionId: v.optional(v.union(v.number(), v.null())),
    athleteId: v.optional(v.number()),
    oauthStateHash: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const forward = await ctx.db.get(args.id);
    if (!forward?.strava) return;
    const strava = { ...forward.strava };
    if (args.subscriptionId !== undefined) {
      strava.subscriptionId = args.subscriptionId ?? undefined;
    }
    if (args.athleteId !== undefined) strava.athleteId = args.athleteId;
    if (args.oauthStateHash !== undefined) {
      strava.oauthStateHash = args.oauthStateHash ?? undefined;
    }
    await ctx.db.patch(forward._id, { strava, updatedAt: Date.now() });
  },
});

/**
 * Registers this forward's URL as the Strava application's push subscription.
 * Strava calls the inbound URL back (GET handshake) before this returns.
 */
export const stravaSubscribe = action({
  args: { id: v.id("webhookForwards"), replaceExisting: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<StravaResult> => {
    const userId = await requireUserId(ctx);
    const forward: Forward | null = await ctx.runQuery(
      internal.webhookForwards.getOwned,
      { id: args.id, userId },
    );
    if (!forward?.strava) return { ok: false, error: "Not a Strava webhook forward" };
    try {
      const { clientId } = forward.strava;
      const clientSecret = await decryptApiKey(
        forward.strava.encryptedClientSecret,
        forward.strava.iv,
      );
      const callbackUrl = inboundUrl(
        await decryptApiKey(forward.encryptedToken, forward.tokenIv),
      );
      const existing = await listStravaSubscriptions(clientId, clientSecret);
      let subscriptionId = existing.find((s) => s.callback_url === callbackUrl)?.id;
      if (subscriptionId === undefined) {
        if (existing.length > 0) {
          if (!args.replaceExisting) {
            return {
              ok: false,
              error: `This Strava app already has a subscription pointing at ${existing[0].callback_url}. Replace it to continue.`,
            };
          }
          for (const subscription of existing) {
            await deleteStravaSubscriptionById(clientId, clientSecret, subscription.id);
          }
        }
        const body = stravaCredentials(clientId, clientSecret);
        body.set("callback_url", callbackUrl);
        body.set("verify_token", await stravaVerifyToken(forward.tokenHash));
        const response = await fetch(`${STRAVA_API_BASE}/push_subscriptions`, {
          method: "POST",
          body,
        });
        if (!response.ok) return { ok: false, error: await stravaErrorText(response) };
        subscriptionId = ((await response.json()) as { id: number }).id;
      }
      await ctx.runMutation(internal.webhookForwards.patchStrava, {
        id: forward._id,
        subscriptionId,
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Strava request failed",
      };
    }
  },
});

export const stravaUnsubscribe = action({
  args: { id: v.id("webhookForwards") },
  handler: async (ctx, args): Promise<StravaResult> => {
    const userId = await requireUserId(ctx);
    const forward: Forward | null = await ctx.runQuery(
      internal.webhookForwards.getOwned,
      { id: args.id, userId },
    );
    if (!forward?.strava) return { ok: false, error: "Not a Strava webhook forward" };
    try {
      if (forward.strava.subscriptionId !== undefined) {
        await deleteStravaSubscriptionById(
          forward.strava.clientId,
          await decryptApiKey(forward.strava.encryptedClientSecret, forward.strava.iv),
          forward.strava.subscriptionId,
        );
      }
      await ctx.runMutation(internal.webhookForwards.patchStrava, {
        id: forward._id,
        subscriptionId: null,
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Strava request failed",
      };
    }
  },
});

export const deleteStravaSubscription = internalAction({
  args: {
    clientId: v.string(),
    encryptedClientSecret: v.string(),
    iv: v.string(),
    subscriptionId: v.number(),
  },
  handler: async (_ctx, args) => {
    await deleteStravaSubscriptionById(
      args.clientId,
      await decryptApiKey(args.encryptedClientSecret, args.iv),
      args.subscriptionId,
    );
  },
});

// ---------------------------------------------------------------------------
// Strava: one-time athlete authorization
//
// The athlete must authorize the application once so Strava emits their
// events. Tasky only keeps the athlete ID (to drop other athletes' events);
// the access and refresh tokens from the exchange are discarded.

export const startStravaAuthorization = mutation({
  args: { id: v.id("webhookForwards") },
  handler: async (ctx, args): Promise<string> => {
    const forward = await requireOwnedForward(ctx, args.id);
    if (!forward.strava) throw new Error("Not a Strava webhook forward");
    const state = randomToken("");
    await ctx.db.patch(forward._id, {
      strava: { ...forward.strava, oauthStateHash: await sha256Hex(state) },
      updatedAt: Date.now(),
    });
    const params = new URLSearchParams({
      client_id: forward.strava.clientId,
      redirect_uri: `${convexSiteUrl()}${STRAVA_OAUTH_CALLBACK_PATH}`,
      response_type: "code",
      approval_prompt: "auto",
      scope: "activity:read_all",
      state,
    });
    return `${STRAVA_OAUTH_BASE}/authorize?${params}`;
  },
});

export const getByStravaOauthState = internalQuery({
  args: { stateHash: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("webhookForwards")
      .withIndex("by_strava_oauth_state", (q) =>
        q.eq("strava.oauthStateHash", args.stateHash),
      )
      .unique(),
});

export const stravaOauthCallbackHandler = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const done = (result: "authorized" | "error") =>
    Response.redirect(`${siteUrl}/settings?strava=${result}`, 302);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) return done("error");
  const forward = await ctx.runQuery(internal.webhookForwards.getByStravaOauthState, {
    stateHash: await sha256Hex(state),
  });
  if (!forward?.strava) return done("error");
  // The state is single-use whether or not the exchange succeeds.
  await ctx.runMutation(internal.webhookForwards.patchStrava, {
    id: forward._id,
    oauthStateHash: null,
  });
  try {
    const body = stravaCredentials(
      forward.strava.clientId,
      await decryptApiKey(forward.strava.encryptedClientSecret, forward.strava.iv),
    );
    body.set("code", code);
    body.set("grant_type", "authorization_code");
    const response = await fetch(`${STRAVA_OAUTH_BASE}/token`, { method: "POST", body });
    if (!response.ok) {
      console.error("[webhookForwards] Strava code exchange failed", response.status);
      return done("error");
    }
    const athleteId = ((await response.json()) as { athlete?: { id?: unknown } }).athlete?.id;
    if (typeof athleteId !== "number") return done("error");
    await ctx.runMutation(internal.webhookForwards.patchStrava, {
      id: forward._id,
      athleteId,
    });
    return done("authorized");
  } catch (error) {
    console.error("[webhookForwards] Strava authorization failed", error);
    return done("error");
  }
});
