export type ScorecardMemberRole = "required" | "optional";

export type ScorecardMemberInput = {
  role: ScorecardMemberRole;
  ratio: number;
  count?: number;
};

export type ScorecardEvaluation = {
  ratio: number;
  isComplete: boolean;
  optionalDoneCount: number;
  count: number;
  attention?: "ok" | "soon" | "due";
  actionAt?: number;
  reason?: string;
  scheduleProgress?: {
    period: "day" | "week" | "month";
    startAt: number;
    endAt: number;
    completedCount: number;
    targetCount: number;
    remainingCount: number;
    requiredCountByNow: number;
    overdueCount: number;
    nextDueAt?: number;
  };
};

function clampedRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 0;
  }
  return Math.min(1, ratio);
}

function memberCount(member: ScorecardMemberInput): number {
  if (member.count !== undefined && Number.isFinite(member.count)) {
    return Math.max(0, member.count);
  }
  return clampedRatio(member.ratio) >= 1 ? 1 : 0;
}

export function evaluateScorecard(
  members: ScorecardMemberInput[],
  optionalQuota: number,
  targetCount?: number,
): ScorecardEvaluation {
  const requiredRatios: number[] = [];
  const optionalRatios: number[] = [];
  for (const member of members) {
    const ratio = clampedRatio(member.ratio);
    if (member.role === "required") {
      requiredRatios.push(ratio);
    } else {
      optionalRatios.push(ratio);
    }
  }

  const optionalDoneCount = optionalRatios.filter((ratio) => ratio >= 1).length;
  const requiredComplete = requiredRatios.every((ratio) => ratio >= 1);
  const requiredCount = requiredRatios.length;

  if (targetCount !== undefined && targetCount > 0) {
    const count = members.reduce((sum, member) => sum + memberCount(member), 0);
    const isComplete = requiredComplete && count >= targetCount;
    return {
      ratio: isComplete ? 1 : Math.min(1, count / targetCount),
      isComplete,
      optionalDoneCount,
      count,
    };
  }

  const slots = requiredCount + optionalQuota;

  let isComplete = requiredComplete && optionalDoneCount >= optionalQuota;
  if (requiredCount === 0 && optionalQuota === 0) {
    isComplete = optionalRatios.some((ratio) => ratio >= 1);
  }

  let ratio: number;
  if (slots === 0) {
    ratio = optionalRatios.length === 0 ? 0 : Math.max(...optionalRatios);
  } else {
    const requiredSum = requiredRatios.reduce((sum, value) => sum + value, 0);
    const optionalCredit =
      optionalQuota === 0
        ? 0
        : Math.min(
            optionalQuota,
            optionalRatios.reduce((sum, value) => sum + value, 0),
          );
    ratio = (requiredSum + optionalCredit) / slots;
  }

  if (isComplete) {
    ratio = 1;
  }

  const count =
    optionalQuota > 0
      ? Math.floor(optionalDoneCount / optionalQuota)
      : isComplete
        ? 1
        : 0;

  return {
    ratio,
    isComplete,
    optionalDoneCount,
    count,
  };
}

export function withScorecardAttention(
  evaluation: ScorecardEvaluation,
  now: number,
  soonWindowMs: number,
  scheduleProgress?: NonNullable<
    ScorecardEvaluation["scheduleProgress"]
  >,
): ScorecardEvaluation {
  if (!scheduleProgress) {
    return {
      ...evaluation,
      attention: evaluation.isComplete ? "ok" : "due",
      reason: evaluation.isComplete ? "Scorecard is complete" : "Scorecard is incomplete",
    };
  }
  const nextDueAt = scheduleProgress.nextDueAt;
  const attention =
    evaluation.isComplete
      ? "ok"
      : scheduleProgress.overdueCount > 0 ||
          scheduleProgress.completedCount >= scheduleProgress.targetCount
        ? "due"
        : nextDueAt !== undefined && nextDueAt - now <= soonWindowMs
          ? "soon"
          : "ok";
  return {
    ...evaluation,
    attention,
    actionAt: evaluation.isComplete ? undefined : nextDueAt,
    reason:
      !evaluation.isComplete &&
      scheduleProgress.completedCount >= scheduleProgress.targetCount
        ? "Required members are still incomplete"
        : scheduleProgress.overdueCount > 0
        ? `${scheduleProgress.completedCount} of ${scheduleProgress.requiredCountByNow} due checkpoints completed`
        : `${scheduleProgress.completedCount} of ${scheduleProgress.targetCount} completed this ${scheduleProgress.period}`,
    scheduleProgress,
  };
}
