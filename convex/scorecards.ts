import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthUserId } from "./auth";
import { activityPeriod, scorecardMember, signalAttention } from "./schema";
import { evaluateScorecard } from "./lib/scorecardStatus";
import {
  DAY_MS,
  evaluateSignal,
  type ActivityPeriodProgress,
} from "./lib/signalStatus";

const periodRangeInput = v.object({
  startAt: v.number(),
  endAt: v.number(),
});
const periodBoundsInput = v.object({
  day: periodRangeInput,
  week: periodRangeInput,
  month: v.optional(periodRangeInput),
});

type PeriodRange = {
  startAt: number;
  endAt: number;
};

type PeriodBoundsInput = {
  day: PeriodRange;
  week: PeriodRange;
  month?: PeriodRange;
};

type PeriodBounds = PeriodBoundsInput & {
  month: PeriodRange;
};

const scorecardTagValidator = v.object({
  id: v.id("tags"),
  name: v.string(),
  color: v.optional(v.string()),
});

const signalEvaluationValidator = v.object({
  attention: signalAttention,
  actionAt: v.optional(v.number()),
  reason: v.string(),
  elapsedMs: v.optional(v.number()),
  periodProgress: v.optional(
    v.object({
      period: activityPeriod,
      startAt: v.number(),
      endAt: v.number(),
      completedCount: v.number(),
      targetCount: v.number(),
      remainingCount: v.number(),
    }),
  ),
  projectedQuantity: v.optional(v.number()),
  runwayMs: v.optional(v.number()),
  confirmedAt: v.optional(v.number()),
  isProjected: v.optional(v.boolean()),
  nextFlowAt: v.optional(v.number()),
  ratio: v.number(),
  isComplete: v.boolean(),
});

const scorecardMemberItemValidator = v.object({
  signalId: v.id("signals"),
  role: v.union(v.literal("required"), v.literal("optional")),
  name: v.string(),
  archived: v.boolean(),
  evaluation: signalEvaluationValidator,
});

const scorecardEvaluationValidator = v.object({
  ratio: v.number(),
  isComplete: v.boolean(),
  optionalDoneCount: v.number(),
});

const scorecardItemValidator = v.object({
  id: v.id("scorecards"),
  creationTime: v.number(),
  name: v.string(),
  tagIds: v.array(v.id("tags")),
  tags: v.array(scorecardTagValidator),
  members: v.array(scorecardMemberItemValidator),
  optionalQuota: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  archivedAt: v.optional(v.number()),
  evaluation: scorecardEvaluationValidator,
});

const manageOperationInput = v.union(
  v.object({
    type: v.literal("scorecard.create"),
    name: v.string(),
    tagIds: v.array(v.id("tags")),
    members: v.array(scorecardMember),
    optionalQuota: v.number(),
  }),
  v.object({
    type: v.literal("scorecard.update"),
    scorecardId: v.id("scorecards"),
    name: v.optional(v.string()),
    tagIds: v.optional(v.array(v.id("tags"))),
    members: v.optional(v.array(scorecardMember)),
    optionalQuota: v.optional(v.number()),
  }),
  v.object({
    type: v.literal("scorecard.archive"),
    scorecardId: v.id("scorecards"),
    archived: v.boolean(),
  }),
);

type ManageOperationInput =
  | {
      type: "scorecard.create";
      name: string;
      tagIds: Id<"tags">[];
      members: Array<{
        signalId: Id<"signals">;
        role: "required" | "optional";
      }>;
      optionalQuota: number;
    }
  | {
      type: "scorecard.update";
      scorecardId: Id<"scorecards">;
      name?: string;
      tagIds?: Id<"tags">[];
      members?: Array<{
        signalId: Id<"signals">;
        role: "required" | "optional";
      }>;
      optionalQuota?: number;
    }
  | {
      type: "scorecard.archive";
      scorecardId: Id<"scorecards">;
      archived: boolean;
    };

type ScorecardItem = {
  id: Id<"scorecards">;
  creationTime: number;
  name: string;
  tagIds: Id<"tags">[];
  tags: Array<{
    id: Id<"tags">;
    name: string;
    color?: string;
  }>;
  members: Array<{
    signalId: Id<"signals">;
    role: "required" | "optional";
    name: string;
    archived: boolean;
    evaluation: ReturnType<typeof evaluateSignal>;
  }>;
  optionalQuota: number;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  evaluation: ReturnType<typeof evaluateScorecard>;
};

function assertFiniteNumber(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
}

