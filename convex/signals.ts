import { paginationOptsValidator } from "convex/server";
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
import { normalizeMember } from "./lib/scorecardMembers";
import {
  activityMeasurementField,
  activityMeasurements,
  activityPeriod,
  activityTarget,
  inventoryFlow,
  inventoryThreshold,
  signalAttention,
  signalEntryOperation,
  signalModel,
  signalProvenance,
  signalSource,
} from "./schema";
import {
  DAY_MS,
  evaluateSignal,
  materializeInventory,
  type ActivityPeriodProgress,
  type ActivityTarget,
  type InventorySignalModel,
  type SignalAttention,
} from "./lib/signalStatus";

const signalKind = v.union(v.literal("activity"), v.literal("inventory"));
const activityTargetInput = v.optional(v.union(activityTarget, v.null()));
const activityMeasurementFieldsInput = v.array(activityMeasurementField);
const activityMeasurementsInput = v.optional(
  v.union(activityMeasurements, v.null()),
);
const nullableNoteInput = v.optional(v.union(v.string(), v.null()));
const flowInput = v.optional(v.union(inventoryFlow, v.null()));
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

const recordOperationInput = v.union(
  v.object({
    type: v.literal("activity.occurred"),
    occurredAt: v.optional(v.number()),
    note: v.optional(v.string()),
    measurements: v.optional(activityMeasurements),
  }),
  v.object({
    type: v.literal("inventory.adjusted"),
    amount: v.number(),
  }),
  v.object({
    type: v.literal("inventory.set"),
    quantity: v.number(),
  }),
);

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

const scorecardMembershipValidator = v.object({
  id: v.id("scorecards"),
  name: v.string(),
  role: v.union(v.literal("required"), v.literal("optional")),
});

const signalTagValidator = v.object({
  id: v.id("tags"),
  name: v.string(),
  color: v.optional(v.string()),
});

const availableSignalTagValidator = v.object({
  id: v.id("tags"),
  name: v.string(),
  parentId: v.union(v.id("tags"), v.null()),
  color: v.optional(v.string()),
});

const signalDashboardItemValidator = v.object({
  id: v.id("signals"),
  creationTime: v.number(),
  name: v.string(),
  tagIds: v.array(v.id("tags")),
  tags: v.array(signalTagValidator),
  model: signalModel,
  createdAt: v.number(),
  updatedAt: v.number(),
  archivedAt: v.optional(v.number()),
  evaluation: signalEvaluationValidator,
  scorecards: v.array(scorecardMembershipValidator),
});

const signalMcpReadResultValidator = v.object({
  signals: v.array(signalDashboardItemValidator),
  availableTags: v.array(availableSignalTagValidator),
});

const signalEntryOutputValidator = v.object({
  id: v.id("signalEntries"),
  creationTime: v.number(),
  signalId: v.id("signals"),
  effectiveAt: v.number(),
  recordedAt: v.number(),
  updatedAt: v.optional(v.number()),
  source: signalSource,
  provenance: v.optional(signalProvenance),
  idempotencyKey: v.string(),
  operation: signalEntryOperation,
});

const recordResultValidator = v.object({
  entryId: v.id("signalEntries"),
  idempotent: v.boolean(),
  signal: signalDashboardItemValidator,
});

const manageOperationInput = v.union(
  v.object({
    type: v.literal("activity.create"),
    name: v.string(),
    tagIds: v.array(v.id("tags")),
    target: v.optional(activityTarget),
    measurementFields: v.optional(activityMeasurementFieldsInput),
  }),
  v.object({
    type: v.literal("inventory.create"),
    name: v.string(),
    tagIds: v.array(v.id("tags")),
    unit: v.string(),
    initialQuantity: v.number(),
    threshold: inventoryThreshold,
    flow: v.optional(inventoryFlow),
  }),
  v.object({
    type: v.literal("activity.update"),
    signalId: v.id("signals"),
    name: v.optional(v.string()),
    tagIds: v.optional(v.array(v.id("tags"))),
    target: activityTargetInput,
    measurementFields: v.optional(activityMeasurementFieldsInput),
  }),
  v.object({
    type: v.literal("inventory.update"),
    signalId: v.id("signals"),
    name: v.optional(v.string()),
    tagIds: v.optional(v.array(v.id("tags"))),
    unit: v.optional(v.string()),
    threshold: v.optional(inventoryThreshold),
    flow: flowInput,
  }),
  v.object({
    type: v.literal("signal.archive"),
    signalId: v.id("signals"),
    archived: v.boolean(),
  }),
);

const manageEntryOperationInput = v.union(
  v.object({
    type: v.literal("activity.update"),
    entryId: v.id("signalEntries"),
    effectiveAt: v.optional(v.number()),
    note: nullableNoteInput,
    measurements: activityMeasurementsInput,
  }),
  v.object({
    type: v.literal("activity.delete"),
    entryId: v.id("signalEntries"),
  }),
);

type RecordOperationInput =
  | {
      type: "activity.occurred";
      occurredAt?: number;
      note?: string;
      measurements?: ActivityMeasurements;
    }
  | {
      type: "inventory.adjusted";
      amount: number;
    }
  | {
      type: "inventory.set";
      quantity: number;
    };

