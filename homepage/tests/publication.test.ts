import { env as bindings } from "cloudflare:workers";
import {
  reset,
  runInDurableObject,
  runDurableObjectAlarm,
  evictDurableObject,
} from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Edition } from "@tasky/home-feed";
import worker from "../src/index";
import { objectCall, type Env } from "../src/env";
import { signedHeaders } from "../src/transport";
import { fixtureExport, fixtureWeather } from "./fixtures";
const env = bindings as unknown as Env;
afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});
async function enroll(userId = "user-a") {
  return objectCall(env.PUBLISHERS, userId, "/enroll", {
    userId,
    timezone: "America/New_York",
    displayName: "Fixture",
  });
}
async function send(envelope = fixtureExport(), key = env.INGESTION_SECRET) {
  const body = JSON.stringify(envelope);
  return worker.fetch(
    new Request(`${env.HOME_ORIGIN}/internal/tasky`, {
      method: "POST",
      headers: await signedHeaders(key, "/internal/tasky", body),
      body,
    }),
    env,
  );
}
const stub = (userId = "user-a") =>
  env.PUBLISHERS.get(env.PUBLISHERS.idFromName(userId));
async function tick() {
  await runInDurableObject(stub(), async (_instance, state) => {
    const value = await state.storage.get<Record<string, unknown>>("state");
    await state.storage.put("state", {
      ...value,
      retryAfter: 0,
      lastPublishedAt: 0,
    });
  });
  await runDurableObjectAlarm(stub());
}
describe("durable ingestion and publication", () => {
  it("rejects bad authentication, malformed bodies and unenrolled identities", async () => {
    expect((await send()).status).toBe(403);
    await enroll();
    expect(
      (
        await send(
          fixtureExport(),
          "another-invalid-key-at-least-32-characters",
        )
      ).status,
    ).toBe(401);
    const oversized = new Request(`${env.HOME_ORIGIN}/internal/tasky`, {
      method: "POST",
      body: "x".repeat(96_001),
    });
    expect((await worker.fetch(oversized, env)).status).toBe(413);
    const malformed = { ...fixtureExport(), payload: { unsafe: "data" } };
    const body = JSON.stringify(malformed);
    expect(
      (
        await worker.fetch(
          new Request(`${env.HOME_ORIGIN}/internal/tasky`, {
            method: "POST",
            body,
            headers: await signedHeaders(
              env.INGESTION_SECRET,
              "/internal/tasky",
              body,
            ),
          }),
          env,
        )
      ).status,
    ).toBe(400);
  });
  it("deduplicates, rejects conflicts and ignores out-of-order exports", async () => {
    await enroll();
    const newer = fixtureExport("user-a", 3);
    expect((await send(newer)).status).toBe(202);
    expect(await (await send(newer)).json()).toMatchObject({ duplicate: true });
    const conflict = structuredClone(newer);
    conflict.payload.tasks[0].title = "Conflicting content";
    expect((await send(conflict)).status).toBe(409);
    const reusedId = {
      ...fixtureExport("user-a", 4),
      exportId: newer.exportId,
    };
    expect((await send(reusedId)).status).toBe(409);
    expect(await (await send(fixtureExport("user-a", 2))).json()).toMatchObject(
      { older: true },
    );
    await tick();
    const edition = await env.EDITIONS.get<Edition>("edition:user-a", "json");
    expect(
      edition!.feed.modules.find((m) => m.id === "tasky")!.sourceRevision,
    ).toBe(3);
    expect(edition!.html).toContain(
      `data-revision="${edition!.feed.revision}"`,
    );
    expect(await env.EDITIONS.get("edition:user-b")).toBeNull();
  });
  it("recovers pending publication after eviction and propagates deletion/empty results", async () => {
    await enroll();
    await send();
    await evictDurableObject(stub());
    await tick();
    const first = await env.EDITIONS.get<Edition>("edition:user-a", "json");
    expect(
      first!.feed.modules.find((m) => m.id === "tasky")!.payload,
    ).toMatchObject({ counts: { active: 14 } });
    const empty = fixtureExport("user-a", 2);
    empty.payload.tasks = [];
    empty.payload.captures = [];
    empty.payload.counts = { active: 0, overdue: 0, dueToday: 0, captures: 0 };
    await send(empty);
    await tick();
    const next = await env.EDITIONS.get<Edition>("edition:user-a", "json");
    expect(next!.feed.revision).toBeGreaterThan(first!.feed.revision);
    expect(next!.html).not.toContain("Make space");
    expect(
      next!.feed.modules.find((m) => m.id === "tasky")!.payload,
    ).toMatchObject({ tasks: [], captures: [], counts: { active: 0 } });
  });
  it("publishes the saved portfolio alongside Tasky in the same user-scoped edition", async () => {
    await enroll();
    const envelope = fixtureExport();
    envelope.portfolio = {
      id: "portfolio",
      schemaVersion: 1,
      scope: "user",
      status: "available",
      sourceDataAt: Date.now(),
      collectedAt: Date.now(),
      freshForMs: 900_000,
      maxAgeMs: 3600_000,
      payload: {
        currency: "USD",
        totalValue: 1250,
        gainLoss: 250,
        gainLossPercent: 25,
        holdingsCount: 1,
        holdings: [
          { ticker: "ABC", name: "Example", value: 1250, allocation: 1 },
        ],
      },
    };
    expect((await send(envelope)).status).toBe(202);
    await tick();
    const edition = await env.EDITIONS.get<Edition>("edition:user-a", "json");
    expect(
      edition!.feed.modules.find((m) => m.id === "portfolio")!.payload,
    ).toMatchObject({ totalValue: 1250 });
    expect(edition!.html).toContain("$1,250");
    expect(edition!.html).toContain("Unrealized return");
    expect(await env.EDITIONS.get("edition:user-b")).toBeNull();
  });
  it("keeps weather failures separate from Tasky publication and preserves observation age", async () => {
    await enroll();
    await send();
    const weather = fixtureWeather(Date.now() - 3 * 3600_000);
    weather.error = "collection_failed";
    await objectCall(env.PUBLISHERS, "user-a", "/accept-module", {
      userId: "user-a",
      snapshot: weather,
    });
    await send(fixtureExport("user-a", 2));
    await tick();
    const edition = await env.EDITIONS.get<Edition>("edition:user-a", "json");
    expect(
      edition!.feed.modules.find((m) => m.id === "tasky")!.sourceRevision,
    ).toBe(2);
    expect(
      edition!.feed.modules.find((m) => m.id === "weather")!.sourceDataAt,
    ).toBe(weather.sourceDataAt);
    expect(edition!.html).toContain("latest update failed");
    await expect(
      objectCall(env.PUBLISHERS, "user-a", "/accept-module", {
        userId: "user-b",
        snapshot: weather,
      }),
    ).rejects.toThrow();
  });
  it("serializes concurrent exports so a delayed older event cannot overwrite a newer one", async () => {
    await enroll();
    await Promise.all([
      send(fixtureExport("user-a", 5)),
      send(fixtureExport("user-a", 3)),
      send(fixtureExport("user-a", 4)),
    ]);
    await tick();
    const edition = await env.EDITIONS.get<Edition>("edition:user-a", "json");
    expect(
      edition!.feed.modules.find((m) => m.id === "tasky")!.sourceRevision,
    ).toBe(5);
  });
  it("persists pending publication on a KV failure and retries without losing the accepted export", async () => {
    await enroll();
    await send();
    await runInDurableObject(stub(), async (instance, state) => {
      const publisher = instance as unknown as {
        env: Env;
        alarm: () => Promise<void>;
      };
      const original = publisher.env.EDITIONS;
      publisher.env.EDITIONS = {
        put: async () => {
          throw new Error("KV unavailable");
        },
      } as unknown as KVNamespace;
      try {
        await publisher.alarm();
      } finally {
        publisher.env.EDITIONS = original;
      }
      const value = await state.storage.get<Record<string, unknown>>("state");
      expect(value!.dirty).toBe(true);
      expect(value!.lastError).toBe("publication_failed");
      expect(value!.sourceRevision).toBe(1);
    });
    expect(await env.EDITIONS.get("edition:user-a")).toBeNull();
    expect(
      await objectCall(env.PUBLISHERS, "user-a", "/status", {}),
    ).toMatchObject({
      state: "retrying",
      revision: 0,
      sourceRevision: 1,
      lastError: "publication_failed",
    });
    await evictDurableObject(stub());
    await tick();
    const edition = await env.EDITIONS.get<Edition>("edition:user-a", "json");
    expect(
      edition!.feed.modules.find((m) => m.id === "tasky")!.sourceRevision,
    ).toBe(1);
    expect(
      await objectCall(env.PUBLISHERS, "user-a", "/status", {}),
    ).toMatchObject({ state: "ready", revision: edition!.feed.revision });
  });
  it("reports a delayed first export without claiming an empty preparation edition is ready", async () => {
    await enroll();
    await runInDurableObject(stub(), async (_instance, state) => {
      const value = await state.storage.get<Record<string, unknown>>("state");
      await state.storage.put("state", {
        ...value,
        provisioned: true,
        enrolledAt: Date.now() - 360_000,
      });
    });
    await tick();
    expect(
      await objectCall(env.PUBLISHERS, "user-a", "/status", {}),
    ).toMatchObject({
      state: "retrying",
      lastError: "initial_export_delayed",
      sourceRevision: 0,
    });
  });
});
