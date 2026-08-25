import type { Id } from "../_generated/dataModel";
import {
  hasRequiredScope,
  SIGNALS_READ_SCOPE,
  SIGNALS_WRITE_SCOPE,
  type ParsedMcpScopes,
} from "../mcpScopes";
import { mcpError, mcpToolResult, type McpToolDescriptor } from "./common";

const DEFAULT_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type SignalKind = "activity" | "inventory";
type SignalAttention = "ok" | "soon" | "due" | "unknown";
type InventoryComparison = "atOrBelow" | "atOrAbove";

type InventoryThreshold = {
  value: number;
  comparison: InventoryComparison;
};

type InventoryFlow = {
  amount: number;
  everyDays: number;
};

type ActivityTarget =
  | {
      type: "recency";
      dueAfterMs: number;
    }
  | {
      type: "period";
      period: "day" | "week";
      targetCount: number;
    };

type RecordSignalOperation =
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

type ManageSignalOperation =
  | {
      type: "activity.create";
      name: string;
      tagIds: Id<"tags">[];
      target?: ActivityTarget;
    }
  | {
      type: "inventory.create";
      name: string;
      tagIds: Id<"tags">[];
      unit: string;
      initialQuantity: number;
      threshold: InventoryThreshold;
      flow?: InventoryFlow;
    }
  | {
      type: "activity.update";
      signalId: Id<"signals">;
      name?: string;
      tagIds?: Id<"tags">[];
      target?: ActivityTarget | null;
    }
  | {
      type: "inventory.update";
      signalId: Id<"signals">;
      name?: string;
      tagIds?: Id<"tags">[];
      unit?: string;
      threshold?: InventoryThreshold;
      flow?: InventoryFlow | null;
    }
  | {
      type: "signal.archive";
      signalId: Id<"signals">;
      archived: boolean;
    };

type SignalToolHandler = (
  rpcId: unknown,
  sessionUserId: string,
  parsedScopes: ParsedMcpScopes,
  rawArgs: unknown,
) => Promise<Response>;

export type SignalExecutors = {
  read: (args: {
    userId: string;
    tagRootId?: Id<"tags">;
    now: number;
    soonWindowMs: number;
    kind?: SignalKind;
    tagId?: Id<"tags">;
    attention?: SignalAttention;
  }) => Promise<unknown>;
  record: (args: {
    userId: string;
    tagRootId?: Id<"tags">;
    signalId: Id<"signals">;
    idempotencyKey: string;
    operation: RecordSignalOperation;
    now: number;
    soonWindowMs: number;
  }) => Promise<unknown>;
  manage: (args: {
    userId: string;
    tagRootId?: Id<"tags">;
    operation: ManageSignalOperation;
    now: number;
  }) => Promise<unknown>;
};

const thresholdSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value", "comparison"],
  properties: {
    value: { type: "number", minimum: 0 },
    comparison: {
      type: "string",
      enum: ["atOrBelow", "atOrAbove"],
    },
  },
};

const flowSchema = {
  type: "object",
  additionalProperties: false,
  required: ["amount", "everyDays"],
  properties: {
    amount: { type: "number" },
    everyDays: { type: "number", exclusiveMinimum: 0 },
  },
};

const tagIdsSchema = {
  type: "array",
  uniqueItems: true,
  items: { type: "string", minLength: 1 },
};

const activityTargetSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "dueAfterMs"],
      properties: {
        type: { const: "recency" },
        dueAfterMs: { type: "number", exclusiveMinimum: 0 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "period", "targetCount"],
      properties: {
        type: { const: "period" },
        period: { type: "string", enum: ["day", "week"] },
        targetCount: {
          type: "integer",
          minimum: 1,
        },
      },
    },
  ],
};