type ManageOperationInput =
  | {
      type: "activity.create";
      name: string;
      tagIds: Id<"tags">[];
      target?: ActivityTarget;
      measurementFields?: ActivityMeasurementField[];
    }
  | {
      type: "inventory.create";
      name: string;
      tagIds: Id<"tags">[];
      unit: string;
      initialQuantity: number;
      threshold: {
        value: number;
        comparison: "atOrBelow" | "atOrAbove";
      };
      flow?: {
        amount: number;
        everyDays: number;
      };
    }
  | {
      type: "activity.update";
      signalId: Id<"signals">;
      name?: string;
      tagIds?: Id<"tags">[];
      target?: ActivityTarget | null;
      measurementFields?: ActivityMeasurementField[];
    }
  | {
      type: "inventory.update";
      signalId: Id<"signals">;
      name?: string;
      tagIds?: Id<"tags">[];
      unit?: string;
      threshold?: {
        value: number;
        comparison: "atOrBelow" | "atOrAbove";
      };
      flow?: {
        amount: number;
        everyDays: number;
      } | null;
    }
  | {
      type: "signal.archive";
      signalId: Id<"signals">;
      archived: boolean;
    };

type ManageEntryOperationInput =
  | {
      type: "activity.update";
      entryId: Id<"signalEntries">;
      effectiveAt?: number;
      note?: string | null;
      measurements?: ActivityMeasurements | null;
    }
  | {
      type: "activity.delete";
      entryId: Id<"signalEntries">;
    };

type SignalDashboardItem = {
  id: Id<"signals">;
  creationTime: number;
  name: string;
  tagIds: Id<"tags">[];
  tags: Array<{
    id: Id<"tags">;
    name: string;
    color?: string;
  }>;
  model: Doc<"signals">["model"];
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  evaluation: ReturnType<typeof evaluateSignal>;
  scorecards: Array<{
    id: Id<"scorecards">;
    name: string;
    role: "required" | "optional";
  }>;
};

type ActivityMeasurementField =
  | "weight"
  | "reps"
  | "sets"
  | "durationSeconds"
  | "distance";

type ActivityMeasurements = {
  weight?: number;
  reps?: number;
  sets?: number;
  durationSeconds?: number;
  distance?: number;
};

function toSignalEntryOutput(entry: Doc<"signalEntries">) {
  return {
    id: entry._id,
    creationTime: entry._creationTime,
    signalId: entry.signalId,
    effectiveAt: entry.effectiveAt,
    recordedAt: entry.recordedAt,
    updatedAt: entry.updatedAt,
    source: entry.source,
    provenance: entry.provenance,
    idempotencyKey: entry.idempotencyKey,
    operation: entry.operation,
  };
}

const attentionRank: Record<SignalAttention, number> = {
  due: 0,
  soon: 1,
  unknown: 2,
  ok: 3,
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

function normalizeOptionalText(
  value: string | null | undefined,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length > maxLength) {
    throw new Error(`${field} must be ${maxLength} characters or fewer`);
  }
  return normalized;
}

function normalizeSignalTagIds(tagIds: Id<"tags">[]): Id<"tags">[] {
  return Array.from(new Set(tagIds));
}

function normalizeActivityMeasurementFields(
  fields: ActivityMeasurementField[] | undefined,
): ActivityMeasurementField[] | undefined {
  if (fields === undefined) {
    return undefined;
  }
  const normalized = Array.from(new Set(fields));
  return normalized.length === 0 ? undefined : normalized;
}

function validateActivityMeasurements(
  measurements: ActivityMeasurements | undefined,
  configuredFields: ActivityMeasurementField[] | undefined,
): ActivityMeasurements | undefined {
  const fields = normalizeActivityMeasurementFields(configuredFields) ?? [];
  const configured = new Set(fields);
  const values = measurements ?? {};

  for (const field of fields) {
    if (values[field] === undefined) {
      throw new Error(`measurements.${field} is required for this activity`);
    }
  }

  for (const field of [
    "weight",
    "reps",
    "sets",
    "durationSeconds",
    "distance",
  ] as const) {
    const value = values[field];
    if (value === undefined) {
      continue;
    }
    if (!configured.has(field)) {
      throw new Error(`measurements.${field} is not enabled for this activity`);
    }
    assertNonNegative(value, `measurements.${field}`);
    if ((field === "reps" || field === "sets") && !Number.isInteger(value)) {
      throw new Error(`measurements.${field} must be a whole number`);
    }
  }

  return Object.values(values).some((value) => value !== undefined)
    ? values
    : undefined;
}

