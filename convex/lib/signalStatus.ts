export const DAY_MS = 24 * 60 * 60 * 1000;

export type SignalAttention = "ok" | "soon" | "due" | "unknown";
export type InventoryComparison = "atOrBelow" | "atOrAbove";

export type ActivityTarget =
  | {
      type: "recency";
      dueAfterMs: number;
    }
  | {
      type: "period";
      period: "day" | "week" | "month";
      targetCount: number;
    }
  | {
      type: "schedule";
      schedule: {
        rrule: string;
        startDate: string;
        due:
          | { type: "evenly_spaced" }
          | { type: "weekdays"; weekdays: number[] };
      };
      targetCount: number;
    };

export type ActivitySignalModel = {
  kind: "activity";
  target?: ActivityTarget;
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

export type SignalEvaluationBase = {
  attention: SignalAttention;
  actionAt?: number;
  reason: string;
  elapsedMs?: number;
  periodProgress?: ActivityPeriodProgress;
  projectedQuantity?: number;
  runwayMs?: number;
  confirmedAt?: number;
  isProjected?: boolean;
  nextFlowAt?: number;
};

export type SignalEvaluation = SignalEvaluationBase & {
  ratio: number;
  isComplete: boolean;
};

export type SignalActionabilityTier =
  | "overdue"
  | "ready"
  | "later"
  | "cooldown"
  | "idle"
  | "complete";

export type SignalActionability = {
  tier: SignalActionabilityTier;
  rank: number;
  reason: string;
  actionAt?: number;
  paceDelta?: number;
};

export type ActivityPeriodProgress = {
  period: "day" | "week" | "month";
  startAt: number;
  endAt: number;
  completedCount: number;
  targetCount: number;
  remainingCount: number;
  requiredCountByNow?: number;
  overdueCount?: number;
  nextDueAt?: number;
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
    stepsNeeded = Math.ceil((projected.quantity - value) / -model.flow.amount);
  } else if (comparison === "atOrAbove" && model.flow.amount > 0) {
    stepsNeeded = Math.ceil((value - projected.quantity) / model.flow.amount);
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
  periodProgress?: ActivityPeriodProgress,
): SignalEvaluationBase {
  if (
    model.target?.type === "period" ||
    model.target?.type === "schedule"
  ) {
    if (!periodProgress) {
      return {
        attention: "unknown",
        reason: "Calendar period could not be evaluated",
        elapsedMs:
          model.lastOccurredAt === undefined
            ? undefined
            : Math.max(0, now - model.lastOccurredAt),
      };
    }
    const hasTarget = periodProgress.targetCount > 0;
    const targetMet =
      hasTarget && periodProgress.completedCount >= periodProgress.targetCount;
    const loggedThisPeriod = periodProgress.completedCount > 0;
    const requiredCountByNow =
      periodProgress.requiredCountByNow ?? periodProgress.targetCount;
    const overdueCount = Math.max(
      0,
      periodProgress.overdueCount ??
        requiredCountByNow - periodProgress.completedCount,
    );
    const nextDueAt = periodProgress.nextDueAt ?? periodProgress.endAt;
    const remainingToNext =
      nextDueAt === undefined ? undefined : nextDueAt - now;
    const attention: SignalAttention = targetMet
      ? "ok"
      : overdueCount > 0
        ? "due"
        : remainingToNext !== undefined && remainingToNext <= soonWindowMs
          ? "soon"
          : "ok";
    const reason = hasTarget
      ? overdueCount > 0
        ? `${periodProgress.completedCount} of ${requiredCountByNow} due checkpoints completed`
        : `${periodProgress.completedCount} of ${periodProgress.targetCount} completed this ${periodProgress.period}`
      : loggedThisPeriod
        ? `Recorded this ${periodProgress.period}`
        : `No activity this ${periodProgress.period}`;
    return {
      attention: hasTarget
        ? attention
        : loggedThisPeriod
          ? "ok"
          : "unknown",
      actionAt: hasTarget && !targetMet ? nextDueAt : undefined,
      reason,
      elapsedMs:
        model.lastOccurredAt === undefined
          ? undefined
          : Math.max(0, now - model.lastOccurredAt),
      periodProgress,
    };
  }

  if (model.lastOccurredAt === undefined) {
    return {
      attention: "unknown",
      reason: "No activity has been recorded",
    };
  }

  const elapsedMs = Math.max(0, now - model.lastOccurredAt);
  if (model.target === undefined) {
    return {
      attention: "ok",
      reason: "Activity recorded; no action threshold configured",
      elapsedMs,
    };
  }

  const actionAt = model.lastOccurredAt + model.target.dueAfterMs;
  const remainingMs = actionAt - now;
  const attention: SignalAttention =
    remainingMs <= 0 ? "due" : remainingMs <= soonWindowMs ? "soon" : "ok";

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
): SignalEvaluationBase {
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
    model.threshold.comparison === "atOrBelow" ? "at or below" : "at or above";

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

export function signalCompletionRatio(
  model: SignalModel,
  evaluation: SignalEvaluationBase,
): number {
  if (model.kind === "activity") {
    if (
      model.target?.type === "period" ||
      model.target?.type === "schedule"
    ) {
      const progress = evaluation.periodProgress;
      if (!progress) {
        return 0;
      }
      if (progress.targetCount <= 0) {
        return progress.completedCount > 0 ? 1 : 0;
      }
      return Math.min(1, progress.completedCount / progress.targetCount);
    }
    if (model.target === undefined) {
      return model.lastOccurredAt === undefined ? 0 : 1;
    }
    return evaluation.attention === "ok" ? 1 : 0;
  }
  return evaluation.attention === "ok" ? 1 : 0;
}

function withCompletion(
  model: SignalModel,
  evaluation: SignalEvaluationBase,
): SignalEvaluation {
  const ratio = signalCompletionRatio(model, evaluation);
  return {
    ...evaluation,
    ratio,
    isComplete: ratio >= 1,
  };
}

export function evaluateSignal(
  model: SignalModel,
  now: number,
  soonWindowMs: number,
  periodProgress?: ActivityPeriodProgress,
): SignalEvaluation {
  return withCompletion(
    model,
    model.kind === "activity"
      ? evaluateActivity(model, now, soonWindowMs, periodProgress)
      : evaluateInventory(model, now, soonWindowMs),
  );
}

const ACTIONABILITY_RANK: Record<SignalActionabilityTier, number> = {
  overdue: 0,
  ready: 1,
  later: 2,
  cooldown: 3,
  idle: 4,
  complete: 5,
};

function actionability(
  tier: SignalActionabilityTier,
  reason: string,
  evaluation: SignalEvaluation,
  paceDelta?: number,
): SignalActionability {
  return {
    tier,
    rank: ACTIONABILITY_RANK[tier],
    reason,
    actionAt: evaluation.actionAt,
    paceDelta,
  };
}

function periodActionability(
  model: ActivitySignalModel,
  evaluation: SignalEvaluation,
  now: number,
): SignalActionability {
  const progress = evaluation.periodProgress;
  if (!progress || progress.targetCount <= 0) {
    return actionability(
      "idle",
      "No completion is required in the current period",
      evaluation,
    );
  }

  const requiredCountByNow =
    progress.requiredCountByNow ?? progress.targetCount;
  const paceDelta = progress.completedCount - requiredCountByNow;
  if ((progress.overdueCount ?? Math.max(0, -paceDelta)) > 0) {
    return actionability(
      "overdue",
      "Behind the required pace",
      evaluation,
      paceDelta,
    );
  }

  const intervalMs =
    (progress.endAt - progress.startAt) / progress.targetCount;
  const cooldownMs = Math.min(DAY_MS, Math.max(60 * 60 * 1000, intervalMs / 2));
  const lastOccurredAt = model.lastOccurredAt;
  if (
    lastOccurredAt !== undefined &&
    now - lastOccurredAt >= 0 &&
    now - lastOccurredAt < cooldownMs
  ) {
    return actionability(
      "cooldown",
      paceDelta > 0
        ? `Recently completed and ${paceDelta} ahead of pace`
        : "Recently completed",
      evaluation,
      paceDelta,
    );
  }

  if (paceDelta > 0) {
    return actionability(
      "later",
      `${paceDelta} ahead of pace`,
      evaluation,
      paceDelta,
    );
  }

  const readinessLeadMs = Math.min(DAY_MS, intervalMs / 2);
  if (
    evaluation.actionAt !== undefined &&
    evaluation.actionAt - now > readinessLeadMs
  ) {
    return actionability(
      "later",
      "The next checkpoint is not yet actionable",
      evaluation,
      paceDelta,
    );
  }

  return actionability(
    "ready",
    "The next completion is actionable",
    evaluation,
    paceDelta,
  );
}

export function evaluateSignalActionability(
  model: SignalModel,
  evaluation: SignalEvaluation,
  now: number,
): SignalActionability {
  if (evaluation.isComplete) {
    return actionability("complete", "Target complete", evaluation);
  }

  if (model.kind === "activity") {
    if (
      model.target?.type === "period" ||
      model.target?.type === "schedule"
    ) {
      return periodActionability(model, evaluation, now);
    }
    if (evaluation.attention === "due") {
      return actionability("overdue", evaluation.reason, evaluation);
    }
    if (model.target?.type === "recency") {
      return actionability(
        model.lastOccurredAt === undefined || evaluation.attention === "soon"
          ? "ready"
          : "later",
        model.lastOccurredAt === undefined
          ? "No activity has been recorded"
          : evaluation.reason,
        evaluation,
      );
    }
    return actionability(
      "idle",
      "No action threshold is configured",
      evaluation,
    );
  }

  if (evaluation.attention === "due") {
    return actionability("overdue", evaluation.reason, evaluation);
  }

  if (evaluation.attention !== "soon") {
    return actionability("idle", evaluation.reason, evaluation);
  }
  const readinessLeadMs = Math.min(
    DAY_MS,
    model.flow ? (model.flow.everyDays * DAY_MS) / 2 : DAY_MS,
  );
  return actionability(
    evaluation.actionAt !== undefined &&
      evaluation.actionAt - now > readinessLeadMs
      ? "later"
      : "ready",
    evaluation.reason,
    evaluation,
  );
}
