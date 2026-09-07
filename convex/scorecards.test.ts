import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { DAY_MS } from "./lib/signalStatus";
import { modules } from "./test.setup";

async function createActivity(
  t: ReturnType<typeof convexTest>,
  name: string,
  target?: {
    type: "period";
    period: "day" | "week" | "month";
    targetCount: number;
  },
  tagIds: Id<"tags">[] = [],
) {
  return await t.mutation(internal.signals.manageFromMcp, {
    userId: "user-1",
    now: 10 * DAY_MS,
    operation: {
      type: "activity.create",
      name,
      tagIds,
      target,
    },
  });
}

describe("scorecards backend", () => {
  it("rolls up required and optional members and attaches reverse membership", async () => {
    const t = convexTest(schema, modules);
    const periodBounds = {
      day: { startAt: 10 * DAY_MS, endAt: 11 * DAY_MS },
      week: { startAt: 7 * DAY_MS, endAt: 14 * DAY_MS },
    };
    const required = await createActivity(t, "Pushups", {
      type: "period",
      period: "week",
      targetCount: 2,
    });
    const optionalA = await createActivity(t, "Walk", {
      type: "period",
      period: "week",
      targetCount: 2,
    });
    const optionalB = await createActivity(t, "Stretch", {
      type: "period",
      period: "week",
      targetCount: 1,
    });

    const { scorecardId } = await t.mutation(
      internal.scorecards.manageFromMcp,
      {
        userId: "user-1",
        now: 10 * DAY_MS,
        operation: {
          type: "scorecard.create",
          name: "Exercise",
          tagIds: [],
          members: [
            { signalId: required.signalId, role: "required" },
            { signalId: optionalA.signalId, role: "optional" },
            { signalId: optionalB.signalId, role: "optional" },
          ],
          optionalQuota: 2,
        },
      },
    );

    await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId: required.signalId,
      idempotencyKey: "req-1",
      operation: { type: "activity.occurred" },
      now: 10 * DAY_MS,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId: optionalA.signalId,
      idempotencyKey: "opt-a-1",
      operation: { type: "activity.occurred" },
      now: 10 * DAY_MS,
      soonWindowMs: DAY_MS,
      periodBounds,
    });

    const listed = await t.query(internal.scorecards.listForMcp, {
      userId: "user-1",
      now: 10 * DAY_MS,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    expect(listed.scorecards[0].evaluation).toMatchObject({
      isComplete: false,
      optionalDoneCount: 0,
    });
    expect(listed.scorecards[0].evaluation.ratio).toBeCloseTo((0.5 + 0.5) / 3);

    await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId: required.signalId,
      idempotencyKey: "req-2",
      operation: { type: "activity.occurred", occurredAt: 10 * DAY_MS + 1 },
      now: 10 * DAY_MS + 1,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId: optionalA.signalId,
      idempotencyKey: "opt-a-2",
      operation: { type: "activity.occurred", occurredAt: 10 * DAY_MS + 2 },
      now: 10 * DAY_MS + 2,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId: optionalB.signalId,
      idempotencyKey: "opt-b-1",
      operation: { type: "activity.occurred", occurredAt: 10 * DAY_MS + 3 },
      now: 10 * DAY_MS + 3,
      soonWindowMs: DAY_MS,
      periodBounds,
    });

    const complete = await t.query(internal.scorecards.listForMcp, {
      userId: "user-1",
      now: 10 * DAY_MS + 3,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    expect(complete.scorecards[0].evaluation).toMatchObject({
      ratio: 1,
      isComplete: true,
      optionalDoneCount: 2,
    });

    const dashboard = await t.query(internal.signals.listForMcp, {
      userId: "user-1",
      now: 10 * DAY_MS + 3,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    const requiredItem = dashboard.signals.find(
      (signal) => signal.id === required.signalId,
    );
    expect(requiredItem?.evaluation).toMatchObject({
      ratio: 1,
      isComplete: true,
    });
    expect(requiredItem?.scorecards).toEqual([
      {
        id: scorecardId,
        name: "Exercise",
        role: "required",
      },
    ]);

    await t.mutation(internal.scorecards.manageFromMcp, {
      userId: "user-1",
      now: 11 * DAY_MS,
      operation: {
        type: "scorecard.archive",
        scorecardId,
        archived: true,
      },
    });
    const afterArchive = await t.query(internal.signals.listForMcp, {
      userId: "user-1",
      now: 10 * DAY_MS + 3,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    expect(
      afterArchive.signals.find((signal) => signal.id === required.signalId)
        ?.scorecards,
    ).toEqual([]);
  });

  it("rejects invalid members, quota, and foreign signals", async () => {
    const t = convexTest(schema, modules);
    const owned = await createActivity(t, "Run");
    const foreign = await t.mutation(internal.signals.manageFromMcp, {
      userId: "user-2",
      now: 10 * DAY_MS,
      operation: {
        type: "activity.create",
        name: "Other",
        tagIds: [],
      },
    });
    const archived = await createActivity(t, "Old");
    await t.mutation(internal.signals.manageFromMcp, {
      userId: "user-1",
      now: 10 * DAY_MS,
      operation: {
        type: "signal.archive",
        signalId: archived.signalId,
        archived: true,
      },
    });

    await expect(
      t.mutation(internal.scorecards.manageFromMcp, {
        userId: "user-1",
        now: 10 * DAY_MS,
        operation: {
          type: "scorecard.create",
          name: "Bad",
          tagIds: [],
          members: [],
          optionalQuota: 0,
        },
      }),
    ).rejects.toThrow(/at least one member/);

    await expect(
      t.mutation(internal.scorecards.manageFromMcp, {
        userId: "user-1",
        now: 10 * DAY_MS,
        operation: {
          type: "scorecard.create",
          name: "Dup",
          tagIds: [],
          members: [
            { signalId: owned.signalId, role: "required" },
            { signalId: owned.signalId, role: "optional" },
          ],
          optionalQuota: 0,
        },
      }),
    ).rejects.toThrow(/unique/);

    await expect(
      t.mutation(internal.scorecards.manageFromMcp, {
        userId: "user-1",
        now: 10 * DAY_MS,
        operation: {
          type: "scorecard.create",
          name: "Quota",
          tagIds: [],
          members: [{ signalId: owned.signalId, role: "required" }],
          optionalQuota: 1,
        },
      }),
    ).rejects.toThrow(/optionalQuota/);

    await expect(
      t.mutation(internal.scorecards.manageFromMcp, {
        userId: "user-1",
        now: 10 * DAY_MS,
        operation: {
          type: "scorecard.create",
          name: "Foreign",
          tagIds: [],
          members: [{ signalId: foreign.signalId, role: "required" }],
          optionalQuota: 0,
        },
      }),
    ).rejects.toThrow(/invalid for this user/);

    await expect(
      t.mutation(internal.scorecards.manageFromMcp, {
        userId: "user-1",
        now: 10 * DAY_MS,
        operation: {
          type: "scorecard.create",
          name: "Archived",
          tagIds: [],
          members: [{ signalId: archived.signalId, role: "required" }],
          optionalQuota: 0,
        },
      }),
    ).rejects.toThrow(/Archived signals/);
  });

  it("enforces tag-root isolation", async () => {
    const t = convexTest(schema, modules);
    const { exerciseTagId } = await t.run(async (ctx) => {
      const exerciseTagId = await ctx.db.insert("tags", {
        userId: "user-1",
        name: "Exercise",
        parentId: null,
        childrenRecursive: [],
      });
      return { exerciseTagId };
    });
    const signal = await t.mutation(internal.signals.manageFromMcp, {
      userId: "user-1",
      now: 10 * DAY_MS,
      operation: {
        type: "activity.create",
        name: "Run",
        tagIds: [exerciseTagId],
      },
    });
    const { scorecardId } = await t.mutation(
      internal.scorecards.manageFromMcp,
      {
        userId: "user-1",
        tagRootId: exerciseTagId,
        now: 10 * DAY_MS,
        operation: {
          type: "scorecard.create",
          name: "Workout",
          tagIds: [],
          members: [{ signalId: signal.signalId, role: "required" }],
          optionalQuota: 0,
        },
      },
    );
    const created = await t.run(async (ctx) => {
      return await ctx.db.get("scorecards", scorecardId);
    });
    expect(created?.tagIds).toEqual([exerciseTagId]);

    const outside = await createActivity(t, "Untagged");
    const { scorecardId: outsideId } = await t.mutation(
      internal.scorecards.manageFromMcp,
      {
        userId: "user-1",
        now: 10 * DAY_MS,
        operation: {
          type: "scorecard.create",
          name: "Outside",
          tagIds: [],
          members: [{ signalId: outside.signalId, role: "required" }],
          optionalQuota: 0,
        },
      },
    );
    const scoped = await t.query(internal.scorecards.listForMcp, {
      userId: "user-1",
      tagRootId: exerciseTagId,
      now: 10 * DAY_MS,
      soonWindowMs: DAY_MS,
    });
    expect(scoped.scorecards.map((scorecard) => scorecard.id)).toEqual([
      scorecardId,
    ]);
    await expect(
      t.query(internal.scorecards.listForMcp, {
        userId: "user-1",
        tagRootId: exerciseTagId,
        scorecardId: outsideId,
        now: 10 * DAY_MS,
        soonWindowMs: DAY_MS,
      }),
    ).rejects.toThrow(/authorized tag root/);
  });

  it("nests scorecards, rejects cycles, and writes type on legacy input", async () => {
    const t = convexTest(schema, modules);
    const periodBounds = {
      day: { startAt: 10 * DAY_MS, endAt: 11 * DAY_MS },
      week: { startAt: 7 * DAY_MS, endAt: 14 * DAY_MS },
    };
    const squat = await createActivity(t, "Squats", {
      type: "period",
      period: "week",
      targetCount: 0,
    });
    const bench = await createActivity(t, "Bench", {
      type: "period",
      period: "week",
      targetCount: 0,
    });
    const row = await createActivity(t, "Row", {
      type: "period",
      period: "week",
      targetCount: 0,
    });
    const run = await createActivity(t, "Run", {
      type: "period",
      period: "week",
      targetCount: 0,
    });

    const { scorecardId: strengthId } = await t.mutation(
      internal.scorecards.manageFromMcp,
      {
        userId: "user-1",
        now: 10 * DAY_MS,
        operation: {
          type: "scorecard.create",
          name: "Lifting session",
          tagIds: [],
          members: [
            { type: "signal", signalId: squat.signalId, role: "optional" },
            { type: "signal", signalId: bench.signalId, role: "optional" },
            { type: "signal", signalId: row.signalId, role: "optional" },
          ],
          optionalQuota: 3,
        },
      },
    );
    const { scorecardId: exerciseId } = await t.mutation(
      internal.scorecards.manageFromMcp,
      {
        userId: "user-1",
        now: 10 * DAY_MS,
        operation: {
          type: "scorecard.create",
          name: "Exercise",
          tagIds: [],
          members: [
            { type: "signal", signalId: run.signalId, role: "optional" },
            { type: "scorecard", scorecardId: strengthId, role: "optional" },
          ],
          optionalQuota: 1,
        },
      },
    );

    await expect(
      t.mutation(internal.scorecards.manageFromMcp, {
        userId: "user-1",
        now: 10 * DAY_MS,
        operation: {
          type: "scorecard.update",
          scorecardId: strengthId,
          members: [
            { type: "scorecard", scorecardId: exerciseId, role: "optional" },
          ],
        },
      }),
    ).rejects.toThrow(/cycle/);

    await expect(
      t.mutation(internal.scorecards.manageFromMcp, {
        userId: "user-1",
        now: 10 * DAY_MS,
        operation: {
          type: "scorecard.update",
          scorecardId: exerciseId,
          members: [
            { type: "scorecard", scorecardId: exerciseId, role: "optional" },
          ],
        },
      }),
    ).rejects.toThrow(/itself/);

    const stored = await t.run(async (ctx) => {
      return await ctx.db.get("scorecards", strengthId);
    });
    expect(stored?.members).toEqual([
      { type: "signal", signalId: squat.signalId, role: "optional" },
      { type: "signal", signalId: bench.signalId, role: "optional" },
      { type: "signal", signalId: row.signalId, role: "optional" },
    ]);

    await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId: squat.signalId,
      idempotencyKey: "squat-1",
      operation: { type: "activity.occurred" },
      now: 10 * DAY_MS,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId: bench.signalId,
      idempotencyKey: "bench-1",
      operation: { type: "activity.occurred" },
      now: 10 * DAY_MS,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId: row.signalId,
      idempotencyKey: "row-1",
      operation: { type: "activity.occurred" },
      now: 10 * DAY_MS,
      soonWindowMs: DAY_MS,
      periodBounds,
    });

    const listed = await t.query(internal.scorecards.listForMcp, {
      userId: "user-1",
      now: 10 * DAY_MS,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    const exercise = listed.scorecards.find((card) => card.id === exerciseId);
    const strength = listed.scorecards.find((card) => card.id === strengthId);
    expect(strength?.evaluation).toMatchObject({
      isComplete: true,
      optionalDoneCount: 3,
      count: 1,
    });
    expect(exercise?.evaluation).toMatchObject({
      isComplete: true,
      optionalDoneCount: 1,
      count: 1,
    });
    expect(exercise?.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "scorecard",
          scorecardId: strengthId,
          name: "Lifting session",
          evaluation: expect.objectContaining({
            isComplete: true,
            reason: "3 of 3",
          }),
        }),
      ]),
    );

    const { scorecardId: legacyCreateId } = await t.mutation(
      internal.scorecards.manageFromMcp,
      {
        userId: "user-1",
        now: 10 * DAY_MS,
        operation: {
          type: "scorecard.create",
          name: "Legacy input",
          tagIds: [],
          members: [{ signalId: run.signalId, role: "required" }],
          optionalQuota: 0,
        },
      },
    );
    const written = await t.run(async (ctx) => {
      return await ctx.db.get("scorecards", legacyCreateId);
    });
    expect(written?.members).toEqual([
      { type: "signal", signalId: run.signalId, role: "required" },
    ]);
  });

  it("sums period and nested counts against targetCount", async () => {
    const t = convexTest(schema, modules);
    const periodBounds = {
      day: { startAt: 10 * DAY_MS, endAt: 11 * DAY_MS },
      week: { startAt: 7 * DAY_MS, endAt: 14 * DAY_MS },
    };
    const run = await createActivity(t, "Run", {
      type: "period",
      period: "week",
      targetCount: 2,
    });
    const climb = await createActivity(t, "Climb", {
      type: "period",
      period: "week",
      targetCount: 0,
    });
    const squat = await createActivity(t, "Squats", {
      type: "period",
      period: "week",
      targetCount: 0,
    });
    const bench = await createActivity(t, "Bench", {
      type: "period",
      period: "week",
      targetCount: 0,
    });
    const row = await createActivity(t, "Row", {
      type: "period",
      period: "week",
      targetCount: 0,
    });

    const { scorecardId: liftingId } = await t.mutation(
      internal.scorecards.manageFromMcp,
      {
        userId: "user-1",
        now: 10 * DAY_MS,
        operation: {
          type: "scorecard.create",
          name: "Lifting session",
          tagIds: [],
          members: [
            { type: "signal", signalId: squat.signalId, role: "optional" },
            { type: "signal", signalId: bench.signalId, role: "optional" },
            { type: "signal", signalId: row.signalId, role: "optional" },
          ],
          optionalQuota: 3,
        },
      },
    );
    const { scorecardId: exerciseId } = await t.mutation(
      internal.scorecards.manageFromMcp,
      {
        userId: "user-1",
        now: 10 * DAY_MS,
        operation: {
          type: "scorecard.create",
          name: "Exercise",
          tagIds: [],
          members: [
            { type: "signal", signalId: run.signalId, role: "optional" },
            { type: "signal", signalId: climb.signalId, role: "optional" },
            { type: "scorecard", scorecardId: liftingId, role: "optional" },
          ],
          optionalQuota: 0,
          targetCount: 5,
        },
      },
    );

    await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId: run.signalId,
      idempotencyKey: "run-1",
      operation: { type: "activity.occurred" },
      now: 10 * DAY_MS,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId: run.signalId,
      idempotencyKey: "run-2",
      operation: { type: "activity.occurred" },
      now: 10 * DAY_MS + 1,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId: climb.signalId,
      idempotencyKey: "climb-1",
      operation: { type: "activity.occurred" },
      now: 10 * DAY_MS,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId: squat.signalId,
      idempotencyKey: "squat-1",
      operation: { type: "activity.occurred" },
      now: 10 * DAY_MS,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId: bench.signalId,
      idempotencyKey: "bench-1",
      operation: { type: "activity.occurred" },
      now: 10 * DAY_MS,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId: row.signalId,
      idempotencyKey: "row-1",
      operation: { type: "activity.occurred" },
      now: 10 * DAY_MS,
      soonWindowMs: DAY_MS,
      periodBounds,
    });

    const listed = await t.query(internal.scorecards.listForMcp, {
      userId: "user-1",
      now: 10 * DAY_MS,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    const exercise = listed.scorecards.find((card) => card.id === exerciseId);
    expect(exercise?.targetCount).toBe(5);
    expect(exercise?.evaluation).toMatchObject({
      isComplete: false,
      count: 4,
      ratio: 4 / 5,
    });

    await t.mutation(internal.signals.recordFromMcp, {
      userId: "user-1",
      signalId: run.signalId,
      idempotencyKey: "run-3",
      operation: { type: "activity.occurred" },
      now: 10 * DAY_MS + 2,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    const complete = await t.query(internal.scorecards.listForMcp, {
      userId: "user-1",
      now: 10 * DAY_MS,
      soonWindowMs: DAY_MS,
      periodBounds,
    });
    expect(
      complete.scorecards.find((card) => card.id === exerciseId)?.evaluation,
    ).toMatchObject({
      isComplete: true,
      count: 5,
      ratio: 1,
    });
  });
});