async function assertOwnedSignalTagIds(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  tagIds: Id<"tags">[],
): Promise<Id<"tags">[]> {
  const normalizedTagIds = normalizeSignalTagIds(tagIds);
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

async function assertSignalInTagRoot(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  signal: Doc<"signals">,
  tagRootId: Id<"tags"> | undefined,
): Promise<void> {
  if (tagRootId === undefined) {
    return;
  }
  const allowedTagIds = await getTagSubtreeIds(ctx, userId, tagRootId);
  if (!signal.tagIds.some((tagId) => allowedTagIds.has(tagId))) {
    throw new Error("Signal is outside the authorized tag root");
  }
}

async function scopedSignalTagIds(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  tagIds: Id<"tags">[],
  tagRootId: Id<"tags"> | undefined,
  addRoot: boolean,
): Promise<Id<"tags">[]> {
  const normalized = await assertOwnedSignalTagIds(ctx, userId, tagIds);
  if (tagRootId === undefined) {
    return normalized;
  }
  const allowedTagIds = await getTagSubtreeIds(ctx, userId, tagRootId);
  if (normalized.some((tagId) => !allowedTagIds.has(tagId))) {
    throw new Error("Signal tags must stay inside the authorized tag root");
  }
  if (addRoot) {
    return normalizeSignalTagIds([tagRootId, ...normalized]);
  }
  if (normalized.length === 0) {
    throw new Error("Signal tags must remain inside the authorized tag root");
  }
  return normalized;
}

function validateActivityTarget(target: ActivityTarget | undefined): void {
  if (target === undefined) {
    return;
  }
  if (target.type === "recency") {
    assertFiniteNumber(target.dueAfterMs, "target.dueAfterMs");
    if (target.dueAfterMs <= 0) {
      throw new Error("target.dueAfterMs must be greater than zero");
    }
    return;
  }
  assertFiniteNumber(target.targetCount, "target.targetCount");
  if (!Number.isInteger(target.targetCount) || target.targetCount < 0) {
    throw new Error("target.targetCount must be a non-negative integer");
  }
}

function validateThreshold(threshold: {
  value: number;
  comparison: "atOrBelow" | "atOrAbove";
}): void {
  assertNonNegative(threshold.value, "threshold.value");
}

function validateFlow(
  flow:
    | {
        amount: number;
        everyDays: number;
      }
    | undefined,
): void {
  if (!flow) {
    return;
  }
  assertFiniteNumber(flow.amount, "flow.amount");
  if (flow.amount === 0) {
    throw new Error("flow.amount must not be zero");
  }
  assertFiniteNumber(flow.everyDays, "flow.everyDays");
  if (flow.everyDays <= 0) {
    throw new Error("flow.everyDays must be greater than zero");
  }
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

async function loadScorecardMemberships(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<
  Map<
    Id<"signals">,
    Array<{
      id: Id<"scorecards">;
      name: string;
      role: "required" | "optional";
    }>
  >
> {
  const scorecards = await ctx.db
    .query("scorecards")
    .withIndex("by_user_archived", (q) =>
      q.eq("userId", userId).eq("archivedAt", undefined),
    )
    .collect();
  const memberships = new Map<
    Id<"signals">,
    Array<{
      id: Id<"scorecards">;
      name: string;
      role: "required" | "optional";
    }>
  >();
  for (const scorecard of scorecards) {
    for (const member of scorecard.members) {
      const normalized = normalizeMember(member);
      if (normalized.type !== "signal") {
        continue;
      }
      const existing = memberships.get(normalized.signalId) ?? [];
      existing.push({
        id: scorecard._id,
        name: scorecard.name,
        role: normalized.role,
      });
      memberships.set(normalized.signalId, existing);
    }
  }
  return memberships;
}

async function toDashboardItem(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  signal: Doc<"signals">,
  now: number,
  soonWindowMs: number,
  periodBounds: PeriodBounds,
  memberships?: Map<
    Id<"signals">,
    Array<{
      id: Id<"scorecards">;
      name: string;
      role: "required" | "optional";
    }>
  >,
): Promise<SignalDashboardItem> {
  const tagDocuments = await Promise.all(
    signal.tagIds.map((tagId) => ctx.db.get("tags", tagId)),
  );
  const tags = tagDocuments
    .filter((tag): tag is Doc<"tags"> => tag !== null && tag.userId === userId)
    .map((tag) => ({
      id: tag._id,
      name: tag.name,
      color: tag.color,
    }));
  const periodProgress = await getActivityPeriodProgress(
    ctx,
    signal,
    periodBounds,
  );
  const scorecards =
    memberships ?? (await loadScorecardMemberships(ctx, userId));
  return {
    id: signal._id,
    creationTime: signal._creationTime,
    name: signal.name,
    tagIds: tags.map((tag) => tag.id),
    tags,
    model: signal.model,
    createdAt: signal.createdAt,
    updatedAt: signal.updatedAt,
    archivedAt: signal.archivedAt,
    evaluation: evaluateSignal(signal.model, now, soonWindowMs, periodProgress),
    scorecards: scorecards.get(signal._id) ?? [],
  };
}

function sortDashboardItems(
  items: SignalDashboardItem[],
): SignalDashboardItem[] {
  return items.sort((left, right) => {
    const attentionDifference =
      attentionRank[left.evaluation.attention] -
      attentionRank[right.evaluation.attention];
    if (attentionDifference !== 0) {
      return attentionDifference;
    }
    const leftActionAt = left.evaluation.actionAt ?? Number.POSITIVE_INFINITY;
    const rightActionAt = right.evaluation.actionAt ?? Number.POSITIVE_INFINITY;
    if (leftActionAt !== rightActionAt) {
      return leftActionAt - rightActionAt;
    }
    return left.name.localeCompare(right.name);
  });
}

async function getOwnedSignal(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  signalId: Id<"signals">,
): Promise<Doc<"signals">> {
  const signal = await ctx.db.get("signals", signalId);
  if (!signal || signal.userId !== userId) {
    throw new Error("Signal not found or access denied");
  }
  return signal;
}

async function getOwnedActivityEntry(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  entryId: Id<"signalEntries">,
  tagRootId: Id<"tags"> | undefined,
): Promise<{
  entry: Doc<"signalEntries"> & {
    operation: Extract<
      Doc<"signalEntries">["operation"],
      { type: "activity.occurred" }
    >;
  };
  signal: Doc<"signals"> & {
    model: Extract<Doc<"signals">["model"], { kind: "activity" }>;
  };
}> {
  const entry = await ctx.db.get("signalEntries", entryId);
  if (!entry || entry.userId !== userId) {
    throw new Error("Signal entry not found or access denied");
  }
  const signal = await getOwnedSignal(ctx, userId, entry.signalId);
  await assertSignalInTagRoot(ctx, userId, signal, tagRootId);
  if (
    signal.model.kind !== "activity" ||
    entry.operation.type !== "activity.occurred"
  ) {
    throw new Error("Signal entry is not an activity occurrence");
  }
  return {
    entry: entry as Doc<"signalEntries"> & {
      operation: Extract<
        Doc<"signalEntries">["operation"],
        { type: "activity.occurred" }
      >;
    },
    signal: signal as Doc<"signals"> & {
      model: Extract<Doc<"signals">["model"], { kind: "activity" }>;
    },
  };
}

async function recomputeLastOccurredAt(
  ctx: MutationCtx,
  signal: Doc<"signals"> & {
    model: Extract<Doc<"signals">["model"], { kind: "activity" }>;
  },
  now: number,
): Promise<void> {
  const latest = await ctx.db
    .query("signalEntries")
    .withIndex("by_signal_effective_at", (q) =>
      q.eq("signalId", signal._id),
    )
    .order("desc")
    .first();
  await ctx.db.patch("signals", signal._id, {
    model: {
      ...signal.model,
      lastOccurredAt: latest?.effectiveAt,
    },
    updatedAt: now,
  });
}

async function listDashboardForUser(
  ctx: QueryCtx,
  args: {
    userId: string;
    now: number;
    soonWindowMs: number;
    periodBounds?: PeriodBoundsInput;
    kind?: "activity" | "inventory";
    tagId?: Id<"tags">;
    tagRootId?: Id<"tags">;
    attention?: SignalAttention;
  },
): Promise<SignalDashboardItem[]> {
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
  const signals = await ctx.db
    .query("signals")
    .withIndex("by_user_archived", (q) =>
      q.eq("userId", args.userId).eq("archivedAt", undefined),
    )
    .collect();
  const matchingSignals = signals
    .filter(
      (signal) => args.kind === undefined || signal.model.kind === args.kind,
    )
    .filter(
      (signal) =>
        matchingTagIds === undefined ||
        signal.tagIds.some((tagId) => matchingTagIds.has(tagId)),
    )
    .filter(
      (signal) =>
        allowedRootTagIds === undefined ||
        signal.tagIds.some((tagId) => allowedRootTagIds.has(tagId)),
    );
  const memberships = await loadScorecardMemberships(ctx, args.userId);
  const items = (
    await Promise.all(
      matchingSignals.map((signal) =>
        toDashboardItem(
          ctx,
          args.userId,
          signal,
          args.now,
          args.soonWindowMs,
          periodBounds,
          memberships,
        ),
      ),
    )
  ).filter(
    (item) =>
      args.attention === undefined ||
      item.evaluation.attention === args.attention,
  );
  return sortDashboardItems(items);
}

async function createActivityForUser(
  ctx: MutationCtx,
  args: {
    userId: string;
    name: string;
    tagIds: Id<"tags">[];
    tagRootId?: Id<"tags">;
    target?: ActivityTarget;
    measurementFields?: ActivityMeasurementField[];
    now: number;
  },
): Promise<Id<"signals">> {
  const name = normalizeRequiredText(args.name, "name", 200);
  const tagIds = await scopedSignalTagIds(
    ctx,
    args.userId,
    args.tagIds,
    args.tagRootId,
    true,
  );
  validateActivityTarget(args.target);
  const measurementFields = normalizeActivityMeasurementFields(
    args.measurementFields,
  );
  assertFiniteNumber(args.now, "now");

  return await ctx.db.insert("signals", {
    userId: args.userId,
    name,
    tagIds,
    model: {
      kind: "activity",
      target: args.target,
      measurementFields,
    },
    createdAt: args.now,
    updatedAt: args.now,
  });
}

async function createInventoryForUser(
  ctx: MutationCtx,
  args: {
    userId: string;
    name: string;
    tagIds: Id<"tags">[];
    tagRootId?: Id<"tags">;
    unit: string;
    initialQuantity: number;
    threshold: {
      value: number;
      comparison: "atOrBelow" | "atOrAbove";
    };
    flow?: {
      amount: number;
      everyDays: number;
    };
    now: number;
  },
): Promise<Id<"signals">> {
  const name = normalizeRequiredText(args.name, "name", 200);
  const tagIds = await scopedSignalTagIds(
    ctx,
    args.userId,
    args.tagIds,
    args.tagRootId,
    true,
  );
  const unit = normalizeRequiredText(args.unit, "unit", 50);
  assertNonNegative(args.initialQuantity, "initialQuantity");
  validateThreshold(args.threshold);
  validateFlow(args.flow);
  assertFiniteNumber(args.now, "now");

  return await ctx.db.insert("signals", {
    userId: args.userId,
    name,
    tagIds,
    model: {
      kind: "inventory",
      unit,
      threshold: args.threshold,
      flow: args.flow,
      confirmedQuantity: args.initialQuantity,
      confirmedAt: args.now,
      nextFlowAt:
        args.flow === undefined
          ? undefined
          : args.now + args.flow.everyDays * DAY_MS,
    },
    createdAt: args.now,
    updatedAt: args.now,
  });
}

async function updateActivityForUser(
  ctx: MutationCtx,
  args: {
    userId: string;
    signalId: Id<"signals">;
    name?: string;
    tagIds?: Id<"tags">[];
    tagRootId?: Id<"tags">;
    target?: ActivityTarget | null;
    measurementFields?: ActivityMeasurementField[];
    now: number;
  },
): Promise<void> {
  const signal = await getOwnedSignal(ctx, args.userId, args.signalId);
  if (signal.model.kind !== "activity") {
    throw new Error("Signal is not an activity");
  }
  await assertSignalInTagRoot(ctx, args.userId, signal, args.tagRootId);
  const target =
    args.target === null ? undefined : (args.target ?? signal.model.target);
  const measurementFields =
    args.measurementFields === undefined
      ? signal.model.measurementFields
      : normalizeActivityMeasurementFields(args.measurementFields);
  validateActivityTarget(target);
  assertFiniteNumber(args.now, "now");
  const tagIds =
    args.tagIds === undefined
      ? signal.tagIds
      : await scopedSignalTagIds(
          ctx,
          args.userId,
          args.tagIds,
          args.tagRootId,
          false,
        );

  await ctx.db.patch("signals", signal._id, {
    name:
      args.name === undefined
        ? signal.name
        : normalizeRequiredText(args.name, "name", 200),
    tagIds,
    model: {
      ...signal.model,
      target,
      measurementFields,
    },
    updatedAt: args.now,
  });
}

async function updateInventoryForUser(
  ctx: MutationCtx,
  args: {
    userId: string;
    signalId: Id<"signals">;
    name?: string;
    tagIds?: Id<"tags">[];
    tagRootId?: Id<"tags">;
    unit?: string;
    threshold?: {
      value: number;
      comparison: "atOrBelow" | "atOrAbove";
    };
    flow?: {
      amount: number;
      everyDays: number;
    } | null;
    now: number;
  },
): Promise<void> {
  const signal = await getOwnedSignal(ctx, args.userId, args.signalId);
  if (signal.model.kind !== "inventory") {
    throw new Error("Signal is not an inventory");
  }
  await assertSignalInTagRoot(ctx, args.userId, signal, args.tagRootId);
  assertFiniteNumber(args.now, "now");
  if (args.threshold) {
    validateThreshold(args.threshold);
  }
  if (args.flow !== null) {
    validateFlow(args.flow);
  }
  const tagIds =
    args.tagIds === undefined
      ? signal.tagIds
      : await scopedSignalTagIds(
          ctx,
          args.userId,
          args.tagIds,
          args.tagRootId,
          false,
        );

  const materialized = materializeInventory(signal.model, args.now);
  let nextModel: InventorySignalModel = {
    ...materialized,
    unit:
      args.unit === undefined
        ? materialized.unit
        : normalizeRequiredText(args.unit, "unit", 50),
    threshold: args.threshold ?? materialized.threshold,
  };
  if (args.flow !== undefined) {
    nextModel =
      args.flow === null
        ? {
            ...nextModel,
            flow: undefined,
            nextFlowAt: undefined,
          }
        : {
            ...nextModel,
            flow: args.flow,
            nextFlowAt: args.now + args.flow.everyDays * DAY_MS,
          };
  }

  await ctx.db.patch("signals", signal._id, {
    name:
      args.name === undefined
        ? signal.name
        : normalizeRequiredText(args.name, "name", 200),
    tagIds,
    model: nextModel,
    updatedAt: args.now,
  });
}

async function setArchivedForUser(
  ctx: MutationCtx,
  args: {
    userId: string;
    signalId: Id<"signals">;
    tagRootId?: Id<"tags">;
    archived: boolean;
    now: number;
  },
): Promise<void> {
  const signal = await getOwnedSignal(ctx, args.userId, args.signalId);
  await assertSignalInTagRoot(ctx, args.userId, signal, args.tagRootId);
  assertFiniteNumber(args.now, "now");
  await ctx.db.patch("signals", signal._id, {
    archivedAt: args.archived ? args.now : undefined,
    updatedAt: args.now,
  });
}

function normalizeIdempotencyKey(value: string): string {
  return normalizeRequiredText(value, "idempotencyKey", 200);
}

function normalizeNote(value: string | undefined): string | undefined {
  return normalizeOptionalText(value, "note", 1000);
}

function activityMeasurementsEqual(
  left: ActivityMeasurements | undefined,
  right: ActivityMeasurements | undefined,
): boolean {
  return (
    left?.weight === right?.weight &&
    left?.reps === right?.reps &&
    left?.sets === right?.sets &&
    left?.durationSeconds === right?.durationSeconds &&
    left?.distance === right?.distance
  );
}

function existingEntryMatches(
  entry: Doc<"signalEntries">,
  operation: RecordOperationInput,
): boolean {
  if (entry.operation.type !== operation.type) {
    return false;
  }
  if (operation.type === "activity.occurred") {
    return (
      entry.operation.type === "activity.occurred" &&
      entry.operation.note === normalizeNote(operation.note) &&
      activityMeasurementsEqual(
        entry.operation.measurements,
        operation.measurements,
      ) &&
      (operation.occurredAt === undefined ||
        entry.effectiveAt === operation.occurredAt)
    );
  }
  if (operation.type === "inventory.adjusted") {
    return (
      entry.operation.type === "inventory.adjusted" &&
      entry.operation.amount === operation.amount
    );
  }
  return (
    entry.operation.type === "inventory.set" &&
    entry.operation.quantity === operation.quantity
  );
}

async function recordSignalForUser(
  ctx: MutationCtx,
  args: {
    userId: string;
    signalId: Id<"signals">;
    tagRootId?: Id<"tags">;
    source: "mobile" | "mcp" | "import";
    provenance?: {
      system: "dailies";
      entityId: string;
      eventId: string;
    };
    idempotencyKey: string;
    operation: RecordOperationInput;
    now: number;
    soonWindowMs: number;
    periodBounds?: PeriodBoundsInput;
  },
): Promise<{
  entryId: Id<"signalEntries">;
  idempotent: boolean;
  signal: SignalDashboardItem;
}> {
  validateReadClock(args.now, args.soonWindowMs);
  const periodBounds = resolvePeriodBounds(args.now, args.periodBounds);
  const idempotencyKey = normalizeIdempotencyKey(args.idempotencyKey);
  const existing = await ctx.db
    .query("signalEntries")
    .withIndex("by_user_idempotency_key", (q) =>
      q.eq("userId", args.userId).eq("idempotencyKey", idempotencyKey),
    )
    .unique();
  if (existing) {
    if (
      existing.signalId !== args.signalId ||
      !existingEntryMatches(existing, args.operation)
    ) {
      throw new Error(
        "Idempotency key was already used for a different signal operation",
      );
    }
    const existingSignal = await getOwnedSignal(
      ctx,
      args.userId,
      args.signalId,
    );
    await assertSignalInTagRoot(
      ctx,
      args.userId,
      existingSignal,
      args.tagRootId,
    );
    return {
      entryId: existing._id,
      idempotent: true,
      signal: await toDashboardItem(
        ctx,
        args.userId,
        existingSignal,
        args.now,
        args.soonWindowMs,
        periodBounds,
      ),
    };
  }

  const signal = await getOwnedSignal(ctx, args.userId, args.signalId);
  await assertSignalInTagRoot(ctx, args.userId, signal, args.tagRootId);
  if (signal.archivedAt !== undefined) {
    throw new Error("Archived signals cannot be recorded");
  }

  let effectiveAt = args.now;
  let operation: Doc<"signalEntries">["operation"];
  let nextModel: Doc<"signals">["model"];

  if (args.operation.type === "activity.occurred") {
    if (signal.model.kind !== "activity") {
      throw new Error("Signal is not an activity");
    }
    effectiveAt = args.operation.occurredAt ?? args.now;
    assertFiniteNumber(effectiveAt, "occurredAt");
    if (effectiveAt > args.now) {
      throw new Error("occurredAt cannot be in the future");
    }
    const note = normalizeNote(args.operation.note);
    const measurements = validateActivityMeasurements(
      args.operation.measurements,
      signal.model.measurementFields,
    );
    operation = {
      type: "activity.occurred",
      note,
      measurements,
    };
    nextModel = {
      ...signal.model,
      lastOccurredAt:
        signal.model.lastOccurredAt === undefined
          ? effectiveAt
          : Math.max(signal.model.lastOccurredAt, effectiveAt),
    };
  } else {
    if (signal.model.kind !== "inventory") {
      throw new Error("Signal is not an inventory");
    }
    const materialized = materializeInventory(signal.model, args.now);
    if (args.operation.type === "inventory.adjusted") {
      assertFiniteNumber(args.operation.amount, "amount");
      if (args.operation.amount === 0) {
        throw new Error("amount must not be zero");
      }
      const resultingQuantity =
        materialized.confirmedQuantity + args.operation.amount;
      assertNonNegative(resultingQuantity, "resulting quantity");
      operation = {
        type: "inventory.adjusted",
        amount: args.operation.amount,
        resultingQuantity,
      };
      nextModel = {
        ...materialized,
        confirmedQuantity: resultingQuantity,
      };
    } else {
      assertNonNegative(args.operation.quantity, "quantity");
      operation = {
        type: "inventory.set",
        quantity: args.operation.quantity,
        previousQuantity: materialized.confirmedQuantity,
      };
      nextModel = {
        ...materialized,
        confirmedQuantity: args.operation.quantity,
      };
    }
  }

  const entryId = await ctx.db.insert("signalEntries", {
    userId: args.userId,
    signalId: signal._id,
    effectiveAt,
    recordedAt: args.now,
    source: args.source,
    provenance: args.provenance,
    idempotencyKey,
    operation,
  });
  await ctx.db.patch("signals", signal._id, {
    model: nextModel,
    updatedAt: args.now,
  });
  const updatedSignal = {
    ...signal,
    model: nextModel,
    updatedAt: args.now,
  };

  return {
    entryId,
    idempotent: false,
    signal: await toDashboardItem(
      ctx,
      args.userId,
      updatedSignal,
      args.now,
      args.soonWindowMs,
      periodBounds,
    ),
  };
}

async function updateActivityEntryForUser(
  ctx: MutationCtx,
  args: {
    userId: string;
    tagRootId?: Id<"tags">;
    entryId: Id<"signalEntries">;
    effectiveAt?: number;
    note?: string | null;
    measurements?: ActivityMeasurements | null;
    now: number;
  },
): Promise<void> {
  assertFiniteNumber(args.now, "now");
  if (
    args.effectiveAt === undefined &&
    args.note === undefined &&
    args.measurements === undefined
  ) {
    throw new Error("At least one activity entry update is required");
  }
  const { entry, signal } = await getOwnedActivityEntry(
    ctx,
    args.userId,
    args.entryId,
    args.tagRootId,
  );
  const effectiveAt = args.effectiveAt ?? entry.effectiveAt;
  assertFiniteNumber(effectiveAt, "effectiveAt");
  if (effectiveAt > args.now) {
    throw new Error("effectiveAt cannot be in the future");
  }
  const note =
    args.note === undefined
      ? entry.operation.note
      : normalizeOptionalText(args.note, "note", 1000);
  const measurements =
    args.measurements === undefined
      ? entry.operation.measurements
      : validateActivityMeasurements(
          args.measurements ?? undefined,
          signal.model.measurementFields,
        );

  await ctx.db.patch("signalEntries", entry._id, {
    effectiveAt,
    updatedAt: args.now,
    operation: {
      type: "activity.occurred",
      note,
      measurements,
    },
  });
  await recomputeLastOccurredAt(ctx, signal, args.now);
}

async function deleteActivityEntryForUser(
  ctx: MutationCtx,
  args: {
    userId: string;
    tagRootId?: Id<"tags">;
    entryId: Id<"signalEntries">;
    now: number;
  },
): Promise<void> {
  assertFiniteNumber(args.now, "now");
  const { entry, signal } = await getOwnedActivityEntry(
    ctx,
    args.userId,
    args.entryId,
    args.tagRootId,
  );
  await ctx.db.delete("signalEntries", entry._id);
  await recomputeLastOccurredAt(ctx, signal, args.now);
}

async function manageSignalForUser(
  ctx: MutationCtx,
  args: {
    userId: string;
    tagRootId?: Id<"tags">;
    operation: ManageOperationInput;
    now: number;
  },
): Promise<Id<"signals">> {
  const { operation } = args;
  switch (operation.type) {
    case "activity.create":
      return await createActivityForUser(ctx, {
        ...operation,
        userId: args.userId,
        tagRootId: args.tagRootId,
        now: args.now,
      });
    case "inventory.create":
      return await createInventoryForUser(ctx, {
        ...operation,
        userId: args.userId,
        tagRootId: args.tagRootId,
        now: args.now,
      });
    case "activity.update":
      await updateActivityForUser(ctx, {
        ...operation,
        userId: args.userId,
        tagRootId: args.tagRootId,
        now: args.now,
      });
      return operation.signalId;
    case "inventory.update":
      await updateInventoryForUser(ctx, {
        ...operation,
        userId: args.userId,
        tagRootId: args.tagRootId,
        now: args.now,
      });
      return operation.signalId;
    case "signal.archive":
      await setArchivedForUser(ctx, {
        ...operation,
        userId: args.userId,
        tagRootId: args.tagRootId,
        now: args.now,
      });
      return operation.signalId;
  }
}

async function manageSignalEntryForUser(
  ctx: MutationCtx,
  args: {
    userId: string;
    tagRootId?: Id<"tags">;
    operation: ManageEntryOperationInput;
    now: number;
  },
): Promise<Id<"signalEntries">> {
  if (args.operation.type === "activity.update") {
    await updateActivityEntryForUser(ctx, {
      ...args.operation,
      userId: args.userId,
      tagRootId: args.tagRootId,
      now: args.now,
    });
    return args.operation.entryId;
  }
  await deleteActivityEntryForUser(ctx, {
    ...args.operation,
    userId: args.userId,
    tagRootId: args.tagRootId,
    now: args.now,
  });
  return args.operation.entryId;
}

export const listDashboard = query({
  args: {
    now: v.number(),
    soonWindowMs: v.number(),
    periodBounds: v.optional(periodBoundsInput),
    kind: v.optional(signalKind),
    tagId: v.optional(v.id("tags")),
    attention: v.optional(signalAttention),
  },
  returns: v.array(signalDashboardItemValidator),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }
    return await listDashboardForUser(ctx, { ...args, userId });
  },
});

export const get = query({
  args: {
    signalId: v.id("signals"),
    now: v.number(),
    soonWindowMs: v.number(),
    periodBounds: v.optional(periodBoundsInput),
  },
  returns: v.union(signalDashboardItemValidator, v.null()),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    validateReadClock(args.now, args.soonWindowMs);
    const signal = await ctx.db.get("signals", args.signalId);
    if (!signal || signal.userId !== userId) {
      return null;
    }
    const periodBounds = resolvePeriodBounds(args.now, args.periodBounds);
    return await toDashboardItem(
      ctx,
      userId,
      signal,
      args.now,
      args.soonWindowMs,
      periodBounds,
    );
  },
});

