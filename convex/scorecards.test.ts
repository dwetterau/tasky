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
});
