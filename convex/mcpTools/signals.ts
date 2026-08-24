import type { Id } from "../_generated/dataModel";
import {
  hasRequiredScope,
  SIGNALS_READ_SCOPE,
  SIGNALS_WRITE_SCOPE,
  type ParsedMcpScopes,
} from "../mcpScopes";
import {
  mcpError,
  mcpToolResult,
  type McpToolDescriptor,
} from "./common";

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
      category?: string;
      dueAfterMs?: number;
    }
  | {
      type: "inventory.create";
      name: string;
      category?: string;
      unit: string;
      initialQuantity: number;
      threshold: InventoryThreshold;
      flow?: InventoryFlow;
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
    now: number;
    soonWindowMs: number;
    kind?: SignalKind;
    category?: string;
    attention?: SignalAttention;
  }) => Promise<unknown>;
  record: (args: {
    userId: string;
    signalId: Id<"signals">;
    idempotencyKey: string;
    operation: RecordSignalOperation;
    now: number;
    soonWindowMs: number;
  }) => Promise<unknown>;
  manage: (args: {
    userId: string;
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

export const signalToolDescriptors: McpToolDescriptor[] = [
  {
    name: "readSignals",
    description:
      "Read the authenticated user's activity and inventory signal dashboard, ordered by attention. Inventory quantities are projections from the last confirmed state.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: {
          type: "string",
          enum: ["activity", "inventory"],
        },
        category: { type: "string" },
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
              required: ["type", "name"],
              properties: {
                type: { const: "activity.create" },
                name: { type: "string" },
                category: { type: "string" },
                dueAfterMs: { type: "number", exclusiveMinimum: 0 },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: [
                "type",
                "name",
                "unit",
                "initialQuantity",
                "threshold",
              ],
              properties: {
                type: { const: "inventory.create" },
                name: { type: "string" },
                category: { type: "string" },
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
                category: {
                  oneOf: [{ type: "string" }, { type: "null" }],
                },
                dueAfterMs: {
                  oneOf: [
                    { type: "number", exclusiveMinimum: 0 },
                    { type: "null" },
                  ],
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
                category: {
                  oneOf: [{ type: "string" }, { type: "null" }],
                },
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
        error: mcpError(
          rpcId,
          -32602,
          `Unexpected ${fieldName} field: ${key}`,
        ),
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
      error: mcpError(
        rpcId,
        -32602,
        `${fieldName} must be a finite number`,
      ),
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
  const amount = parseFiniteNumber(
    rpcId,
    object.value.amount,
    "flow.amount",
  );
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
        error: mcpError(
          rpcId,
          -32602,
          "operation.amount must not be zero",
        ),
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
      "category",
      "dueAfterMs",
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
      ["type", "name", "category", "dueAfterMs"],
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
    const category = parseOptionalText(
      rpcId,
      operation.value.category,
      "operation.category",
    );
    if (category.error) {
      return { error: category.error };
    }
    let dueAfterMs: number | undefined;
    if (operation.value.dueAfterMs !== undefined) {
      const parsed = parseFiniteNumber(
        rpcId,
        operation.value.dueAfterMs,
        "operation.dueAfterMs",
        { exclusiveMinimum: 0 },
      );
      if (parsed.error || parsed.value === undefined) {
        return { error: parsed.error };
      }
      dueAfterMs = parsed.value;
    }
    return {
      value: {
        type,
        name: operation.value.name,
        category: category.value,
        dueAfterMs,
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
        "category",
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
    const category = parseOptionalText(
      rpcId,
      operation.value.category,
      "operation.category",
    );
    if (category.error) {
      return { error: category.error };
    }
    const initialQuantity = parseFiniteNumber(
      rpcId,
      operation.value.initialQuantity,
      "operation.initialQuantity",
      { minimum: 0 },
    );
    if (
      initialQuantity.error ||
      initialQuantity.value === undefined
    ) {
      return { error: initialQuantity.error };
    }
    const threshold = parseThreshold(
      rpcId,
      operation.value.threshold,
      true,
    );
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
        category: category.value,
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
      ["type", "signalId", "name", "category", "dueAfterMs"],
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
    let category: string | null | undefined;
    if (operation.value.category === null) {
      category = null;
    } else {
      const parsed = parseOptionalText(
        rpcId,
        operation.value.category,
        "operation.category",
      );
      if (parsed.error) {
        return { error: parsed.error };
      }
      category = parsed.value;
    }
    let dueAfterMs: number | null | undefined;
    if (operation.value.dueAfterMs === null) {
      dueAfterMs = null;
    } else if (operation.value.dueAfterMs !== undefined) {
      const parsed = parseFiniteNumber(
        rpcId,
        operation.value.dueAfterMs,
        "operation.dueAfterMs",
        { exclusiveMinimum: 0 },
      );
      if (parsed.error || parsed.value === undefined) {
        return { error: parsed.error };
      }
      dueAfterMs = parsed.value;
    }
    return {
      value: {
        type,
        signalId: operation.value.signalId as Id<"signals">,
        name: name.value,
        category,
        dueAfterMs,
      },
    };
  }
  if (type === "inventory.update") {
    const operation = parseStrictObject(
      rpcId,
      input,
      [
        "type",
        "signalId",
        "name",
        "category",
        "unit",
        "threshold",
        "flow",
      ],
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
    let category: string | null | undefined;
    if (operation.value.category === null) {
      category = null;
    } else {
      const parsed = parseOptionalText(
        rpcId,
        operation.value.category,
        "operation.category",
      );
      if (parsed.error) {
        return { error: parsed.error };
      }
      category = parsed.value;
    }
    const threshold = parseThreshold(
      rpcId,
      operation.value.threshold,
      false,
    );
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
        category,
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
    readSignals: async (
      rpcId,
      sessionUserId,
      parsedScopes,
      rawArgs,
    ) => {
      if (!hasRequiredScope(parsedScopes, SIGNALS_READ_SCOPE)) {
        return mcpError(
          rpcId,
          -32001,
          `Missing required scope: ${SIGNALS_READ_SCOPE}`,
        );
      }
      const parsed = parseStrictObject(
        rpcId,
        rawArgs ?? {},
        ["kind", "category", "attention", "now", "soonWindowMs"],
      );
      if (parsed.error || !parsed.value) {
        return parsed.error ?? mcpError(rpcId, -32602, "Invalid arguments");
      }
      const kind = parsed.value.kind;
      if (
        kind !== undefined &&
        kind !== "activity" &&
        kind !== "inventory"
      ) {
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
      const category = parseOptionalText(
        rpcId,
        parsed.value.category,
        "category",
      );
      if (category.error) {
        return category.error;
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
          now,
          soonWindowMs,
          kind: kind as SignalKind | undefined,
          category: category.value,
          attention: attention as SignalAttention | undefined,
        });
      });
    },
    recordSignal: async (
      rpcId,
      sessionUserId,
      parsedScopes,
      rawArgs,
    ) => {
      if (!hasRequiredScope(parsedScopes, SIGNALS_WRITE_SCOPE)) {
        return mcpError(
          rpcId,
          -32001,
          `Missing required scope: ${SIGNALS_WRITE_SCOPE}`,
        );
      }
      const parsed = parseStrictObject(
        rpcId,
        rawArgs,
        ["signalId", "idempotencyKey", "operation", "soonWindowMs"],
      );
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
      const operation = parseRecordOperation(
        rpcId,
        parsed.value.operation,
      );
      if (operation.error || !operation.value) {
        return (
          operation.error ??
          mcpError(rpcId, -32602, "Invalid signal operation")
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
          signalId: parsed.value!.signalId as Id<"signals">,
          idempotencyKey: parsed.value!.idempotencyKey as string,
          operation: operation.value!,
          now: Date.now(),
          soonWindowMs,
        });
      });
    },
    manageSignal: async (
      rpcId,
      sessionUserId,
      parsedScopes,
      rawArgs,
    ) => {
      if (!hasRequiredScope(parsedScopes, SIGNALS_WRITE_SCOPE)) {
        return mcpError(
          rpcId,
          -32001,
          `Missing required scope: ${SIGNALS_WRITE_SCOPE}`,
        );
      }
      const parsed = parseStrictObject(
        rpcId,
        rawArgs,
        ["operation"],
      );
      if (parsed.error || !parsed.value) {
        return parsed.error ?? mcpError(rpcId, -32602, "Invalid arguments");
      }
      const operation = parseManageOperation(
        rpcId,
        parsed.value.operation,
      );
      if (operation.error || !operation.value) {
        return (
          operation.error ??
          mcpError(rpcId, -32602, "Invalid manage operation")
        );
      }
      return await executeTool(rpcId, async () => {
        return await executors.manage({
          userId: sessionUserId,
          operation: operation.value!,
          now: Date.now(),
        });
      });
    },
  };
}