export const history = query({
  args: {
    signalId: v.id("signals"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(signalEntryOutputValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        page: [],
        isDone: true,
        continueCursor: "",
      };
    }
    await getOwnedSignal(ctx, userId, args.signalId);
    const result = await ctx.db
      .query("signalEntries")
      .withIndex("by_signal_effective_at", (q) =>
        q.eq("signalId", args.signalId),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      page: result.page.map(toSignalEntryOutput),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const createActivity = mutation({
  args: {
    name: v.string(),
    tagIds: v.array(v.id("tags")),
    target: v.optional(activityTarget),
    measurementFields: v.optional(activityMeasurementFieldsInput),
  },
  returns: v.id("signals"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    return await createActivityForUser(ctx, {
      ...args,
      userId,
      now: Date.now(),
    });
  },
});

export const createInventory = mutation({
  args: {
    name: v.string(),
    tagIds: v.array(v.id("tags")),
    unit: v.string(),
    initialQuantity: v.number(),
    threshold: inventoryThreshold,
    flow: v.optional(inventoryFlow),
  },
  returns: v.id("signals"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    return await createInventoryForUser(ctx, {
      ...args,
      userId,
      now: Date.now(),
    });
  },
});

export const updateActivity = mutation({
  args: {
    signalId: v.id("signals"),
    name: v.optional(v.string()),
    tagIds: v.optional(v.array(v.id("tags"))),
    target: activityTargetInput,
    measurementFields: v.optional(activityMeasurementFieldsInput),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    await updateActivityForUser(ctx, {
      ...args,
      userId,
      now: Date.now(),
    });
    return null;
  },
});

export const updateInventory = mutation({
  args: {
    signalId: v.id("signals"),
    name: v.optional(v.string()),
    tagIds: v.optional(v.array(v.id("tags"))),
    unit: v.optional(v.string()),
    threshold: v.optional(inventoryThreshold),
    flow: flowInput,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    await updateInventoryForUser(ctx, {
      ...args,
      userId,
      now: Date.now(),
    });
    return null;
  },
});

export const setArchived = mutation({
  args: {
    signalId: v.id("signals"),
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

export const record = mutation({
  args: {
    signalId: v.id("signals"),
    idempotencyKey: v.string(),
    operation: recordOperationInput,
    soonWindowMs: v.number(),
    periodBounds: v.optional(periodBoundsInput),
  },
  returns: recordResultValidator,
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    return await recordSignalForUser(ctx, {
      ...args,
      userId,
      source: "mobile",
      now: Date.now(),
    });
  },
});

export const updateActivityEntry = mutation({
  args: {
    entryId: v.id("signalEntries"),
    effectiveAt: v.optional(v.number()),
    note: nullableNoteInput,
    measurements: activityMeasurementsInput,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    await updateActivityEntryForUser(ctx, {
      ...args,
      userId,
      now: Date.now(),
    });
    return null;
  },
});

export const deleteActivityEntry = mutation({
  args: {
    entryId: v.id("signalEntries"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    await deleteActivityEntryForUser(ctx, {
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
    kind: v.optional(signalKind),
    tagId: v.optional(v.id("tags")),
    tagRootId: v.optional(v.id("tags")),
    attention: v.optional(signalAttention),
  },
  returns: signalMcpReadResultValidator,
  handler: async (ctx, args) => {
    const allowedTagIds =
      args.tagRootId === undefined
        ? undefined
        : await getTagSubtreeIds(ctx, args.userId, args.tagRootId);
    const [signals, tags] = await Promise.all([
      listDashboardForUser(ctx, args),
      ctx.db
        .query("tags")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .collect(),
    ]);
    return {
      signals,
      availableTags: tags
        .filter(
          (tag) => allowedTagIds === undefined || allowedTagIds.has(tag._id),
        )
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((tag) => ({
          id: tag._id,
          name: tag.name,
          parentId: tag.parentId,
          color: tag.color,
        })),
    };
  },
});

export const historyForMcp = internalQuery({
  args: {
    userId: v.string(),
    tagRootId: v.optional(v.id("tags")),
    signalId: v.id("signals"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(signalEntryOutputValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const signal = await getOwnedSignal(ctx, args.userId, args.signalId);
    await assertSignalInTagRoot(
      ctx,
      args.userId,
      signal,
      args.tagRootId,
    );
    const result = await ctx.db
      .query("signalEntries")
      .withIndex("by_signal_effective_at", (q) =>
        q.eq("signalId", args.signalId),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      page: result.page.map(toSignalEntryOutput),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const recordFromMcp = internalMutation({
  args: {
    userId: v.string(),
    signalId: v.id("signals"),
    tagRootId: v.optional(v.id("tags")),
    idempotencyKey: v.string(),
    operation: recordOperationInput,
    now: v.number(),
    soonWindowMs: v.number(),
    periodBounds: v.optional(periodBoundsInput),
  },
  returns: recordResultValidator,
  handler: async (ctx, args) => {
    return await recordSignalForUser(ctx, {
      ...args,
      source: "mcp",
    });
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
    signalId: v.id("signals"),
  }),
  handler: async (ctx, args) => {
    return {
      signalId: await manageSignalForUser(ctx, args),
    };
  },
});

export const manageEntryFromMcp = internalMutation({
  args: {
    userId: v.string(),
    tagRootId: v.optional(v.id("tags")),
    operation: manageEntryOperationInput,
    now: v.number(),
  },
  returns: v.object({
    entryId: v.id("signalEntries"),
  }),
  handler: async (ctx, args) => {
    return {
      entryId: await manageSignalEntryForUser(ctx, args),
    };
  },
});

const dailiesWorkoutImportValidator = v.object({
  entityId: v.string(),
  name: v.string(),
  mergeIntoName: v.optional(v.string()),
  measurementFields: activityMeasurementFieldsInput,
  events: v.array(
    v.object({
      eventId: v.string(),
      occurredAt: v.number(),
      measurements: activityMeasurements,
    }),
  ),
});

export const importDailiesWorkouts = internalMutation({
  args: {
    userId: v.string(),
    exerciseTagId: v.id("tags"),
    now: v.number(),
    workouts: v.array(dailiesWorkoutImportValidator),
  },
  returns: v.object({
    createdSignals: v.number(),
    updatedSignals: v.number(),
    insertedEntries: v.number(),
    skippedEntries: v.number(),
    signalIds: v.array(v.id("signals")),
  }),
  handler: async (ctx, args) => {
    const exerciseTag = await ctx.db.get("tags", args.exerciseTagId);
    if (
      !exerciseTag ||
      exerciseTag.userId !== args.userId ||
      exerciseTag.name !== "Exercise"
    ) {
      throw new Error("Exercise tag not found for this user");
    }
    assertFiniteNumber(args.now, "now");

    const userSignals = await ctx.db
      .query("signals")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    let createdSignals = 0;
    let updatedSignals = 0;
    let insertedEntries = 0;
    let skippedEntries = 0;
    const signalIds: Id<"signals">[] = [];

    for (const workout of args.workouts) {
      const signalName = workout.mergeIntoName ?? workout.name;
      const matches = userSignals.filter(
        (signal) =>
          signal.name === signalName && signal.archivedAt === undefined,
      );
      if (matches.length > 1) {
        throw new Error(`Ambiguous active signal name: ${signalName}`);
      }

      let signal = matches[0];
      if (signal) {
        if (signal.model.kind !== "activity") {
          throw new Error(`Existing signal ${signalName} is not an activity`);
        }
        await updateActivityForUser(ctx, {
          userId: args.userId,
          signalId: signal._id,
          measurementFields: workout.measurementFields,
          now: args.now,
        });
        signal = await getOwnedSignal(ctx, args.userId, signal._id);
        updatedSignals += 1;
      } else {
        const signalId = await createActivityForUser(ctx, {
          userId: args.userId,
          name: signalName,
          tagIds: [args.exerciseTagId],
          measurementFields: workout.measurementFields,
          now: args.now,
        });
        signal = await getOwnedSignal(ctx, args.userId, signalId);
        userSignals.push(signal);
        createdSignals += 1;
      }
      signalIds.push(signal._id);

      for (const event of workout.events) {
        const recorded = await recordSignalForUser(ctx, {
          userId: args.userId,
          signalId: signal._id,
          source: "import",
          provenance: {
            system: "dailies",
            entityId: workout.entityId,
            eventId: event.eventId,
          },
          idempotencyKey: `dailies:event:${event.eventId}`,
          operation: {
            type: "activity.occurred",
            occurredAt: event.occurredAt,
            measurements: event.measurements,
          },
          now: args.now,
          soonWindowMs: 0,
        });
        if (recorded.idempotent) {
          skippedEntries += 1;
        } else {
          insertedEntries += 1;
        }
      }
    }

    return {
      createdSignals,
      updatedSignals,
      insertedEntries,
      skippedEntries,
      signalIds,
    };
  },
});