export const signalToolDescriptors: McpToolDescriptor[] = [
  {
    name: "readSignals",
    description:
      "Read the authenticated user's activity and inventory signal dashboard, ordered by attention, plus the Tasky tag catalog needed to filter or manage signals. Inventory quantities are projections from the last confirmed state.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: {
          type: "string",
          enum: ["activity", "inventory"],
        },
        tagId: {
          type: "string",
          description:
            "Optional Tasky tag ID. Matches signals tagged with this tag or any descendant tag.",
        },
        attention: {
          type: "string",
          enum: ["ok", "soon", "due", "unknown"],
        },
        now: {
          type: "number",
          description:
            "Unix timestamp in milliseconds used for deterministic status evaluation. Defaults to the server's current time.",
        },
        soonWindowMs: {
          type: "number",
          minimum: 0,
          description:
            "How far ahead to classify a signal as soon. Defaults to seven days.",
        },
      },
    },
  },
  {
    name: "recordSignal",
    description:
      "Record an activity occurrence or adjust/set an inventory. Writes require an idempotency key so retries cannot double-apply.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["signalId", "idempotencyKey", "operation"],
      properties: {
        signalId: { type: "string" },
        idempotencyKey: { type: "string", minLength: 1 },
        soonWindowMs: {
          type: "number",
          minimum: 0,
          description:
            "How far ahead to classify the returned signal as soon. Defaults to seven days.",
        },
        operation: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["type"],
              properties: {
                type: { const: "activity.occurred" },
                occurredAt: {
                  type: "number",
                  description:
                    "Optional backdated Unix timestamp in milliseconds.",
                },
                note: { type: "string" },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["type", "amount"],
              properties: {
                type: { const: "inventory.adjusted" },
                amount: { type: "number" },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["type", "quantity"],
              properties: {
                type: { const: "inventory.set" },
                quantity: { type: "number", minimum: 0 },
              },
            },
          ],
        },
      },
    },
  },
  {
    name: "manageSignal",
    description:
      "Create, update, archive, or restore an activity/inventory signal for the authenticated user.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["operation"],
      properties: {
        operation: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["type", "name", "tagIds"],
              properties: {
                type: { const: "activity.create" },
                name: { type: "string" },
                tagIds: tagIdsSchema,
                target: activityTargetSchema,
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: [
                "type",
                "name",
                "tagIds",
                "unit",
                "initialQuantity",
                "threshold",
              ],
              properties: {
                type: { const: "inventory.create" },
                name: { type: "string" },
                tagIds: tagIdsSchema,
                unit: { type: "string" },
                initialQuantity: { type: "number", minimum: 0 },
                threshold: thresholdSchema,
                flow: flowSchema,
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["type", "signalId"],
              properties: {
                type: { const: "activity.update" },
                signalId: { type: "string" },
                name: { type: "string" },
                tagIds: tagIdsSchema,
                target: {
                  oneOf: [activityTargetSchema, { type: "null" }],
                },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["type", "signalId"],
              properties: {
                type: { const: "inventory.update" },
                signalId: { type: "string" },
                name: { type: "string" },
                tagIds: tagIdsSchema,
                unit: { type: "string" },
                threshold: thresholdSchema,
                flow: {
                  oneOf: [flowSchema, { type: "null" }],
                },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["type", "signalId", "archived"],
              properties: {
                type: { const: "signal.archive" },
                signalId: { type: "string" },
                archived: { type: "boolean" },
              },
            },
          ],
        },
      },
    },
  },
];

function parseStrictObject(
  rpcId: unknown,
  input: unknown,
  allowedKeys: readonly string[],
  fieldName = "arguments",
): { value?: Record<string, unknown>; error?: Response } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      error: mcpError(rpcId, -32602, `${fieldName} must be an object`),
    };
  }
  const value = input as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      return {
        error: mcpError(rpcId, -32602, `Unexpected ${fieldName} field: ${key}`),
      };
    }
  }
  return { value };
}

function parseFiniteNumber(
  rpcId: unknown,
  value: unknown,
  fieldName: string,
  options?: { minimum?: number; exclusiveMinimum?: number },
): { value?: number; error?: Response } {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {
      error: mcpError(rpcId, -32602, `${fieldName} must be a finite number`),
    };
  }
  if (options?.minimum !== undefined && value < options.minimum) {
    return {
      error: mcpError(
        rpcId,
        -32602,
        `${fieldName} must be at least ${options.minimum}`,
      ),
    };
  }
  if (
    options?.exclusiveMinimum !== undefined &&
    value <= options.exclusiveMinimum
  ) {
    return {
      error: mcpError(
        rpcId,
        -32602,
        `${fieldName} must be greater than ${options.exclusiveMinimum}`,
      ),
    };
  }
  return { value };
}

