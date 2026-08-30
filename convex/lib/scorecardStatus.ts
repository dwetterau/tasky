export type ScorecardMemberRole = "required" | "optional";

export type ScorecardMemberInput = {
  role: ScorecardMemberRole;
  ratio: number;
};

export type ScorecardEvaluation = {
  ratio: number;
  isComplete: boolean;
  optionalDoneCount: number;
};

function clampedRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 0;
  }
  return Math.min(1, ratio);
}

export function evaluateScorecard(
  members: ScorecardMemberInput[],
  optionalQuota: number,
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

  return {
    ratio,
    isComplete,
    optionalDoneCount,
  };
}