function assertNonNegative(value: number, field: string): void {
  assertFiniteNumber(value, field);
  if (value < 0) {
    throw new Error(`${field} must be zero or greater`);
  }
}

function normalizeRequiredText(
  value: string,
  field: string,
  maxLength: number,
): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${field} must be ${maxLength} characters or fewer`);
  }
  return normalized;
}

function normalizeTagIds(tagIds: Id<"tags">[]): Id<"tags">[] {
  return Array.from(new Set(tagIds));
}

async function assertOwnedTagIds(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  tagIds: Id<"tags">[],
): Promise<Id<"tags">[]> {
  const normalizedTagIds = normalizeTagIds(tagIds);
  const tags = await Promise.all(
    normalizedTagIds.map((tagId) => ctx.db.get("tags", tagId)),
  );
  if (tags.some((tag) => !tag || tag.userId !== userId)) {
    throw new Error("One or more tags are invalid for this user");
  }
  return normalizedTagIds;
}

async function getTagSubtreeIds(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  tagId: Id<"tags">,
): Promise<Set<Id<"tags">>> {
  const tag = await ctx.db.get("tags", tagId);
  if (!tag || tag.userId !== userId) {
    throw new Error("Tag not found or access denied");
  }
  return new Set([tagId, ...(tag.childrenRecursive ?? [])]);
}

async function assertScorecardInTagRoot(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  scorecard: Doc<"scorecards">,
  tagRootId: Id<"tags"> | undefined,
): Promise<void> {
  if (tagRootId === undefined) {
    return;
  }
  const allowedTagIds = await getTagSubtreeIds(ctx, userId, tagRootId);
  if (!scorecard.tagIds.some((tagId) => allowedTagIds.has(tagId))) {
    throw new Error("Scorecard is outside the authorized tag root");
  }
}

async function scopedScorecardTagIds(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  tagIds: Id<"tags">[],
  tagRootId: Id<"tags"> | undefined,
  addRoot: boolean,
): Promise<Id<"tags">[]> {
  const normalized = await assertOwnedTagIds(ctx, userId, tagIds);
  if (tagRootId === undefined) {
    return normalized;
  }
  const allowedTagIds = await getTagSubtreeIds(ctx, userId, tagRootId);
  if (normalized.some((tagId) => !allowedTagIds.has(tagId))) {
    throw new Error("Scorecard tags must stay inside the authorized tag root");
  }
  if (addRoot) {
    return normalizeTagIds([tagRootId, ...normalized]);
  }
  if (normalized.length === 0) {
    throw new Error("Scorecard tags must remain inside the authorized tag root");
  }
  return normalized;
}

function validateReadClock(now: number, soonWindowMs: number): void {
  assertFiniteNumber(now, "now");
  assertNonNegative(soonWindowMs, "soonWindowMs");
}

function utcPeriodBounds(now: number): PeriodBounds {
  const date = new Date(now);
  const dayStart = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  const weekStart = dayStart - daysSinceMonday * DAY_MS;
  const monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const monthEnd = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  return {
    day: {
      startAt: dayStart,
      endAt: dayStart + DAY_MS,
    },
    week: {
      startAt: weekStart,
      endAt: weekStart + 7 * DAY_MS,
    },
    month: {
      startAt: monthStart,
      endAt: monthEnd,
    },
  };
}

function resolvePeriodBounds(
  now: number,
  provided: PeriodBoundsInput | undefined,
): PeriodBounds {
  const fallback = utcPeriodBounds(now);
  const bounds: PeriodBounds = {
    day: provided?.day ?? fallback.day,
    week: provided?.week ?? fallback.week,
    month: provided?.month ?? fallback.month,
  };
  for (const [name, range] of Object.entries(bounds)) {
    assertFiniteNumber(range.startAt, `periodBounds.${name}.startAt`);
    assertFiniteNumber(range.endAt, `periodBounds.${name}.endAt`);
    if (
      range.startAt >= range.endAt ||
      now < range.startAt ||
      now >= range.endAt
    ) {
      throw new Error(
        `periodBounds.${name} must be an ordered range containing now`,
      );
    }
  }
  return bounds;
}

async function getActivityPeriodProgress(
  ctx: QueryCtx | MutationCtx,
  signal: Doc<"signals">,
  periodBounds: PeriodBounds,
): Promise<ActivityPeriodProgress | undefined> {
  if (
    signal.model.kind !== "activity" ||
    signal.model.target?.type !== "period"
  ) {
    return undefined;
  }
  const target = signal.model.target;
  const range = periodBounds[target.period];
  const entries = await ctx.db
    .query("signalEntries")
    .withIndex("by_signal_effective_at", (q) =>
      q
        .eq("signalId", signal._id)
        .gte("effectiveAt", range.startAt)
        .lt("effectiveAt", range.endAt),
    )
    .collect();
  const completedCount = entries.length;
  return {
    period: target.period,
    startAt: range.startAt,
    endAt: range.endAt,
    completedCount,
    targetCount: target.targetCount,
    remainingCount: Math.max(0, target.targetCount - completedCount),
  };
}

function missingSignalEvaluation() {
  return evaluateSignal(
    { kind: "activity" },
    0,
    0,
  );
}

async function normalizeMembers(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  members: Array<{
    signalId: Id<"signals">;
    role: "required" | "optional";
  }>,
  optionalQuota: number,
): Promise<
  Array<{
    signalId: Id<"signals">;
    role: "required" | "optional";
  }>
> {
  if (members.length === 0) {
    throw new Error("Scorecard must have at least one member");
  }
  const seen = new Set<Id<"signals">>();
  const normalized: Array<{
    signalId: Id<"signals">;
    role: "required" | "optional";
  }> = [];
  for (const member of members) {
    if (seen.has(member.signalId)) {
      throw new Error("Scorecard members must be unique");
    }
    seen.add(member.signalId);
    const signal = await ctx.db.get("signals", member.signalId);
    if (!signal || signal.userId !== userId) {
      throw new Error("One or more signals are invalid for this user");
    }
    if (signal.archivedAt !== undefined) {
      throw new Error("Archived signals cannot be added to a scorecard");
    }
    normalized.push({
      signalId: member.signalId,
      role: member.role,
    });
  }
  const optionalCount = normalized.filter(
    (member) => member.role === "optional",
  ).length;
  assertFiniteNumber(optionalQuota, "optionalQuota");
  if (!Number.isInteger(optionalQuota) || optionalQuota < 0) {
    throw new Error("optionalQuota must be a non-negative integer");
  }
  if (optionalQuota > optionalCount) {
    throw new Error("optionalQuota cannot exceed the number of optional members");
  }
  return normalized;
}

async function hydrateTags(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  tagIds: Id<"tags">[],
) {
  const tagDocuments = await Promise.all(
    tagIds.map((tagId) => ctx.db.get("tags", tagId)),
  );
  return tagDocuments
    .filter((tag): tag is Doc<"tags"> => tag !== null && tag.userId === userId)
    .map((tag) => ({
      id: tag._id,
      name: tag.name,
      color: tag.color,
    }));
}

async function toScorecardItem(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  scorecard: Doc<"scorecards">,
  now: number,
  soonWindowMs: number,
  periodBounds: PeriodBounds,
): Promise<ScorecardItem> {
  const tags = await hydrateTags(ctx, userId, scorecard.tagIds);
  const members = await Promise.all(
    scorecard.members.map(async (member) => {
      const signal = await ctx.db.get("signals", member.signalId);
      if (!signal || signal.userId !== userId) {
        return {
          signalId: member.signalId,
          role: member.role,
          name: "Unknown signal",
          archived: true,
          evaluation: missingSignalEvaluation(),
        };
      }
      const periodProgress = await getActivityPeriodProgress(
        ctx,
        signal,
        periodBounds,
      );
      return {
        signalId: signal._id,
        role: member.role,
        name: signal.name,
        archived: signal.archivedAt !== undefined,
        evaluation: evaluateSignal(
          signal.model,
          now,
          soonWindowMs,
          periodProgress,
        ),
      };
    }),
  );
  return {
    id: scorecard._id,
    creationTime: scorecard._creationTime,
    name: scorecard.name,
    tagIds: tags.map((tag) => tag.id),
    tags,
    members,
    optionalQuota: scorecard.optionalQuota,
    createdAt: scorecard.createdAt,
    updatedAt: scorecard.updatedAt,
    archivedAt: scorecard.archivedAt,
    evaluation: evaluateScorecard(
      members.map((member) => ({
        role: member.role,
        ratio: member.evaluation.ratio,
      })),
      scorecard.optionalQuota,
    ),
  };
}

async function getOwnedScorecard(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  scorecardId: Id<"scorecards">,
): Promise<Doc<"scorecards">> {
  const scorecard = await ctx.db.get("scorecards", scorecardId);
  if (!scorecard || scorecard.userId !== userId) {
    throw new Error("Scorecard not found or access denied");
  }
  return scorecard;
}

async function listScorecardsForUser(
  ctx: QueryCtx,
  args: {
    userId: string;
    now: number;
    soonWindowMs: number;
    periodBounds?: PeriodBoundsInput;
    tagId?: Id<"tags">;
    tagRootId?: Id<"tags">;
  },
): Promise<ScorecardItem[]> {
  validateReadClock(args.now, args.soonWindowMs);
  const periodBounds = resolvePeriodBounds(args.now, args.periodBounds);
  const matchingTagIds =
    args.tagId === undefined
      ? undefined
      : await getTagSubtreeIds(ctx, args.userId, args.tagId);
  const allowedRootTagIds =
    args.tagRootId === undefined
      ? undefined
      : await getTagSubtreeIds(ctx, args.userId, args.tagRootId);
  const scorecards = await ctx.db
    .query("scorecards")
    .withIndex("by_user_archived", (q) =>
      q.eq("userId", args.userId).eq("archivedAt", undefined),
    )
    .collect();
  const matching = scorecards.filter(
    (scorecard) =>
      (matchingTagIds === undefined ||
        scorecard.tagIds.some((tagId) => matchingTagIds.has(tagId))) &&
      (allowedRootTagIds === undefined ||
        scorecard.tagIds.some((tagId) => allowedRootTagIds.has(tagId))),
  );
  const items = await Promise.all(
    matching.map((scorecard) =>
      toScorecardItem(
        ctx,
        args.userId,
        scorecard,
        args.now,
        args.soonWindowMs,
        periodBounds,
      ),
    ),
  );
  return items.sort((left, right) => {
    if (left.evaluation.isComplete !== right.evaluation.isComplete) {
      return left.evaluation.isComplete ? 1 : -1;
    }
    return left.name.localeCompare(right.name);
  });
}

async function createScorecardForUser(
  ctx: MutationCtx,
  args: {
    userId: string;
    name: string;
    tagIds: Id<"tags">[];
    members: Array<{
      signalId: Id<"signals">;
      role: "required" | "optional";
    }>;
    optionalQuota: number;
    tagRootId?: Id<"tags">;
    now: number;
  },
): Promise<Id<"scorecards">> {
  const name = normalizeRequiredText(args.name, "name", 200);
  const tagIds = await scopedScorecardTagIds(
    ctx,
    args.userId,
    args.tagIds,
    args.tagRootId,
    true,
  );
  const members = await normalizeMembers(
    ctx,
    args.userId,
    args.members,
    args.optionalQuota,
  );
  return await ctx.db.insert("scorecards", {
    userId: args.userId,
    name,
    tagIds,
    members,
    optionalQuota: args.optionalQuota,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

async function updateScorecardForUser(
  ctx: MutationCtx,
  args: {
    userId: string;
    scorecardId: Id<"scorecards">;
    name?: string;
    tagIds?: Id<"tags">[];
    members?: Array<{
      signalId: Id<"signals">;
      role: "required" | "optional";
    }>;
    optionalQuota?: number;
    tagRootId?: Id<"tags">;
    now: number;
  },
): Promise<void> {
  const scorecard = await getOwnedScorecard(
    ctx,
    args.userId,
    args.scorecardId,
  );
  await assertScorecardInTagRoot(
    ctx,
    args.userId,
    scorecard,
    args.tagRootId,
  );
  const name =
    args.name === undefined
      ? scorecard.name
      : normalizeRequiredText(args.name, "name", 200);
  const tagIds =
    args.tagIds === undefined
      ? scorecard.tagIds
      : await scopedScorecardTagIds(
          ctx,
          args.userId,
          args.tagIds,
          args.tagRootId,
          false,
        );
  const membersInput = args.members ?? scorecard.members;
  const optionalQuota = args.optionalQuota ?? scorecard.optionalQuota;
  const members = await normalizeMembers(
    ctx,
    args.userId,
    membersInput,
    optionalQuota,
  );
  await ctx.db.patch("scorecards", scorecard._id, {
    name,
    tagIds,
    members,
    optionalQuota,
    updatedAt: args.now,
  });
}

async function setArchivedForUser(
  ctx: MutationCtx,
  args: {
    userId: string;
    scorecardId: Id<"scorecards">;
    archived: boolean;
    tagRootId?: Id<"tags">;
    now: number;
  },
): Promise<void> {
  const scorecard = await getOwnedScorecard(
    ctx,
    args.userId,
    args.scorecardId,
  );
  await assertScorecardInTagRoot(
    ctx,
    args.userId,
    scorecard,
    args.tagRootId,
  );
  await ctx.db.patch("scorecards", scorecard._id, {
    archivedAt: args.archived ? args.now : undefined,
    updatedAt: args.now,
  });
}

async function manageScorecardForUser(
  ctx: MutationCtx,
  args: {
    userId: string;
    tagRootId?: Id<"tags">;
    operation: ManageOperationInput;
    now: number;
  },
): Promise<Id<"scorecards">> {
  if (args.operation.type === "scorecard.create") {
    return await createScorecardForUser(ctx, {
      ...args.operation,
      userId: args.userId,
      tagRootId: args.tagRootId,
      now: args.now,
    });
  }
  if (args.operation.type === "scorecard.update") {
    await updateScorecardForUser(ctx, {
      ...args.operation,
      userId: args.userId,
      tagRootId: args.tagRootId,
      now: args.now,
    });
    return args.operation.scorecardId;
  }
  await setArchivedForUser(ctx, {
    ...args.operation,
    userId: args.userId,
    tagRootId: args.tagRootId,
    now: args.now,
  });
  return args.operation.scorecardId;
}

export const list = query({
  args: {
    now: v.number(),
    soonWindowMs: v.number(),
    periodBounds: v.optional(periodBoundsInput),
    tagId: v.optional(v.id("tags")),
  },
  returns: v.array(scorecardItemValidator),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }
    return await listScorecardsForUser(ctx, { ...args, userId });
  },
});

export const get = query({
  args: {
    scorecardId: v.id("scorecards"),
    now: v.number(),
    soonWindowMs: v.number(),
    periodBounds: v.optional(periodBoundsInput),
  },
  returns: v.union(scorecardItemValidator, v.null()),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    validateReadClock(args.now, args.soonWindowMs);
    const scorecard = await ctx.db.get("scorecards", args.scorecardId);
    if (!scorecard || scorecard.userId !== userId) {
      return null;
    }
    const periodBounds = resolvePeriodBounds(args.now, args.periodBounds);
    return await toScorecardItem(
      ctx,
      userId,
      scorecard,
      args.now,
      args.soonWindowMs,
      periodBounds,
    );
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    tagIds: v.array(v.id("tags")),
    members: v.array(scorecardMember),
    optionalQuota: v.number(),
  },
  returns: v.id("scorecards"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    return await createScorecardForUser(ctx, {
      ...args,
      userId,
      now: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    scorecardId: v.id("scorecards"),
    name: v.optional(v.string()),
    tagIds: v.optional(v.array(v.id("tags"))),
    members: v.optional(v.array(scorecardMember)),
    optionalQuota: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    await updateScorecardForUser(ctx, {
      ...args,
      userId,
      now: Date.now(),
    });
    return null;
  },
});

export const setArchived = mutation({
  args: {
    scorecardId: v.id("scorecards"),
    archived: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    await setArchivedForUser(ctx, {
      ...args,
      userId,
      now: Date.now(),
    });
    return null;
  },
});

export const listForMcp = internalQuery({
  args: {
    userId: v.string(),
    now: v.number(),
    soonWindowMs: v.number(),
    periodBounds: v.optional(periodBoundsInput),
    tagId: v.optional(v.id("tags")),
    tagRootId: v.optional(v.id("tags")),
    scorecardId: v.optional(v.id("scorecards")),
  },
  returns: v.object({
    scorecards: v.array(scorecardItemValidator),
  }),
  handler: async (ctx, args) => {
    if (args.scorecardId !== undefined) {
      validateReadClock(args.now, args.soonWindowMs);
      const scorecard = await ctx.db.get("scorecards", args.scorecardId);
      if (!scorecard || scorecard.userId !== args.userId) {
        return { scorecards: [] };
      }
      await assertScorecardInTagRoot(
        ctx,
        args.userId,
        scorecard,
        args.tagRootId,
      );
      const periodBounds = resolvePeriodBounds(args.now, args.periodBounds);
      return {
        scorecards: [
          await toScorecardItem(
            ctx,
            args.userId,
            scorecard,
            args.now,
            args.soonWindowMs,
            periodBounds,
          ),
        ],
      };
    }
    return {
      scorecards: await listScorecardsForUser(ctx, args),
    };
  },
});

export const manageFromMcp = internalMutation({
  args: {
    userId: v.string(),
    tagRootId: v.optional(v.id("tags")),
    operation: manageOperationInput,
    now: v.number(),
  },
  returns: v.object({
    scorecardId: v.id("scorecards"),
  }),
  handler: async (ctx, args) => {
    return {
      scorecardId: await manageScorecardForUser(ctx, args),
    };
  },
});
