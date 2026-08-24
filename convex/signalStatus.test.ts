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
        { kind: "activity", dueAfterMs: 3 * DAY_MS },
        10 * DAY_MS,
        DAY_MS,
      ),
    ).toMatchObject({
      attention: "unknown",
    });
  });

  it("handles activity soon and due boundaries", () => {
    const model = {
      kind: "activity" as const,
      dueAfterMs: 4 * DAY_MS,
      lastOccurredAt: 2 * DAY_MS,
    };

    expect(
      evaluateSignal(model, 5 * DAY_MS, DAY_MS),
    ).toMatchObject({
      attention: "soon",
      actionAt: 6 * DAY_MS,
      elapsedMs: 3 * DAY_MS,
    });
    expect(
      evaluateSignal(model, 6 * DAY_MS, DAY_MS),
    ).toMatchObject({
      attention: "due",
      actionAt: 6 * DAY_MS,
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
    expect(
      evaluateSignal(model, 3 * DAY_MS, 2 * DAY_MS),
    ).toMatchObject({
      attention: "ok",
      actionAt: 8 * DAY_MS,
      projectedQuantity: 7,
      runwayMs: 5 * DAY_MS,
      isProjected: true,
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

    expect(
      evaluateSignal(model, 2 * DAY_MS, 4 * DAY_MS),
    ).toMatchObject({
      attention: "soon",
      actionAt: 6 * DAY_MS,
      projectedQuantity: 3,
    });
    expect(
      evaluateSignal(model, 6 * DAY_MS, 4 * DAY_MS),
    ).toMatchObject({
      attention: "due",
      projectedQuantity: 5,
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
