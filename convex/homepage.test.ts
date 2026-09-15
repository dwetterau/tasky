import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { modules } from "./test.setup";
import { projectHomepage } from "./lib/homepageProjection";
import { calendar } from "../packages/home-feed/src/index";

afterEach(() => vi.unstubAllEnvs());

describe("homepage projection and durable outbox", () => {
  it("reads only the requested user's active data and ranks deadlines deterministically", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const tag = await ctx.db.insert("tags", {
        userId: "b",
        name: "Private B label",
        parentId: null,
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
    expect(result.tasks.map((task) => task.title)).toEqual([
      "Overdue",
      "Today",
    ]);
    expect(result.tasks[1].labels).toEqual([]);
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
    await t.mutation(internal.homepage.prepare, { id });
    const first = await t.query(internal.homepage.pending, { id });
    expect(JSON.parse(first!.pendingBody!).payload.tasks).toEqual([]);
    await t.mutation(internal.homepage.deliveryResult, {
      id,
      exportId: first!.pendingExportId!,
      ok: false,
      permanent: false,
    });
    await t.run((ctx) => ctx.db.patch(id, { nextRunAt: 0 }));
    await t.mutation(internal.homepage.prepare, { id });
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
    await t.mutation(internal.homepage.prepare, { id });
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
    await t.mutation(internal.homepage.prepare, { id });
    const next = await t.query(internal.homepage.pending, { id });
    expect(next!.revision).toBe(2);
    expect(JSON.parse(next!.pendingBody!).payload.tasks[0].title).toBe(
      "New task",
    );
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
    expect(result.tasks).toHaveLength(12);
    expect(result.tasks[0].title).toHaveLength(240);
    expect(
      await t.query(internal.homepage.weatherKey, { userId: "a" }),
    ).toBeNull();
    await expect(
      t.query(internal.homepage.weatherKey, { userId: "b" }),
    ).rejects.toThrow("Not enrolled");
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
    expect(result.tasks).toHaveLength(2);
    expect(
      result.tasks.every(
        (task) => task.due === "none" && task.dueDate === undefined,
      ),
    ).toBe(true);
    expect(result.counts.overdue).toBe(0);
  });
});