function parseOptionalText(
  rpcId: unknown,
  value: unknown,
  fieldName: string,
): { value?: string; error?: Response } {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "string") {
    return {
      error: mcpError(rpcId, -32602, `${fieldName} must be a string`),
    };
  }
  return { value };
}

function parseTagIds(
  rpcId: unknown,
  value: unknown,
  fieldName: string,
  required: boolean,
): { value?: Id<"tags">[]; error?: Response } {
  if (value === undefined && !required) {
    return {};
  }
  if (!Array.isArray(value)) {
    return {
      error: mcpError(rpcId, -32602, `${fieldName} must be an array`),
    };
  }
  if (value.some((tagId) => typeof tagId !== "string" || !tagId.trim())) {
    return {
      error: mcpError(
        rpcId,
        -32602,
        `${fieldName} must contain only non-empty tag IDs`,
      ),
    };
  }
  return {
    value: Array.from(new Set(value as string[])) as Id<"tags">[],
  };
}

function parseActivityTarget(
  rpcId: unknown,
  input: unknown,
  required: boolean,
): { value?: ActivityTarget; error?: Response } {
  if (input === undefined && !required) {
    return {};
  }
  const object = parseStrictObject(
    rpcId,
    input,
    ["type", "dueAfterMs", "period", "targetCount"],
    "target",
  );
  if (object.error || !object.value) {
    return { error: object.error };
  }
  if (object.value.type === "recency") {
    const recency = parseStrictObject(
      rpcId,
      input,
      ["type", "dueAfterMs"],
      "target",
    );
    if (recency.error || !recency.value) {
      return { error: recency.error };
    }
    const dueAfterMs = parseFiniteNumber(
      rpcId,
      recency.value.dueAfterMs,
      "target.dueAfterMs",
      { exclusiveMinimum: 0 },
    );
    if (dueAfterMs.error || dueAfterMs.value === undefined) {
      return { error: dueAfterMs.error };
    }
    return {
      value: {
        type: "recency",
        dueAfterMs: dueAfterMs.value,
      },
    };
  }
  if (object.value.type === "period") {
    const periodTarget = parseStrictObject(
      rpcId,
      input,
      ["type", "period", "targetCount"],
      "target",
    );
    if (periodTarget.error || !periodTarget.value) {
      return { error: periodTarget.error };
    }
    const period = periodTarget.value.period;
    if (period !== "day" && period !== "week") {
      return {
        error: mcpError(rpcId, -32602, "target.period must be day or week"),
      };
    }
    const targetCount = parseFiniteNumber(
      rpcId,
      periodTarget.value.targetCount,
      "target.targetCount",
      { exclusiveMinimum: 0 },
    );
    if (targetCount.error || targetCount.value === undefined) {
      return { error: targetCount.error };
    }
    if (!Number.isInteger(targetCount.value)) {
      return {
        error: mcpError(rpcId, -32602, "target.targetCount must be an integer"),
      };
    }
    return {
      value: {
        type: "period",
        period,
        targetCount: targetCount.value,
      },
    };
  }
  return {
    error: mcpError(rpcId, -32602, "target.type must be recency or period"),
  };
}

function parseThreshold(
  rpcId: unknown,
  input: unknown,
  required: boolean,
): { value?: InventoryThreshold; error?: Response } {
  if (input === undefined && !required) {
    return {};
  }
  const object = parseStrictObject(
    rpcId,
    input,
    ["value", "comparison"],
    "threshold",
  );
  if (object.error || !object.value) {
    return { error: object.error };
  }
  const number = parseFiniteNumber(
    rpcId,
    object.value.value,
    "threshold.value",
    { minimum: 0 },
  );
  if (number.error || number.value === undefined) {
    return { error: number.error };
  }
  const comparison = object.value.comparison;
  if (comparison !== "atOrBelow" && comparison !== "atOrAbove") {
    return {
      error: mcpError(
        rpcId,
        -32602,
        "threshold.comparison must be atOrBelow or atOrAbove",
      ),
    };
  }
  return {
    value: {
      value: number.value,
      comparison,
    },
  };
}

