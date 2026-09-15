import { env as bindings } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import worker, { handleRequest } from "../src/index";
import {
  issueSession,
  verifySession,
  SESSION_COOKIE,
  cookie,
} from "../src/auth/credentials";
import { base64ToBytes, digest } from "../src/transport";
import type { Env } from "../src/env";
import {
  browserScriptVersion,
  dailyEdition,
  renderEdition,
} from "../src/rendering/page";
import { fixtureEdition } from "./fixtures";
const env = bindings as unknown as Env;
afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});
const request = (path: string, token?: string) =>
  new Request(`${env.HOME_ORIGIN}${path}`, {
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
  });
const sid = () => digest("fixture-browser-handle");

describe("private delivery", () => {
  it("caches only the versioned public script, never private pages", async () => {
    const response = await handleRequest(
      request(`/assets/home.js?v=${browserScriptVersion}`),
      env,
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers.has("set-cookie")).toBe(false);
    const legacy = await handleRequest(request("/assets/home.js?v=old"), env);
    expect(legacy.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
  });
  it("renders a personal daily edition without task details or duplicate headings", () => {
    const { feed } = fixtureEdition(
      "user-a",
      99,
      Date.parse("2026-09-16T02:00:00Z"),
    );
    feed.displayName = "David Wetterau";
    const html = renderEdition(feed, env.TASKY_ORIGIN);
    expect(html).toMatch(/<h1>\s*Hello, David\s*<\/h1>/);
    expect(html).toContain("Edition Nº 1");
    expect(html).toContain('data-revision="99"');
    expect(html).toContain("Generated <time");
    expect(html).toContain("A good week");
    expect(html).not.toContain("Make space for the work");
    expect(html).not.toContain("YOUR PRIVATE EDITION");
    expect(html).not.toContain("Outside your window");
    expect(html).not.toContain("Weather by AccuWeather");
    expect(html).not.toContain(">Scorecards</h3>");
    expect(html).not.toContain(">Tasky ↗</a>");
    expect(html).toContain('aria-describedby="weather-info"');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("Forecast timestamp");
    expect(html).toContain("Open ↗</a>");
    expect(
      dailyEdition(Date.parse("2026-09-16T04:00:00Z"), feed.timezone),
    ).toBe(2);
  });
  it("authenticates before touching KV or any other service", async () => {
    const get = vi.fn();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("No network"));
    const isolated = { ...env, EDITIONS: { get } } as unknown as Env;
    for (const token of [
      undefined,
      "malformed",
      await issueSession(
        env,
        "user-a",
        await sid(),
        Date.now() - 2 * 86400_000,
      ),
    ]) {
      expect(
        (await handleRequest(request("/api/edition", token), isolated)).status,
      ).toBe(401);
    }
    expect(get).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("serves one user-scoped envelope with zero upstream calls", async () => {
    const a = fixtureEdition("user-a");
    const b = fixtureEdition("user-b");
    const get = vi.fn(async (key: string) =>
      key === "edition:user-a" ? a : b,
    );
    const publisher = vi.fn(() => {
      throw new Error("DO forbidden on read path");
    });
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network forbidden"));
    const isolated = {
      ...env,
      EDITIONS: { get },
      PUBLISHERS: { get: publisher },
      SESSIONS: { get: publisher },
    } as unknown as Env;
    const token = await issueSession(env, "user-a", await sid());
    for (const path of [
      "/?userId=user-b",
      "/api/edition?userId=user-b",
      "/api/status?userId=user-b",
    ]) {
      get.mockClear();
      const response = await handleRequest(request(path, token), isolated);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("referrer-policy")).toBe("same-origin");
      expect(response.headers.get("x-edition-revision")).toBe("1");
      expect(await response.text()).not.toContain("User B private task");
      expect(get).toHaveBeenCalledExactlyOnceWith("edition:user-a", "json");
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(publisher).not.toHaveBeenCalled();
  });
  it("fails closed on another user's envelope or a deployment alias", async () => {
    const token = await issueSession(env, "user-a", await sid());
    await env.EDITIONS.put(
      "edition:user-a",
      JSON.stringify(fixtureEdition("user-b")),
    );
    const response = await worker.fetch(request("/", token), env);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("User B");
    expect(
      (
        await worker.fetch(
          new Request("https://alias.workers.dev/", {
            headers: { cookie: `${SESSION_COOKIE}=${token}` },
          }),
          env,
        )
      ).status,
    ).toBe(421);
  });
  it("protects status and setup and ignores URL identity on setup", async () => {
    expect(
      (await worker.fetch(request("/api/setup?userId=user-b"), env)).status,
    ).toBe(401);
    expect((await worker.fetch(request("/api/status"), env)).status).toBe(401);
    const get = vi.fn(() => ({
      fetch: vi.fn(async () => Response.json({ state: "preparing" })),
    }));
    const idFromName = vi.fn((name: string) => name);
    const isolated = {
      ...env,
      PUBLISHERS: { get, idFromName },
    } as unknown as Env;
    const token = await issueSession(env, "user-a", await sid());
    expect(
      (
        await handleRequest(
          request("/api/setup?userId=user-b", token),
          isolated,
        )
      ).status,
    ).toBe(200);
    expect(idFromName).toHaveBeenCalledWith("user-a");
  });
  it("shows preparation or stale data without JavaScript", async () => {
    const token = await issueSession(env, "user-a", await sid());
    expect((await worker.fetch(request("/", token), env)).status).toBe(202);
    await env.EDITIONS.put(
      "edition:user-a",
      JSON.stringify(fixtureEdition("user-a", 1, Date.now() - 2 * 3600_000)),
    );
    const html = await (await worker.fetch(request("/", token), env)).text();
    expect(html).toContain("outdated; check the source");
    expect(html).toContain("A good week");
    expect(html).not.toContain("<!--FRESHNESS-->");
  });
});
describe("local credentials", () => {
  it("rejects bad signatures, issuer, audience, scope and type", async () => {
    const key = base64ToBytes(JSON.parse(env.SESSION_KEYS).test);
    for (const patch of [
      { iss: "https://wrong.test" },
      { aud: "mcp" },
      { scope: "tasks:read" },
      { sub: "../../user-b" },
    ]) {
      const token = await new SignJWT({
        iss: env.HOME_ORIGIN,
        aud: "tasky-homepage:read",
        sub: "user-a",
        sid: await sid(),
        scope: "homepage:read",
        ...patch,
      })
        .setProtectedHeader({ alg: "HS256", kid: "test", typ: "home+jwt" })
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(key);
      expect(await verifySession(env, token)).toBeNull();
    }
    const valid = await issueSession(env, "user-a", await sid());
    expect(await verifySession(env, `${valid.slice(0, -4)}abcd`)).toBeNull();
    expect(cookie(SESSION_COOKIE, "token", 86400)).toContain(
      "Secure; HttpOnly; SameSite=Lax; Path=/",
    );
  });
  it("supports overlapping signing keys and retires old keys", async () => {
    const token = await issueSession(env, "user-a", await sid());
    const keys = JSON.parse(env.SESSION_KEYS);
    const rotated = {
      ...env,
      SESSION_ACTIVE_KID: "next",
      SESSION_KEYS: JSON.stringify({ ...keys, next: keys.test }),
    };
    expect(await verifySession(rotated, token)).not.toBeNull();
    expect(
      await verifySession(
        { ...rotated, SESSION_KEYS: JSON.stringify({ next: keys.test }) },
        token,
      ),
    ).toBeNull();
  });
  it("rejects cross-origin session mutations", async () => {
    for (const path of ["/auth/logout", "/auth/renew"]) {
      for (const origin of ["https://evil.test", "null"]) {
        const response = await worker.fetch(
          new Request(`${env.HOME_ORIGIN}${path}`, {
            method: "POST",
            headers: { origin },
          }),
          env,
        );
        expect(response.status).toBe(403);
        expect(response.headers.getSetCookie()).toHaveLength(0);
        expect(await response.text()).not.toContain(
          "This account is not allowed",
        );
      }
    }
  });
});
