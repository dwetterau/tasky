import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { DAY_MS } from "./lib/signalStatus";
import { modules } from "./test.setup";

describe("signals backend", () => {
  it("records activity entries idempotently and keeps the latest occurrence", async () => {
    const t = convexTest(schema, modules);
    const { signalId } = await t.mutation(internal.signals.manageFromMcp, {
      userId: "user-1",
      now: 10 * DAY_MS,
      operation: {
        type: "activity.create",
        name: "Run",
        tagIds: [],
        target: {
          type: "recency",
          dueAfterMs: 4 * DAY_MS,
        },
      },
    });

    const first = await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId,
      idempotencyKey: "run-1",
      operation: {
        type: "activity.occurred",
        occurredAt: 9 * DAY_MS,
        note: "5 km",
      },
      now: 10 * DAY_MS,
      soonWindowMs: DAY_MS,
    });
    const replay = await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId,
      idempotencyKey: "run-1",
      operation: {
        type: "activity.occurred",
        occurredAt: 9 * DAY_MS,
        note: "5 km",
      },
      now: 11 * DAY_MS,
      soonWindowMs: DAY_MS,
    });
    await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId,
      idempotencyKey: "run-backdated",
      operation: {
        type: "activity.occurred",
        occurredAt: 8 * DAY_MS,
      },
      now: 11 * DAY_MS,
      soonWindowMs: DAY_MS,
    });

    expect(replay).toMatchObject({
      entryId: first.entryId,
      idempotent: true,
    });
    const entries = await t.run(async (ctx) => {
      return await ctx.db
        .query("signalEntries")
        .withIndex("by_signal_effective_at", (q) => q.eq("signalId", signalId))
        .collect();
    });
    expect(entries).toHaveLength(2);

    const { signals: dashboardSignals } = await t.query(
      internal.signals.listForMcp,
      {
        userId: "user-1",
        now: 11 * DAY_MS,
        soonWindowMs: DAY_MS,
      },
    );
    const [dashboardSignal] = dashboardSignals;
    expect(dashboardSignal.model).toMatchObject({
      kind: "activity",
      lastOccurredAt: 9 * DAY_MS,
    });
  });

  it("counts activity entries inside daily and weekly targets", async () => {
    const t = convexTest(schema, modules);
    const periodBounds = {
      day: {
        startAt: 10 * DAY_MS,
        endAt: 11 * DAY_MS,
      },
      week: {
        startAt: 7 * DAY_MS,
        endAt: 14 * DAY_MS,
      },
    };
    const { signalId } = await t.mutation(internal.signals.manageFromMcp, {
      userId: "user-1",
      now: 10 * DAY_MS,
      operation: {
        type: "activity.create",
        name: "Run",
        tagIds: [],
        target: {
          type: "period",
          period: "week",
          targetCount: 2,
        },
      },
    });

    const first = await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId,
      idempotencyKey: "weekly-run-1",
      operation: { type: "activity.occurred" },
      now: 10 * DAY_MS,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    expect(first.signal.evaluation).toMatchObject({
      attention: "due",
      periodProgress: {
        period: "week",
        completedCount: 1,
        targetCount: 2,
        remainingCount: 1,
      },
    });

    await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId,
      idempotencyKey: "old-run",
      operation: {
        type: "activity.occurred",
        occurredAt: 6 * DAY_MS,
      },
      now: 10 * DAY_MS,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    const beforeTarget = await t.query(internal.signals.listForMcp, {
      userId: "user-1",
      now: 10 * DAY_MS,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    expect(beforeTarget.signals[0].evaluation.periodProgress).toMatchObject({
      completedCount: 1,
    });

    const completed = await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId,
      idempotencyKey: "weekly-run-2",
      operation: {
        type: "activity.occurred",
        occurredAt: 10 * DAY_MS + 1,
      },
      now: 10 * DAY_MS + 1,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    expect(completed.signal.evaluation).toMatchObject({
      attention: "ok",
      periodProgress: {
        completedCount: 2,
        remainingCount: 0,
      },
    });
  });

  it("keeps weekly targets open through Sunday", async () => {
    const t = convexTest(schema, modules);
    const sunday = Date.UTC(2026, 7, 30, 12);
    await t.mutation(internal.signals.manageFromMcp, {
      userId: "user-1",
      now: sunday,
      operation: {
        type: "activity.create",
        name: "Run",
        tagIds: [],
        target: {
          type: "period",
          period: "week",
          targetCount: 2,
        },
      },
    });

    const result = await t.query(internal.signals.listForMcp, {
      userId: "user-1",
      now: sunday,
      soonWindowMs: DAY_MS,
    });

    expect(result.signals[0].evaluation.periodProgress).toMatchObject({
      startAt: Date.UTC(2026, 7, 24),
      endAt: Date.UTC(2026, 7, 31),
    });
  });

  it("materializes scheduled inventory before applying an adjustment", async () => {
    const t = convexTest(schema, modules);
    const { signalId } = await t.mutation(internal.signals.manageFromMcp, {
      userId: "user-1",
      now: 0,
      operation: {
        type: "inventory.create",
        name: "Prescription",
        tagIds: [],
        unit: "pills",
        initialQuantity: 10,
        threshold: {
          value: 2,
          comparison: "atOrBelow",
        },
        flow: {
          amount: -1,
          everyDays: 1,
        },
      },
    });

    const projected = await t.query(internal.signals.listForMcp, {
      userId: "user-1",
      now: 3 * DAY_MS,
      soonWindowMs: DAY_MS,
    });
    expect(projected.signals[0].evaluation).toMatchObject({
      projectedQuantity: 7,
      isProjected: true,
    });

    const result = await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId,
      idempotencyKey: "dose-adjustment",
      operation: {
        type: "inventory.adjusted",
        amount: -1,
      },
      now: 3 * DAY_MS,
      soonWindowMs: DAY_MS,
    });
    expect(result.signal.model).toMatchObject({
      kind: "inventory",
      confirmedQuantity: 6,
      confirmedAt: 3 * DAY_MS,
      nextFlowAt: 4 * DAY_MS,
    });
    expect(result.signal.evaluation).toMatchObject({
      projectedQuantity: 6,
      isProjected: false,
    });
  });

  it("enforces signal ownership and idempotency-key uniqueness", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(internal.signals.manageFromMcp, {
      userId: "user-1",
      now: 1,
      operation: {
        type: "activity.create",
        name: "Yoga",
        tagIds: [],
      },
    });
    const second = await t.mutation(internal.signals.manageFromMcp, {
      userId: "user-1",
      now: 1,
      operation: {
        type: "activity.create",
        name: "Climbing",
        tagIds: [],
      },
    });

    await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId: first.signalId,
      idempotencyKey: "shared-key",
      operation: { type: "activity.occurred" },
      now: 2,
      soonWindowMs: 0,
    });

    await expect(
      t.mutation(internal.signals.recordFromMcp, {
        userId: "user-1",
        signalId: second.signalId,
        idempotencyKey: "shared-key",
        operation: { type: "activity.occurred" },
        now: 2,
        soonWindowMs: 0,
      }),
    ).rejects.toThrow(/Idempotency key/);
    await expect(
      t.mutation(internal.signals.recordFromMcp, {
        userId: "user-2",
        signalId: first.signalId,
        idempotencyKey: "other-user",
        operation: { type: "activity.occurred" },
        now: 2,
        soonWindowMs: 0,
      }),
    ).rejects.toThrow(/Signal not found or access denied/);
  });

  it("validates, deduplicates, hydrates, and filters signal tags", async () => {
    const t = convexTest(schema, modules);
    const { exerciseTagId, runningTagId, otherUserTagId } = await t.run(
      async (ctx) => {
        const exerciseTagId = await ctx.db.insert("tags", {
          userId: "user-1",
          name: "Exercise",
          parentId: null,
          color: "#34c759",
          childrenRecursive: [],
        });
        const runningTagId = await ctx.db.insert("tags", {
          userId: "user-1",
          name: "Running",
          parentId: exerciseTagId,
          childrenRecursive: [],
        });
        await ctx.db.patch(exerciseTagId, {
          childrenRecursive: [runningTagId],
        });
        const otherUserTagId = await ctx.db.insert("tags", {
          userId: "user-2",
          name: "Private",
          parentId: null,
          childrenRecursive: [],
        });
        return { exerciseTagId, runningTagId, otherUserTagId };
      },
    );

    const { signalId } = await t.mutation(internal.signals.manageFromMcp, {
      userId: "user-1",
      now: 1,
      operation: {
        type: "activity.create",
        name: "Run",
        tagIds: [runningTagId, runningTagId],
      },
    });
    const filtered = await t.query(internal.signals.listForMcp, {
      userId: "user-1",
      now: 1,
      soonWindowMs: 0,
      tagId: exerciseTagId,
    });

    expect(filtered.signals).toHaveLength(1);
    expect(filtered.signals[0]).toMatchObject({
      id: signalId,
      tagIds: [runningTagId],
      tags: [{ id: runningTagId, name: "Running" }],
    });
    expect(filtered.availableTags).toEqual([
      expect.objectContaining({ id: exerciseTagId, name: "Exercise" }),
      expect.objectContaining({ id: runningTagId, name: "Running" }),
    ]);

    const { signalId: outsideSignalId } = await t.mutation(
      internal.signals.manageFromMcp,
      {
        userId: "user-1",
        now: 1,
        operation: {
          type: "activity.create",
          name: "Unscoped",
          tagIds: [],
        },
      },
    );
    const scopedRead = await t.query(internal.signals.listForMcp, {
      userId: "user-1",
      tagRootId: exerciseTagId,
      now: 1,
      soonWindowMs: 0,
    });
    expect(scopedRead.signals.map((signal) => signal.id)).toEqual([signalId]);
    expect(scopedRead.availableTags.map((tag) => tag.id)).toEqual([
      exerciseTagId,
      runningTagId,
    ]);
    await expect(
      t.mutation(internal.signals.recordFromMcp, {
        userId: "user-1",
        tagRootId: exerciseTagId,
        signalId: outsideSignalId,
        idempotencyKey: "outside-root",
        operation: { type: "activity.occurred" },
        now: 2,
        soonWindowMs: 0,
      }),
    ).rejects.toThrow(/authorized tag root/);

    const { signalId: rootCreatedSignalId } = await t.mutation(
      internal.signals.manageFromMcp,
      {
        userId: "user-1",
        tagRootId: exerciseTagId,
        now: 1,
        operation: {
          type: "activity.create",
          name: "Scoped creation",
          tagIds: [],
        },
      },
    );
    const rootCreatedSignal = await t.run(async (ctx) => {
      return await ctx.db.get("signals", rootCreatedSignalId);
    });
    expect(rootCreatedSignal?.tagIds).toEqual([exerciseTagId]);

    await t.mutation(internal.signals.manageFromMcp, {
      userId: "user-1",
      now: 2,
      operation: {
        type: "activity.update",
        signalId,
        name: "Morning run",
      },
    });
    const preserved = await t.query(internal.signals.listForMcp, {
      userId: "user-1",
      now: 2,
      soonWindowMs: 0,
      tagId: exerciseTagId,
    });
    expect(preserved.signals.map((signal) => signal.id)).toContain(signalId);

    await t.mutation(internal.signals.manageFromMcp, {
      userId: "user-1",
      now: 3,
      operation: {
        type: "activity.update",
        signalId,
        tagIds: [],
      },
    });
    const cleared = await t.query(internal.signals.listForMcp, {
      userId: "user-1",
      now: 3,
      soonWindowMs: 0,
      tagId: exerciseTagId,
    });
    expect(cleared.signals.map((signal) => signal.id)).not.toContain(signalId);

    await expect(
      t.mutation(internal.signals.manageFromMcp, {
        userId: "user-1",
        now: 2,
        operation: {
          type: "activity.update",
          signalId,
          tagIds: [otherUserTagId],
        },
      }),
    ).rejects.toThrow(/tags are invalid/);
  });
});