function parseFlow(
  rpcId: unknown,
  input: unknown,
): { value?: InventoryFlow; error?: Response } {
  if (input === undefined) {
    return {};
  }
  const object = parseStrictObject(
    rpcId,
    input,
    ["amount", "everyDays"],
    "flow",
  );
  if (object.error || !object.value) {
    return { error: object.error };
  }
  const amount = parseFiniteNumber(rpcId, object.value.amount, "flow.amount");
  if (amount.error || amount.value === undefined) {
    return { error: amount.error };
  }
  if (amount.value === 0) {
    return {
      error: mcpError(rpcId, -32602, "flow.amount must not be zero"),
    };
  }
  const everyDays = parseFiniteNumber(
    rpcId,
    object.value.everyDays,
    "flow.everyDays",
    { exclusiveMinimum: 0 },
  );
  if (everyDays.error || everyDays.value === undefined) {
    return { error: everyDays.error };
  }
  return {
    value: {
      amount: amount.value,
      everyDays: everyDays.value,
    },
  };
}

function parseRecordOperation(
  rpcId: unknown,
  input: unknown,
): { value?: RecordSignalOperation; error?: Response } {
  const base = parseStrictObject(
    rpcId,
    input,
    ["type", "occurredAt", "note", "amount", "quantity"],
    "operation",
  );
  if (base.error || !base.value) {
    return { error: base.error };
  }
  const type = base.value.type;
  if (type === "activity.occurred") {
    const operation = parseStrictObject(
      rpcId,
      input,
      ["type", "occurredAt", "note"],
      "operation",
    );
    if (operation.error || !operation.value) {
      return { error: operation.error };
    }
    let occurredAt: number | undefined;
    if (operation.value.occurredAt !== undefined) {
      const parsed = parseFiniteNumber(
        rpcId,
        operation.value.occurredAt,
        "operation.occurredAt",
      );
      if (parsed.error || parsed.value === undefined) {
        return { error: parsed.error };
      }
      occurredAt = parsed.value;
    }
    const note = parseOptionalText(
      rpcId,
      operation.value.note,
      "operation.note",
    );
    if (note.error) {
      return { error: note.error };
    }
    return {
      value: {
        type,
        occurredAt,
        note: note.value,
      },
    };
  }
  if (type === "inventory.adjusted") {
    const operation = parseStrictObject(
      rpcId,
      input,
      ["type", "amount"],
      "operation",
    );
    if (operation.error || !operation.value) {
      return { error: operation.error };
    }
    const amount = parseFiniteNumber(
      rpcId,
      operation.value.amount,
      "operation.amount",
    );
    if (amount.error || amount.value === undefined) {
      return { error: amount.error };
    }
    if (amount.value === 0) {
      return {
        error: mcpError(rpcId, -32602, "operation.amount must not be zero"),
      };
    }
    return { value: { type, amount: amount.value } };
  }
  if (type === "inventory.set") {
    const operation = parseStrictObject(
      rpcId,
      input,
      ["type", "quantity"],
      "operation",
    );
    if (operation.error || !operation.value) {
      return { error: operation.error };
    }
    const quantity = parseFiniteNumber(
      rpcId,
      operation.value.quantity,
      "operation.quantity",
      { minimum: 0 },
    );
    if (quantity.error || quantity.value === undefined) {
      return { error: quantity.error };
    }
    return { value: { type, quantity: quantity.value } };
  }
  return {
    error: mcpError(rpcId, -32602, "Invalid signal operation type"),
  };
}

