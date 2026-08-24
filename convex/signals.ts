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
import {
  inventoryFlow,
  inventoryThreshold,
  signalAttention,
  signalEntryOperation,
  signalModel,
  signalSource,
} from "./schema";
import {
  DAY_MS,
  evaluateSignal,
  materializeInventory,
  type InventorySignalModel,
  type SignalAttention,
} from "./lib/signalStatus";

const signalKind = v.union(v.literal("activity"), v.literal("inventory"));
const categoryInput = v.optional(v.union(v.string(), v.null()));
const dueAfterInput = v.optional(v.union(v.number(), v.null()));
const flowInput = v.optional(v.union(inventoryFlow, v.null()));

const recordOperationInput = v.union(
  v.object({
    type: v.literal("activity.occurred"),
    occurredAt: v.optional(v.number()),
    note: v.optional(v.string()),
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
  projectedQuantity: v.optional(v.number()),
  runwayMs: v.optional(v.number()),
  confirmedAt: v.optional(v.number()),
  isProjected: v.optional(v.boolean()),
  nextFlowAt: v.optional(v.number()),
});

const signalDashboardItemValidator = v.object({
  id: v.id("signals"),
  creationTime: v.number(),
  name: v.string(),
  category: v.optional(v.string()),
  model: signalModel,
  createdAt: v.number(),
  updatedAt: v.number(),
  archivedAt: v.optional(v.number()),
  evaluation: signalEvaluationValidator,
});

const signalEntryOutputValidator = v.object({
  id: v.id("signalEntries"),
  creationTime: v.number(),
  signalId: v.id("signals"),
  effectiveAt: v.number(),
  recordedAt: v.number(),
  source: signalSource,
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
    category: v.optional(v.string()),
    dueAfterMs: v.optional(v.number()),
  }),
  v.object({
    type: v.literal("inventory.create"),
    name: v.string(),
    category: v.optional(v.string()),
    unit: v.string(),
    initialQuantity: v.number(),
    threshold: inventoryThreshold,
    flow: v.optional(inventoryFlow),
  }),
  v.object({
    type: v.literal("activity.update"),
    signalId: v.id("signals"),
    name: v.optional(v.string()),
    category: categoryInput,
    dueAfterMs: dueAfterInput,
  }),
  v.object({
    type: v.literal("inventory.update"),
    signalId: v.id("signals"),
    name: v.optional(v.string()),
    category: categoryInput,
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

type RecordOperationInput =
  | {
      type: "activity.occurred";
      occurredAt?: number;
      note?: string;
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
      category?: string;
      dueAfterMs?: number;
    }
  | {
      type: "inventory.create";
      name: string;
      category?: string;
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
      category?: string | null;
      dueAfterMs?: number | null;
    }
  | {
      type: "inventory.update";
      signalId: Id<"signals">;
      name?: string;
      category?: string | null;
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

type SignalDashboardItem = {
  id: Id<"signals">;
  creationTime: number;
  name: string;
  category?: string;
  model: Doc<"signals">["model"];
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  evaluation: ReturnType<typeof evaluateSignal>;
};

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

function validateDueAfterMs(value: number | undefined): void {
  if (value === undefined) {
    return;
  }
  assertFiniteNumber(value, "dueAfterMs");
  if (value <= 0) {
    throw new Error("dueAfterMs must be greater than zero");
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

function toDashboardItem(
  signal: Doc<"signals">,
  now: number,
  soonWindowMs: number,
): SignalDashboardItem {
  return {
    id: signal._id,
    creationTime: signal._creationTime,
    name: signal.name,
    category: signal.category,
    model: signal.model,
    createdAt: signal.createdAt,
    updatedAt: signal.updatedAt,
    archivedAt: signal.archivedAt,
    evaluation: evaluateSignal(signal.model, now, soonWindowMs),
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
    const leftActionAt =
      left.evaluation.actionAt ?? Number.POSITIVE_INFINITY;
    const rightActionAt =
      right.evaluation.actionAt ?? Number.POSITIVE_INFINITY;
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

async function listDashboardForUser(
  ctx: QueryCtx,
  args: {
    userId: string;
    now: number;
    soonWindowMs: number;
    kind?: "activity" | "inventory";
    category?: string;
    attention?: SignalAttention;
  },
): Promise<SignalDashboardItem[]> {
  validateReadClock(args.now, args.soonWindowMs);
  const signals = await ctx.db
    .query("signals")
    .withIndex("by_user_archived", (q) =>
      q.eq("userId", args.userId).eq("archivedAt", undefined),
    )
    .collect();
  const normalizedCategory = args.category?.trim().toLocaleLowerCase();
  const items = signals
    .filter(
      (signal) =>
        args.kind === undefined || signal.model.kind === args.kind,
    )
    .filter(
      (signal) =>
        normalizedCategory === undefined ||
        signal.category?.toLocaleLowerCase() === normalizedCategory,
    )
    .map((signal) =>
      toDashboardItem(signal, args.now, args.soonWindowMs),
    )
    .filter(
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
    category?: string;
    dueAfterMs?: number;
    now: number;
  },
): Promise<Id<"signals">> {
  const name = normalizeRequiredText(args.name, "name", 200);
  const category = normalizeOptionalText(args.category, "category", 100);
  validateDueAfterMs(args.dueAfterMs);
  assertFiniteNumber(args.now, "now");

  return await ctx.db.insert("signals", {
    userId: args.userId,
    name,
    category,
    model: {
      kind: "activity",
      dueAfterMs: args.dueAfterMs,
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
    category?: string;
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
  const category = normalizeOptionalText(args.category, "category", 100);
  const unit = normalizeRequiredText(args.unit, "unit", 50);
  assertNonNegative(args.initialQuantity, "initialQuantity");
  validateThreshold(args.threshold);
  validateFlow(args.flow);
  assertFiniteNumber(args.now, "now");

  return await ctx.db.insert("signals", {
    userId: args.userId,
    name,
    category,
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
    category?: string | null;
    dueAfterMs?: number | null;
    now: number;
  },
): Promise<void> {
  const signal = await getOwnedSignal(ctx, args.userId, args.signalId);
  if (signal.model.kind !== "activity") {
    throw new Error("Signal is not an activity");
  }
  const dueAfterMs =
    args.dueAfterMs === null
      ? undefined
      : (args.dueAfterMs ?? signal.model.dueAfterMs);
  validateDueAfterMs(dueAfterMs);
  assertFiniteNumber(args.now, "now");

  await ctx.db.patch("signals", signal._id, {
    name:
      args.name === undefined
        ? signal.name
        : normalizeRequiredText(args.name, "name", 200),
    category:
      args.category === undefined
        ? signal.category
        : normalizeOptionalText(args.category, "category", 100),
    model: {
      ...signal.model,
      dueAfterMs,
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
    category?: string | null;
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
  assertFiniteNumber(args.now, "now");
  if (args.threshold) {
    validateThreshold(args.threshold);
  }
  if (args.flow !== null) {
    validateFlow(args.flow);
  }

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
    category:
      args.category === undefined
        ? signal.category
        : normalizeOptionalText(args.category, "category", 100),
    model: nextModel,
    updatedAt: args.now,
  });
}

async function setArchivedForUser(
  ctx: MutationCtx,
  args: {
    userId: string;
    signalId: Id<"signals">;
    archived: boolean;
    now: number;
  },
): Promise<void> {
  const signal = await getOwnedSignal(ctx, args.userId, args.signalId);
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
    source: "mobile" | "mcp";
    idempotencyKey: string;
    operation: RecordOperationInput;
    now: number;
    soonWindowMs: number;
  },
): Promise<{
  entryId: Id<"signalEntries">;
  idempotent: boolean;
  signal: SignalDashboardItem;
}> {
  validateReadClock(args.now, args.soonWindowMs);
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
    return {
      entryId: existing._id,
      idempotent: true,
      signal: toDashboardItem(
        existingSignal,
        args.now,
        args.soonWindowMs,
      ),
    };
  }

  const signal = await getOwnedSignal(ctx, args.userId, args.signalId);
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
    operation = {
      type: "activity.occurred",
      note,
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
    signal: toDashboardItem(
      updatedSignal,
      args.now,
      args.soonWindowMs,
    ),
  };
}

async function manageSignalForUser(
  ctx: MutationCtx,
  args: {
    userId: string;
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
        now: args.now,
      });
    case "inventory.create":
      return await createInventoryForUser(ctx, {
        ...operation,
        userId: args.userId,
        now: args.now,
      });
    case "activity.update":
      await updateActivityForUser(ctx, {
        ...operation,
        userId: args.userId,
        now: args.now,
      });
      return operation.signalId;
    case "inventory.update":
      await updateInventoryForUser(ctx, {
        ...operation,
        userId: args.userId,
        now: args.now,
      });
      return operation.signalId;
    case "signal.archive":
      await setArchivedForUser(ctx, {
        ...operation,
        userId: args.userId,
        now: args.now,
      });
      return operation.signalId;
  }
}

export const listDashboard = query({
  args: {
    now: v.number(),
    soonWindowMs: v.number(),
    kind: v.optional(signalKind),
    category: v.optional(v.string()),
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
    return toDashboardItem(signal, args.now, args.soonWindowMs);
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
      page: result.page.map((entry) => ({
        id: entry._id,
        creationTime: entry._creationTime,
        signalId: entry.signalId,
        effectiveAt: entry.effectiveAt,
        recordedAt: entry.recordedAt,
        source: entry.source,
        idempotencyKey: entry.idempotencyKey,
        operation: entry.operation,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const createActivity = mutation({
  args: {
    name: v.string(),
    category: v.optional(v.string()),
    dueAfterMs: v.optional(v.number()),
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
    category: v.optional(v.string()),
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
    category: categoryInput,
    dueAfterMs: dueAfterInput,
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
    category: categoryInput,
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

export const listForMcp = internalQuery({
  args: {
    userId: v.string(),
    now: v.number(),
    soonWindowMs: v.number(),
    kind: v.optional(signalKind),
    category: v.optional(v.string()),
    attention: v.optional(signalAttention),
  },
  returns: v.array(signalDashboardItemValidator),
  handler: async (ctx, args) => {
    return await listDashboardForUser(ctx, args);
  },
});

export const recordFromMcp = internalMutation({
  args: {
    userId: v.string(),
    signalId: v.id("signals"),
    idempotencyKey: v.string(),
    operation: recordOperationInput,
    now: v.number(),
    soonWindowMs: v.number(),
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
