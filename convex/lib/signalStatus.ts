export const DAY_MS = 24 * 60 * 60 * 1000;

export type SignalAttention = "ok" | "soon" | "due" | "unknown";
export type InventoryComparison = "atOrBelow" | "atOrAbove";

export type ActivitySignalModel = {
  kind: "activity";
  dueAfterMs?: number;
  lastOccurredAt?: number;
};

export type InventorySignalModel = {
  kind: "inventory";
  unit: string;
  threshold: {
    value: number;
    comparison: InventoryComparison;
  };
  flow?: {
    amount: number;
    everyDays: number;
  };
  confirmedQuantity: number;
  confirmedAt: number;
  nextFlowAt?: number;
};

export type SignalModel = ActivitySignalModel | InventorySignalModel;

export type SignalEvaluation = {
  attention: SignalAttention;
  actionAt?: number;
  reason: string;
  elapsedMs?: number;
  projectedQuantity?: number;
  runwayMs?: number;
  confirmedAt?: number;
  isProjected?: boolean;
  nextFlowAt?: number;
};

export type ProjectedInventory = {
  quantity: number;
  completedSteps: number;
  nextFlowAt?: number;
  isProjected: boolean;
};

function intervalMs(model: InventorySignalModel): number | undefined {
  if (!model.flow) {
    return undefined;
  }
  return model.flow.everyDays * DAY_MS;
}

function normalizedQuantity(quantity: number): number {
  return Math.max(0, quantity);
}

export function projectInventory(
  model: InventorySignalModel,
  now: number,
): ProjectedInventory {
  const interval = intervalMs(model);
  if (
    !model.flow ||
    model.nextFlowAt === undefined ||
    interval === undefined ||
    interval <= 0 ||
    now < model.nextFlowAt
  ) {
    return {
      quantity: normalizedQuantity(model.confirmedQuantity),
      completedSteps: 0,
      nextFlowAt: model.nextFlowAt,
      isProjected: false,
    };
  }

  const completedSteps = Math.floor((now - model.nextFlowAt) / interval) + 1;
  return {
    quantity: normalizedQuantity(
      model.confirmedQuantity + completedSteps * model.flow.amount,
    ),
    completedSteps,
    nextFlowAt: model.nextFlowAt + completedSteps * interval,
    isProjected: true,
  };
}

export function materializeInventory(
  model: InventorySignalModel,
  now: number,
): InventorySignalModel {
  const projected = projectInventory(model, now);
  return {
    ...model,
    confirmedQuantity: projected.quantity,
    confirmedAt: now,
    nextFlowAt: projected.nextFlowAt,
  };
}

function thresholdReached(
  quantity: number,
  comparison: InventoryComparison,
  threshold: number,
): boolean {
  return comparison === "atOrBelow"
    ? quantity <= threshold
    : quantity >= threshold;
}

function inventoryActionAt(
  model: InventorySignalModel,
  projected: ProjectedInventory,
  now: number,
): number | undefined {
  const { comparison, value } = model.threshold;
  if (thresholdReached(projected.quantity, comparison, value)) {
    return now;
  }

  const interval = intervalMs(model);
  if (
    !model.flow ||
    projected.nextFlowAt === undefined ||
    interval === undefined ||
    interval <= 0
  ) {
    return undefined;
  }

  let stepsNeeded: number;
  if (comparison === "atOrBelow" && model.flow.amount < 0) {
    stepsNeeded = Math.ceil(
      (projected.quantity - value) / -model.flow.amount,
    );
  } else if (comparison === "atOrAbove" && model.flow.amount > 0) {
    stepsNeeded = Math.ceil(
      (value - projected.quantity) / model.flow.amount,
    );
  } else {
    return undefined;
  }

  return projected.nextFlowAt + (Math.max(1, stepsNeeded) - 1) * interval;
}

function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity)
    ? String(quantity)
    : quantity.toFixed(2).replace(/\.?0+$/, "");
}

function evaluateActivity(
  model: ActivitySignalModel,
  now: number,
  soonWindowMs: number,
): SignalEvaluation {
  if (model.lastOccurredAt === undefined) {
    return {
      attention: "unknown",
      reason: "No activity has been recorded",
    };
  }

  const elapsedMs = Math.max(0, now - model.lastOccurredAt);
  if (model.dueAfterMs === undefined) {
    return {
      attention: "ok",
      reason: "Activity recorded; no action threshold configured",
      elapsedMs,
    };
  }

  const actionAt = model.lastOccurredAt + model.dueAfterMs;
  const remainingMs = actionAt - now;
  const attention: SignalAttention =
    remainingMs <= 0
      ? "due"
      : remainingMs <= soonWindowMs
        ? "soon"
        : "ok";

  return {
    attention,
    actionAt,
    reason:
      attention === "due"
        ? "Activity is due"
        : attention === "soon"
          ? "Activity will be due soon"
          : "Activity is on track",
    elapsedMs,
  };
}

function evaluateInventory(
  model: InventorySignalModel,
  now: number,
  soonWindowMs: number,
): SignalEvaluation {
  const projected = projectInventory(model, now);
  const actionAt = inventoryActionAt(model, projected, now);
  const isDue = thresholdReached(
    projected.quantity,
    model.threshold.comparison,
    model.threshold.value,
  );
  const runwayMs =
    actionAt === undefined ? undefined : Math.max(0, actionAt - now);
  const attention: SignalAttention = isDue
    ? "due"
    : runwayMs !== undefined && runwayMs <= soonWindowMs
      ? "soon"
      : "ok";
  const comparisonText =
    model.threshold.comparison === "atOrBelow"
      ? "at or below"
      : "at or above";

  return {
    attention,
    actionAt,
    reason: `${formatQuantity(projected.quantity)} ${model.unit} ${
      projected.isProjected ? "projected" : "confirmed"
    }; action ${comparisonText} ${formatQuantity(model.threshold.value)}`,
    projectedQuantity: projected.quantity,
    runwayMs,
    confirmedAt: model.confirmedAt,
    isProjected: projected.isProjected,
    nextFlowAt: projected.nextFlowAt,
  };
}

export function evaluateSignal(
  model: SignalModel,
  now: number,
  soonWindowMs: number,
): SignalEvaluation {
  return model.kind === "activity"
    ? evaluateActivity(model, now, soonWindowMs)
    : evaluateInventory(model, now, soonWindowMs);
}