function parseManageOperation(
  rpcId: unknown,
  input: unknown,
): { value?: ManageSignalOperation; error?: Response } {
  const base = parseStrictObject(
    rpcId,
    input,
    [
      "type",
      "signalId",
      "name",
      "tagIds",
      "target",
      "unit",
      "initialQuantity",
      "threshold",
      "flow",
      "archived",
    ],
    "operation",
  );
  if (base.error || !base.value) {
    return { error: base.error };
  }
  const type = base.value.type;
  if (type === "activity.create") {
    const operation = parseStrictObject(
      rpcId,
      input,
      ["type", "name", "tagIds", "target"],
      "operation",
    );
    if (operation.error || !operation.value) {
      return { error: operation.error };
    }
    if (typeof operation.value.name !== "string") {
      return {
        error: mcpError(rpcId, -32602, "operation.name is required"),
      };
    }
    const tagIds = parseTagIds(
      rpcId,
      operation.value.tagIds,
      "operation.tagIds",
      true,
    );
    if (tagIds.error || !tagIds.value) {
      return { error: tagIds.error };
    }
    const target = parseActivityTarget(rpcId, operation.value.target, false);
    if (target.error) {
      return { error: target.error };
    }
    return {
      value: {
        type,
        name: operation.value.name,
        tagIds: tagIds.value,
        target: target.value,
      },
    };
  }
  if (type === "inventory.create") {
    const operation = parseStrictObject(
      rpcId,
      input,
      [
        "type",
        "name",
        "tagIds",
        "unit",
        "initialQuantity",
        "threshold",
        "flow",
      ],
      "operation",
    );
    if (operation.error || !operation.value) {
      return { error: operation.error };
    }
    if (
      typeof operation.value.name !== "string" ||
      typeof operation.value.unit !== "string"
    ) {
      return {
        error: mcpError(
          rpcId,
          -32602,
          "operation.name and operation.unit are required",
        ),
      };
    }
    const tagIds = parseTagIds(
      rpcId,
      operation.value.tagIds,
      "operation.tagIds",
      true,
    );
    if (tagIds.error || !tagIds.value) {
      return { error: tagIds.error };
    }
    const initialQuantity = parseFiniteNumber(
      rpcId,
      operation.value.initialQuantity,
      "operation.initialQuantity",
      { minimum: 0 },
    );
    if (initialQuantity.error || initialQuantity.value === undefined) {
      return { error: initialQuantity.error };
    }
    const threshold = parseThreshold(rpcId, operation.value.threshold, true);
    if (threshold.error || !threshold.value) {
      return { error: threshold.error };
    }
    const flow = parseFlow(rpcId, operation.value.flow);
    if (flow.error) {
      return { error: flow.error };
    }
    return {
      value: {
        type,
        name: operation.value.name,
        tagIds: tagIds.value,
        unit: operation.value.unit,
        initialQuantity: initialQuantity.value,
        threshold: threshold.value,
        flow: flow.value,
      },
    };
  }
  if (type === "activity.update") {
    const operation = parseStrictObject(
      rpcId,
      input,
      ["type", "signalId", "name", "tagIds", "target"],
      "operation",
    );
    if (operation.error || !operation.value) {
      return { error: operation.error };
    }
    if (typeof operation.value.signalId !== "string") {
      return {
        error: mcpError(rpcId, -32602, "operation.signalId is required"),
      };
    }
    const name = parseOptionalText(
      rpcId,
      operation.value.name,
      "operation.name",
    );
    if (name.error) {
      return { error: name.error };
    }
    const tagIds = parseTagIds(
      rpcId,
      operation.value.tagIds,
      "operation.tagIds",
      false,
    );
    if (tagIds.error) {
      return { error: tagIds.error };
    }
    let target: ActivityTarget | null | undefined;
    if (operation.value.target === null) {
      target = null;
    } else {
      const parsedTarget = parseActivityTarget(
        rpcId,
        operation.value.target,
        false,
      );
      if (parsedTarget.error) {
        return { error: parsedTarget.error };
      }
      target = parsedTarget.value;
    }
    return {
      value: {
        type,
        signalId: operation.value.signalId as Id<"signals">,
        name: name.value,
        tagIds: tagIds.value,
        target,
      },
    };
  }
  if (type === "inventory.update") {
    const operation = parseStrictObject(
      rpcId,
      input,
      ["type", "signalId", "name", "tagIds", "unit", "threshold", "flow"],
      "operation",
    );
    if (operation.error || !operation.value) {
      return { error: operation.error };
    }
    if (typeof operation.value.signalId !== "string") {
      return {
        error: mcpError(rpcId, -32602, "operation.signalId is required"),
      };
    }
    const name = parseOptionalText(
      rpcId,
      operation.value.name,
      "operation.name",
    );
    const unit = parseOptionalText(
      rpcId,
      operation.value.unit,
      "operation.unit",
    );
    if (name.error || unit.error) {
      return { error: name.error ?? unit.error };
    }
    const tagIds = parseTagIds(
      rpcId,
      operation.value.tagIds,
      "operation.tagIds",
      false,
    );
    if (tagIds.error) {
      return { error: tagIds.error };
    }
    const threshold = parseThreshold(rpcId, operation.value.threshold, false);
    if (threshold.error) {
      return { error: threshold.error };
    }
    let flow: InventoryFlow | null | undefined;
    if (operation.value.flow === null) {
      flow = null;
    } else {
      const parsed = parseFlow(rpcId, operation.value.flow);
      if (parsed.error) {
        return { error: parsed.error };
      }
      flow = parsed.value;
    }
    return {
      value: {
        type,
        signalId: operation.value.signalId as Id<"signals">,
        name: name.value,
        tagIds: tagIds.value,
        unit: unit.value,
        threshold: threshold.value,
        flow,
      },
    };
  }
  if (type === "signal.archive") {
    const operation = parseStrictObject(
      rpcId,
      input,
      ["type", "signalId", "archived"],
      "operation",
    );
    if (operation.error || !operation.value) {
      return { error: operation.error };
    }
    if (
      typeof operation.value.signalId !== "string" ||
      typeof operation.value.archived !== "boolean"
    ) {
      return {
        error: mcpError(
          rpcId,
          -32602,
          "operation.signalId and operation.archived are required",
        ),
      };
    }
    return {
      value: {
        type,
        signalId: operation.value.signalId as Id<"signals">,
        archived: operation.value.archived,
      },
    };
  }
  return {
    error: mcpError(rpcId, -32602, "Invalid manage operation type"),
  };
}

