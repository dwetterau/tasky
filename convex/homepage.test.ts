import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { modules } from "./test.setup";
import { projectHomepage } from "./lib/homepageProjection";
import { homepageHeaders } from "./lib/homepageTransport";
import { handleHomepageService } from "./homepage";
import { calendar } from "../packages/home-feed/src/index";

afterEach(() => vi.unstubAllEnvs());

describe("homepage projection and durable outbox", () => {
  it("exports only the requested user's counts and today's task details", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const tag = await ctx.db.insert("tags", {
        userId: "b",
        name: "Private B label",
        parentId: null,
      });
      const ownTag = await ctx.db.insert("tags", {
        userId: "a",
        name: "Health",
        parentId: null,
      });
      await ctx.db.insert("signals", {
        userId: "a",
        name: "Run",
        tagIds: [ownTag, tag],
        model: {
          kind: "activity",
          target: { type: "recency", dueAfterMs: 86400_000 },
          lastOccurredAt: 0,
        },
        createdAt: 0,
        updatedAt: 0,
      });
      await ctx.db.insert("tasks", {
        userId: "a",
        content: "Today",
        tagIds: [tag],
        status: "not_started",
        priority: "urgent",
        dueDate: "2026-09-15",
      });
      await ctx.db.insert("tasks", {
        userId: "a",
        content: "Overdue",
        tagIds: [],
        status: "blocked",
        priority: "low",
        dueDate: "2026-09-14",
      });
      await ctx.db.insert("tasks", {
        userId: "a",
        content: "Closed secret",
        tagIds: [],
        status: "closed",
        priority: "urgent",
      });
      await ctx.db.insert("tasks", {
        userId: "b",
        content: "Private B task",
        tagIds: [],
        status: "in_progress",
        priority: "urgent",
      });
      await ctx.db.insert("captures", {
        userId: "a",
        text: "Inbox",
        completed: false,
      });
      await ctx.db.insert("captures", {
        userId: "b",
        text: "Private B capture",
        completed: false,
      });
    });
    const result = await t.run((ctx) =>
      projectHomepage(
        ctx,
        "a",
        "America/New_York",
        Date.parse("2026-09-16T02:00:00Z"),
      ),
    );
    expect(result.tasks).toMatchObject([
      {
        title: "Today",
        status: "not_started",
        priority: "urgent",
        dueDate: "2026-09-15",
        due: "today",
        labels: [],
      },
    ]);
    expect(result.captures).toEqual([]);
    expect(result.signals[0].labels).toEqual(["Health"]);
    expect(result.counts).toEqual({
      active: 2,
      overdue: 1,
      dueToday: 1,
      captures: 1,
    });
    expect(JSON.stringify(result)).not.toContain("Private B");
    expect(JSON.stringify(result)).not.toContain("Closed secret");
  });
  it("publishes successful empty exports and retains the exact envelope through retries", async () => {
    vi.stubEnv("HOMEPAGE_EXPORT_INTERVAL_MS", undefined);
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) =>
      ctx.db.insert("homepageEnrollments", {
        userId: "a",
        timezone: "America/New_York",
        enabled: true,
        revision: 0,
        nextRunAt: 0,
        attempt: 0,
      }),
    );
    await t.mutation(internal.homepage.freeze, { id });
    const first = await t.query(internal.homepage.pending, { id });
    expect(JSON.parse(first!.pendingBody!).payload.tasks).toEqual([]);
    await t.mutation(internal.homepage.deliveryResult, {
      id,
      exportId: first!.pendingExportId!,
      ok: false,
      permanent: false,
    });
    await t.run((ctx) => ctx.db.patch(id, { nextRunAt: 0 }));
    await t.mutation(internal.homepage.freeze, { id });
    const retry = await t.query(internal.homepage.pending, { id });
    expect(retry!.pendingBody).toBe(first!.pendingBody);
    expect(retry!.revision).toBe(1);
    const deliveredAt = Date.now();
    await t.mutation(internal.homepage.deliveryResult, {
      id,
      exportId: first!.pendingExportId!,
      ok: true,
      permanent: false,
    });
    const delivered = await t.query(internal.homepage.pending, { id });
    expect(delivered!.nextRunAt).toBeGreaterThanOrEqual(deliveredAt + 600_000);
    expect(delivered!.nextRunAt).toBeLessThanOrEqual(Date.now() + 600_000);
    // A routine recovery tick must not prepare another export before it is due.
    await t.mutation(internal.homepage.freeze, { id });
    const waiting = await t.query(internal.homepage.pending, { id });
    expect(waiting!.revision).toBe(1);
    expect(waiting!.pendingBody).toBeUndefined();
    await t.run(async (ctx) => {
      await ctx.db.patch(id, { nextRunAt: 0 });
      await ctx.db.insert("tasks", {
        userId: "a",
        content: "New task",
        tagIds: [],
        status: "in_progress",
        priority: "high",
      });
    });
    await t.mutation(internal.homepage.freeze, { id });
    const next = await t.query(internal.homepage.pending, { id });
    expect(next!.revision).toBe(2);
    expect(JSON.parse(next!.pendingBody!).payload.counts.active).toBe(1);
    // A delayed completion for an old delivery cannot clear the new export.
    await t.mutation(internal.homepage.deliveryResult, {
      id,
      exportId: first!.pendingExportId!,
      ok: true,
      permanent: false,
    });
    expect(
      (await t.query(internal.homepage.pending, { id }))!.pendingExportId,
    ).toBe(next!.pendingExportId);
  });
  it("bounds output text and reads, and keeps other users' weather credentials inaccessible", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 205; i++)
        await ctx.db.insert("tasks", {
          userId: "a",
          content: "x".repeat(300),
          tagIds: [],
          status: "not_started",
          priority: "high",
        });
      await ctx.db.insert("homepageEnrollments", {
        userId: "a",
        timezone: "UTC",
        enabled: true,
        revision: 0,
        nextRunAt: 0,
        attempt: 0,
      });
      await ctx.db.insert("apiKeys", {
        userId: "b",
        name: "Weather B",
        type: "accuweather",
        encryptedValue: "private",
        iv: "iv",
        keyVersion: 1,
        updatedAt: 0,
      });
    });
    const result = await t.run((ctx) =>
      projectHomepage(ctx, "a", "UTC", Date.now()),
    );
    expect(result.truncated).toBe(true);
    expect(result.tasks).toEqual([]);
    expect(result.counts.active).toBe(200);
    expect(
      await t.query(internal.homepage.weatherKey, { userId: "a" }),
    ).toBeNull();
    await expect(
      t.query(internal.homepage.weatherKey, { userId: "b" }),
    ).rejects.toThrow("Not enrolled");
  });
  it("exports only due signals and skips Weight", async () => {
    const t = convexTest(schema, modules);
    const now = Date.parse("2026-09-16T02:00:00Z");
    await t.run(async (ctx) => {
      for (const [userId, name, lastOccurredAt, dueAfterMs] of [
        ["a", "Due signal", now - 2 * 86400_000, 86400_000],
        ["a", "Soon signal", now - 12 * 3600_000, 86400_000],
        ["a", "Weight", now - 2 * 86400_000, 86400_000],
        ["b", "Private B signal", now - 2 * 86400_000, 86400_000],
      ] as const) {
        await ctx.db.insert("signals", {
          userId,
          name,
          tagIds: [],
          model: {
            kind: "activity",
            target: { type: "recency", dueAfterMs },
            lastOccurredAt,
          },
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    const result = await t.run((ctx) =>
      projectHomepage(ctx, "a", "America/New_York", now),
    );
    expect(result.signals.map((signal) => signal.name)).toEqual(["Due signal"]);
  });
  it("uses local calendar boundaries across daylight-saving changes", () => {
    const spring = calendar(
      Date.parse("2026-03-08T15:00:00Z"),
      "America/New_York",
    );
    const fall = calendar(
      Date.parse("2026-11-01T15:00:00Z"),
      "America/New_York",
    );
    expect(spring.day.endAt - spring.day.startAt).toBe(23 * 3600_000);
    expect(fall.day.endAt - fall.day.startAt).toBe(25 * 3600_000);
    expect(spring.localDate).toBe("2026-03-08");
  });
  it("keeps exporting when a legacy task has an invalid calendar date", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const dueDate of ["next Friday", "2026-02-30"])
        await ctx.db.insert("tasks", {
          userId: "a",
          content: "Legacy task",
          tagIds: [],
          status: "not_started",
          priority: "high",
          dueDate,
        });
    });
    const result = await t.run((ctx) =>
      projectHomepage(ctx, "a", "UTC", Date.now()),
    );
    expect(result.tasks).toEqual([]);
    expect(result.counts.active).toBe(2);
    expect(result.counts.overdue).toBe(0);
  });
});

