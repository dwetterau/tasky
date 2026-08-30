import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  evaluateSignal,
  materializeInventory,
  projectInventory,
  type InventorySignalModel,
} from "./lib/signalStatus";

describe("signal status evaluation", () => {
  it("reports an activity with no entries as unknown", () => {
    expect(
      evaluateSignal(
        {
          kind: "activity",
          target: { type: "recency", dueAfterMs: 3 * DAY_MS },
        },
        10 * DAY_MS,
        DAY_MS,
      ),
    ).toMatchObject({
      attention: "unknown",
      ratio: 0,
      isComplete: false,
    });
  });

  it("handles activity soon and due boundaries", () => {
    const model = {
      kind: "activity" as const,
      target: {
        type: "recency" as const,
        dueAfterMs: 4 * DAY_MS,
      },
      lastOccurredAt: 2 * DAY_MS,
    };

    expect(evaluateSignal(model, 5 * DAY_MS, DAY_MS)).toMatchObject({
      attention: "soon",
      actionAt: 6 * DAY_MS,
      elapsedMs: 3 * DAY_MS,
      ratio: 0,
      isComplete: false,
    });
    expect(evaluateSignal(model, 6 * DAY_MS, DAY_MS)).toMatchObject({
      attention: "due",
      actionAt: 6 * DAY_MS,
      ratio: 0,
      isComplete: false,
    });
  });

  it("tracks completion targets within a calendar period", () => {
    const model = {
      kind: "activity" as const,
      target: {
        type: "period" as const,
        period: "week" as const,
        targetCount: 3,
      },
    };
    const progress = {
      period: "week" as const,
      startAt: 7 * DAY_MS,
      endAt: 14 * DAY_MS,
      completedCount: 2,
      targetCount: 3,
      remainingCount: 1,
    };

    expect(evaluateSignal(model, 10 * DAY_MS, DAY_MS, progress)).toMatchObject({
      attention: "due",
      actionAt: 14 * DAY_MS,
      periodProgress: {
        completedCount: 2,
        remainingCount: 1,
      },
      ratio: 2 / 3,
      isComplete: false,
    });
    expect(
      evaluateSignal(model, 10 * DAY_MS, DAY_MS, {
        ...progress,
        completedCount: 3,
        remainingCount: 0,
      }),
    ).toMatchObject({
      attention: "ok",
      periodProgress: {
        completedCount: 3,
        remainingCount: 0,
      },
      ratio: 1,
      isComplete: true,
    });
  });

  it("treats a zero weekly target as optional in-window completion", () => {
    const model = {
      kind: "activity" as const,
      target: {
        type: "period" as const,
        period: "week" as const,
        targetCount: 0,
      },
    };
    const progress = {
      period: "week" as const,
      startAt: 7 * DAY_MS,
      endAt: 14 * DAY_MS,
      completedCount: 0,
      targetCount: 0,
      remainingCount: 0,
    };

    expect(evaluateSignal(model, 10 * DAY_MS, DAY_MS, progress)).toMatchObject({
      attention: "ok",
      reason: "No activity this week",
      ratio: 0,
      isComplete: false,
    });
    expect(
      evaluateSignal(model, 10 * DAY_MS, DAY_MS, {
        ...progress,
        completedCount: 2,
      }),
    ).toMatchObject({
      attention: "ok",
      reason: "Recorded this week",
      ratio: 1,
      isComplete: true,
    });
  });

  it("projects draining inventory without writing daily events", () => {
    const model: InventorySignalModel = {
      kind: "inventory",
      unit: "pills",
      threshold: { value: 2, comparison: "atOrBelow" },
      flow: { amount: -1, everyDays: 1 },
      confirmedQuantity: 10,
      confirmedAt: 0,
      nextFlowAt: DAY_MS,
    };

    expect(projectInventory(model, 3 * DAY_MS)).toEqual({
      quantity: 7,
      completedSteps: 3,
      nextFlowAt: 4 * DAY_MS,
      isProjected: true,
    });
    expect(evaluateSignal(model, 3 * DAY_MS, 2 * DAY_MS)).toMatchObject({
      attention: "ok",
      actionAt: 8 * DAY_MS,
      projectedQuantity: 7,
      runwayMs: 5 * DAY_MS,
      isProjected: true,
      ratio: 1,
      isComplete: true,
    });
  });

  it("supports filling inventory and at-or-above thresholds", () => {
    const model: InventorySignalModel = {
      kind: "inventory",
      unit: "loads",
      threshold: { value: 5, comparison: "atOrAbove" },
      flow: { amount: 1, everyDays: 2 },
      confirmedQuantity: 2,
      confirmedAt: 0,
      nextFlowAt: 2 * DAY_MS,
    };

    expect(evaluateSignal(model, 2 * DAY_MS, 4 * DAY_MS)).toMatchObject({
      attention: "soon",
      actionAt: 6 * DAY_MS,
      projectedQuantity: 3,
      ratio: 0,
      isComplete: false,
    });
    expect(evaluateSignal(model, 6 * DAY_MS, 4 * DAY_MS)).toMatchObject({
      attention: "due",
      projectedQuantity: 5,
      ratio: 0,
      isComplete: false,
    });
  });

  it("materializes projection as a new anchor and never goes negative", () => {
    const model: InventorySignalModel = {
      kind: "inventory",
      unit: "pills",
      threshold: { value: 2, comparison: "atOrBelow" },
      flow: { amount: -3, everyDays: 1 },
      confirmedQuantity: 4,
      confirmedAt: 0,
      nextFlowAt: DAY_MS,
    };

    expect(materializeInventory(model, 3 * DAY_MS)).toMatchObject({
      confirmedQuantity: 0,
      confirmedAt: 3 * DAY_MS,
      nextFlowAt: 4 * DAY_MS,
    });
  });
});
