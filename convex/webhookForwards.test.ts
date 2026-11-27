// All tokens, IDs and Strava events below are synthetic.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";
import { decryptApiKey } from "./apiKeys";
import { evaluateEvent, parseRoutineId } from "./webhookForwards";

// auth.ts reads these at import time, so they must be set before any import.
vi.hoisted(() => {
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
  process.env.HOMEPAGE_OAUTH_CLIENT_ID = "homepage-test-client";
});
const FIRE_URL =
  "https://api.anthropic.com/v1/claude_code/routines/trig_01TESTROUTINE/fire";

beforeEach(() => {
  vi.stubEnv("API_KEYS_ENCRYPTION_SECRET", "test-encryption-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type T = ReturnType<typeof convexTest>;

async function createForward(
  t: T,
  overrides: Partial<{ source: "generic" | "strava"; userId: string }> = {},
) {
  const source = overrides.source ?? "strava";
  const id: Id<"webhookForwards"> = await t.mutation(
    internal.webhookForwards.createForUser,
    {
      userId: overrides.userId ?? "user-a",
      name: "Post-run routine",
      source,
      routine: FIRE_URL,
      routineToken: "sk-ant-oat01-synthetic",
      ...(source === "strava"
        ? { stravaClientId: "12345", stravaClientSecret: "strava-secret" }
        : {}),
    },
  );
  const path = await t.run(async (ctx) => {
    const row = (await ctx.db.get(id))!;
    return `/api/webhooks/in/${await decryptApiKey(row.encryptedToken, row.tokenIv)}`;
  });
  return { id, path };
}

function stubFetch(responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${String(url)}`);
    return next;
  });
  return calls;
}

const fired = () =>
  Response.json({
    type: "routine_fire",
    claude_code_session_url: "https://claude.ai/code/session_01TEST",
  });

const stravaEvent = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    aspect_type: "create",
    event_time: 1_800_000_000,
    object_id: 987654321,
    object_type: "activity",
    owner_id: 4242,
    subscription_id: 777,
    updates: {},
    ...overrides,
  });

const post = (t: T, path: string, body: string) =>
  t.fetch(path, { method: "POST", body });

const deliveries = (t: T) =>
  t.run((ctx) => ctx.db.query("webhookDeliveries").collect());

describe("parseRoutineId", () => {
  it("accepts an ID or fire URL and rejects anything else", () => {
    expect(parseRoutineId("trig_01ABC")).toBe("trig_01ABC");
    expect(parseRoutineId(` ${FIRE_URL} `)).toBe("trig_01TESTROUTINE");
    expect(() => parseRoutineId("https://evil.example/fire")).toThrow();
    expect(() => parseRoutineId("trig_01ABC/../x")).toThrow();
  });
});

describe("evaluateEvent", () => {
  const strava = {
    clientId: "1",
    encryptedClientSecret: "",
    iv: "",
    aspectTypes: ["create" as const],
    subscriptionId: 777,
    athleteId: 4242,
  };
  it("forwards only matching Strava activity events", () => {
    const forward = { source: "strava" as const, strava };
    expect(evaluateEvent(forward, stravaEvent())).toMatchObject({
      action: "forward",
      summary: "activity create 987654321",
    });
    for (const override of [
      { aspect_type: "update" },
      { object_type: "athlete" },
      { owner_id: 1 },
      { subscription_id: 1 },
    ]) {
      expect(evaluateEvent(forward, stravaEvent(override)).action).toBe("skip");
    }
    expect(evaluateEvent(forward, "not json").action).toBe("skip");
  });
});

describe("inbound webhook endpoint", () => {
  it("rejects unknown tokens", async () => {
    const t = convexTest(schema, modules);
    await createForward(t);
    const response = await post(t, "/api/webhooks/in/whk_unknown", "{}");
    expect(response.status).toBe(404);
  });

  it("answers the Strava handshake only with the right verify token", async () => {
    const t = convexTest(schema, modules);
    const { path } = await createForward(t);
    const calls = stubFetch([]);
    // Recompute the verify token the subscribe call sends to Strava.
    const forward = await t.run((ctx) =>
      ctx.db.query("webhookForwards").first(),
    );
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`strava-verify:${forward!.tokenHash}`),
    );
    const verifyToken = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const ok = await t.fetch(
      `${path}?hub.mode=subscribe&hub.challenge=abc123&hub.verify_token=${verifyToken}`,
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ "hub.challenge": "abc123" });
    const bad = await t.fetch(
      `${path}?hub.mode=subscribe&hub.challenge=abc123&hub.verify_token=wrong`,
    );
    expect(bad.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("forwards a Strava activity to the routine once", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { path } = await createForward(t);
    const calls = stubFetch([fired()]);

    const first = await post(t, path, stravaEvent());
    expect(await first.json()).toEqual({ status: "queued" });
    const retry = await post(t, path, stravaEvent());
    expect(await retry.json()).toEqual({ status: "duplicate" });
    const skipped = await post(t, path, stravaEvent({ aspect_type: "update" }));
    expect((await skipped.json()).status).toBe("skipped");

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(FIRE_URL);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-ant-oat01-synthetic");
    const { text } = JSON.parse(calls[0].init.body as string);
    expect(text).toContain("forward: Post-run routine");
    expect(text).toContain('"object_id":987654321');

    const rows = await deliveries(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "delivered",
      attempts: 1,
      sessionUrl: "https://claude.ai/code/session_01TEST",
    });
    expect(rows[0].text).toBeUndefined();
    vi.useRealTimers();
  });

  it("retries rate limits but not other failures", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { path } = await createForward(t, { source: "generic" });
    const error = (status: number, type: string) =>
      Response.json(
        { type: "error", error: { type, message: "nope" } },
        { status, headers: { "Retry-After": "5" } },
      );
    const calls = stubFetch([
      error(429, "rate_limit_error"),
      fired(),
      error(401, "authentication_error"),
    ]);

    await post(t, path, "first");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await post(t, path, "second");
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls).toHaveLength(3);
    const rows = await deliveries(t);
    expect(rows.map((row) => [row.status, row.attempts])).toEqual([
      ["delivered", 2],
      ["failed", 1],
    ]);
    expect(rows[1].error).toBe("authentication_error: nope");
    vi.useRealTimers();
  });

  it("does not forward while disabled", async () => {
    const t = convexTest(schema, modules);
    const { id, path } = await createForward(t, { source: "generic" });
    await t.run((ctx) => ctx.db.patch(id, { enabled: false }));
    const response = await post(t, path, "hello");
    expect(await response.json()).toEqual({ status: "disabled" });
    expect(await deliveries(t)).toHaveLength(0);
  });
});

describe("Strava authorization callback", () => {
  it("stores the athlete once and burns the state", async () => {
    const t = convexTest(schema, modules);
    const { id } = await createForward(t);
    const stateDigest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("state-1"),
    );
    const oauthStateHash = Array.from(new Uint8Array(stateDigest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    await t.mutation(internal.webhookForwards.patchStrava, { id, oauthStateHash });
    const calls = stubFetch([
      Response.json({ access_token: "discarded", athlete: { id: 4242 } }),
    ]);

    const ok = await t.fetch(
      "/api/webhooks/strava/callback?state=state-1&code=code-1",
      { redirect: "manual" },
    );
    expect(ok.headers.get("Location")).toContain("strava=authorized");
    expect(calls[0].url).toBe("https://www.strava.com/oauth/token");
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row!.strava).toMatchObject({ athleteId: 4242 });
    expect(row!.strava!.oauthStateHash).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain("discarded");

    const replay = await t.fetch(
      "/api/webhooks/strava/callback?state=state-1&code=code-1",
      { redirect: "manual" },
    );
    expect(replay.headers.get("Location")).toContain("strava=error");
  });
});