const provisionSecret = "fixture-provision-only-32-bytes-long-secret";
const syncPath = "/api/homepage/sync-prices";
type HomepageHarness = ReturnType<typeof convexTest>;

async function enrollHomepageUser(t: HomepageHarness, userId = "a") {
  return await t.run((ctx) =>
    ctx.db.insert("homepageEnrollments", {
      userId,
      timezone: "America/New_York",
      enabled: true,
      revision: 0,
      nextRunAt: 0,
      attempt: 0,
    }),
  );
}

async function postSync(
  t: HomepageHarness,
  body: string,
  secret = provisionSecret,
) {
  const headers = await homepageHeaders(secret, syncPath, body);
  return await t.action(async (ctx) => {
    const response = await handleHomepageService(
      ctx,
      new Request(`https://tasky.example.test${syncPath}`, {
        method: "POST",
        headers,
        body,
      }),
    );
    return { status: response.status, body: await response.text() };
  });
}

describe("homepage price sync route", () => {
  it("rejects a missing or mismatched provisioning signature", async () => {
    vi.stubEnv("HOMEPAGE_PROVISIONING_SECRET", provisionSecret);
    const t = convexTest(schema, modules);
    const id = await enrollHomepageUser(t);
    const body = JSON.stringify({ userId: "a" });
    const unsigned = await t.action(async (ctx) => {
      const response = await handleHomepageService(
        ctx,
        new Request(`https://tasky.example.test${syncPath}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
      );
      return response.status;
    });
    expect(unsigned).toBe(401);
    const unenrolled = await postSync(t, JSON.stringify({ userId: "b" }));
    const headers = await homepageHeaders(provisionSecret, syncPath, body);
    const tampered = await t.action(async (ctx) => {
      const response = await handleHomepageService(
        ctx,
        new Request(`https://tasky.example.test${syncPath}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ userId: "b" }),
        }),
      );
      return response.status;
    });
    expect(unenrolled.status).toBe(400);
    expect(tampered).toBe(401);
    const untouched = await t.query(internal.homepage.pending, { id });
    expect(untouched!.priceSyncStartedAt).toBeUndefined();
    expect(untouched!.revision).toBe(0);
  });

  it("starts one sync for the signed enrolled user and ignores a held lease", async () => {
    vi.stubEnv("HOMEPAGE_PROVISIONING_SECRET", provisionSecret);
    const t = convexTest(schema, modules);
    const id = await enrollHomepageUser(t);
    const started = await postSync(t, JSON.stringify({ userId: "a" }));
    expect(started.status).toBe(200);
    expect(JSON.parse(started.body)).toEqual({ started: true });
    await t.finishAllScheduledFunctions(() => {});
    const finished = await t.query(internal.homepage.pending, { id });
    expect(finished!.priceSyncStartedAt).toBeUndefined();
    expect(finished!.revision).toBe(0);
    expect(finished!.pendingBody).toBeUndefined();

    const heldAt = Date.now();
    await t.run((ctx) => ctx.db.patch(id, { priceSyncStartedAt: heldAt }));
    const repeat = await postSync(t, JSON.stringify({ userId: "a" }));
    expect(repeat.status).toBe(200);
    expect(JSON.parse(repeat.body)).toEqual({ started: false });
    expect((await t.query(internal.homepage.pending, { id }))!.priceSyncStartedAt).toBe(
      heldAt,
    );
    await t.run((ctx) =>
      ctx.db.patch(id, { priceSyncStartedAt: Date.now() - 30 * 60_000 - 1 }),
    );
    const expired = await postSync(t, JSON.stringify({ userId: "a" }));
    expect(expired.status).toBe(200);
    expect(JSON.parse(expired.body)).toEqual({ started: true });
    await t.finishAllScheduledFunctions(() => {});
    expect((await t.query(internal.homepage.pending, { id }))!.revision).toBe(0);
  });

  it("releases the lease without exporting when price sync does not succeed", async () => {
    const t = convexTest(schema, modules);
    const id = await enrollHomepageUser(t);
    const startedAt = Date.now();
    await t.run((ctx) => ctx.db.patch(id, { priceSyncStartedAt: startedAt }));
    expect(
      await t.action(internal.homepage.runPriceSync, {
        userId: "a",
        startedAt,
      }),
    ).toBeNull();
    const row = await t.query(internal.homepage.pending, { id });
    expect(row!.priceSyncStartedAt).toBeUndefined();
    expect(row!.nextRunAt).toBe(0);
    expect(row!.revision).toBe(0);
  });
});
