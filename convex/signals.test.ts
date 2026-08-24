import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { DAY_MS } from "./lib/signalStatus";
import { modules } from "./test.setup";

describe("signals backend", () => {
  it("records activity entries idempotently and keeps the latest occurrence", async () => {
    const t = convexTest(schema, modules);
    const { signalId } = await t.mutation(
      internal.signals.manageFromMcp,
      {
        userId: "user-1",
        now: 10 * DAY_MS,
        operation: {
          type: "activity.create",
          name: "Run",
          category: "Exercise",
          dueAfterMs: 4 * DAY_MS,
        },
      },
    );

    const first = await t.mutation(
      internal.signals.recordFromMcp,
      {
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
      },
    );
    const replay = await t.mutation(
      internal.signals.recordFromMcp,
      {
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
      },
    );
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
        .withIndex("by_signal_effective_at", (q) =>
          q.eq("signalId", signalId),
        )
        .collect();
    });
    expect(entries).toHaveLength(2);

    const [dashboardSignal] = await t.query(
      internal.signals.listForMcp,
      {
        userId: "user-1",
        now: 11 * DAY_MS,
        soonWindowMs: DAY_MS,
      },
    );
    expect(dashboardSignal.model).toMatchObject({
      kind: "activity",
      lastOccurredAt: 9 * DAY_MS,
    });
  });

  it("materializes scheduled inventory before applying an adjustment", async () => {
    const t = convexTest(schema, modules);
    const { signalId } = await t.mutation(
      internal.signals.manageFromMcp,
      {
        userId: "user-1",
        now: 0,
        operation: {
          type: "inventory.create",
          name: "Prescription",
          category: "Care",
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
      },
    );

    const projected = await t.query(internal.signals.listForMcp, {
      userId: "user-1",
      now: 3 * DAY_MS,
      soonWindowMs: DAY_MS,
    });
    expect(projected[0].evaluation).toMatchObject({
      projectedQuantity: 7,
      isProjected: true,
    });

    const result = await t.mutation(
      internal.signals.recordFromMcp,
      {
        userId: "user-1",
        signalId,
        idempotencyKey: "dose-adjustment",
        operation: {
          type: "inventory.adjusted",
          amount: -1,
        },
        now: 3 * DAY_MS,
        soonWindowMs: DAY_MS,
      },
    );
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
      },
    });
    const second = await t.mutation(internal.signals.manageFromMcp, {
      userId: "user-1",
      now: 1,
      operation: {
        type: "activity.create",
        name: "Climbing",
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
});