async function executeTool(
  rpcId: unknown,
  execute: () => Promise<unknown>,
): Promise<Response> {
  try {
    return mcpToolResult(rpcId, await execute());
  } catch (error) {
    return mcpError(
      rpcId,
      -32000,
      error instanceof Error ? error.message : "Tool execution failed",
    );
  }
}

export function createSignalToolHandlers(
  executors: SignalExecutors,
): Record<string, SignalToolHandler> {
  return {
    readSignals: async (rpcId, sessionUserId, parsedScopes, rawArgs) => {
      if (!hasRequiredScope(parsedScopes, SIGNALS_READ_SCOPE)) {
        return mcpError(
          rpcId,
          -32001,
          `Missing required scope: ${SIGNALS_READ_SCOPE}`,
        );
      }
      const parsed = parseStrictObject(rpcId, rawArgs ?? {}, [
        "kind",
        "tagId",
        "attention",
        "now",
        "soonWindowMs",
      ]);
      if (parsed.error || !parsed.value) {
        return parsed.error ?? mcpError(rpcId, -32602, "Invalid arguments");
      }
      const kind = parsed.value.kind;
      if (kind !== undefined && kind !== "activity" && kind !== "inventory") {
        return mcpError(rpcId, -32602, "Invalid kind");
      }
      const attention = parsed.value.attention;
      if (
        attention !== undefined &&
        attention !== "ok" &&
        attention !== "soon" &&
        attention !== "due" &&
        attention !== "unknown"
      ) {
        return mcpError(rpcId, -32602, "Invalid attention");
      }
      const tagId = parseOptionalText(rpcId, parsed.value.tagId, "tagId");
      if (tagId.error) {
        return tagId.error;
      }
      if (tagId.value !== undefined && !tagId.value.trim()) {
        return mcpError(rpcId, -32602, "tagId must not be empty");
      }
      let now = Date.now();
      if (parsed.value.now !== undefined) {
        const parsedNow = parseFiniteNumber(rpcId, parsed.value.now, "now");
        if (parsedNow.error || parsedNow.value === undefined) {
          return parsedNow.error ?? mcpError(rpcId, -32602, "Invalid now");
        }
        now = parsedNow.value;
      }
      let soonWindowMs = DEFAULT_SOON_WINDOW_MS;
      if (parsed.value.soonWindowMs !== undefined) {
        const parsedWindow = parseFiniteNumber(
          rpcId,
          parsed.value.soonWindowMs,
          "soonWindowMs",
          { minimum: 0 },
        );
        if (parsedWindow.error || parsedWindow.value === undefined) {
          return (
            parsedWindow.error ??
            mcpError(rpcId, -32602, "Invalid soonWindowMs")
          );
        }
        soonWindowMs = parsedWindow.value;
      }
      return await executeTool(rpcId, async () => {
        return await executors.read({
          userId: sessionUserId,
          tagRootId: parsedScopes.tagRootId,
          now,
          soonWindowMs,
          kind: kind as SignalKind | undefined,
          tagId: tagId.value as Id<"tags"> | undefined,
          attention: attention as SignalAttention | undefined,
        });
      });
    },
    recordSignal: async (rpcId, sessionUserId, parsedScopes, rawArgs) => {
      if (!hasRequiredScope(parsedScopes, SIGNALS_WRITE_SCOPE)) {
        return mcpError(
          rpcId,
          -32001,
          `Missing required scope: ${SIGNALS_WRITE_SCOPE}`,
        );
      }
      const parsed = parseStrictObject(rpcId, rawArgs, [
        "signalId",
        "idempotencyKey",
        "operation",
        "soonWindowMs",
      ]);
      if (parsed.error || !parsed.value) {
        return parsed.error ?? mcpError(rpcId, -32602, "Invalid arguments");
      }
      if (
        typeof parsed.value.signalId !== "string" ||
        typeof parsed.value.idempotencyKey !== "string" ||
        !parsed.value.idempotencyKey.trim()
      ) {
        return mcpError(
          rpcId,
          -32602,
          "signalId and idempotencyKey are required",
        );
      }
      const operation = parseRecordOperation(rpcId, parsed.value.operation);
      if (operation.error || !operation.value) {
        return (
          operation.error ?? mcpError(rpcId, -32602, "Invalid signal operation")
        );
      }
      let soonWindowMs = DEFAULT_SOON_WINDOW_MS;
      if (parsed.value.soonWindowMs !== undefined) {
        const parsedWindow = parseFiniteNumber(
          rpcId,
          parsed.value.soonWindowMs,
          "soonWindowMs",
          { minimum: 0 },
        );
        if (parsedWindow.error || parsedWindow.value === undefined) {
          return (
            parsedWindow.error ??
            mcpError(rpcId, -32602, "Invalid soonWindowMs")
          );
        }
        soonWindowMs = parsedWindow.value;
      }
      return await executeTool(rpcId, async () => {
        return await executors.record({
          userId: sessionUserId,
          tagRootId: parsedScopes.tagRootId,
          signalId: parsed.value!.signalId as Id<"signals">,
          idempotencyKey: parsed.value!.idempotencyKey as string,
          operation: operation.value!,
          now: Date.now(),
          soonWindowMs,
        });
      });
    },
    manageSignal: async (rpcId, sessionUserId, parsedScopes, rawArgs) => {
      if (!hasRequiredScope(parsedScopes, SIGNALS_WRITE_SCOPE)) {
        return mcpError(
          rpcId,
          -32001,
          `Missing required scope: ${SIGNALS_WRITE_SCOPE}`,
        );
      }
      const parsed = parseStrictObject(rpcId, rawArgs, ["operation"]);
      if (parsed.error || !parsed.value) {
        return parsed.error ?? mcpError(rpcId, -32602, "Invalid arguments");
      }
      const operation = parseManageOperation(rpcId, parsed.value.operation);
      if (operation.error || !operation.value) {
        return (
          operation.error ?? mcpError(rpcId, -32602, "Invalid manage operation")
        );
      }
      return await executeTool(rpcId, async () => {
        return await executors.manage({
          userId: sessionUserId,
          tagRootId: parsedScopes.tagRootId,
          operation: operation.value!,
          now: Date.now(),
        });
      });
    },
  };
}
