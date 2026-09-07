import type { Id } from "../_generated/dataModel";

export type ScorecardMemberRole = "required" | "optional";

export type SignalScorecardMember = {
  type: "signal";
  signalId: Id<"signals">;
  role: ScorecardMemberRole;
};

export type NestedScorecardMember = {
  type: "scorecard";
  scorecardId: Id<"scorecards">;
  role: ScorecardMemberRole;
};

export type NormalizedScorecardMember =
  | SignalScorecardMember
  | NestedScorecardMember;

export type LooseScorecardMember =
  | NormalizedScorecardMember
  | {
      type?: "signal";
      signalId: Id<"signals">;
      role: ScorecardMemberRole;
    };

export function isNestedMember(
  member: LooseScorecardMember,
): member is NestedScorecardMember {
  return member.type === "scorecard";
}

export function normalizeMember(
  member: LooseScorecardMember,
): NormalizedScorecardMember {
  if (isNestedMember(member)) {
    return {
      type: "scorecard",
      scorecardId: member.scorecardId,
      role: member.role,
    };
  }
  return {
    type: "signal",
    signalId: member.signalId,
    role: member.role,
  };
}

export function memberKey(member: NormalizedScorecardMember): string {
  return member.type === "signal"
    ? `signal:${member.signalId}`
    : `scorecard:${member.scorecardId}`;
}
