import type { Id } from "../_generated/dataModel";
import {
  hasRequiredScope,
  SIGNALS_READ_SCOPE,
  SIGNALS_WRITE_SCOPE,
  type ParsedMcpScopes,
} from "../mcpScopes";
import { mcpError, mcpToolResult, type McpToolDescriptor } from "./common";

const DEFAULT_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type ScorecardMemberRole = "required" | "optional";

type ScorecardMemberInput =
  | {
      type: "signal";
      signalId: Id<"signals">;
      role: ScorecardMemberRole;
    }
  | {
      type: "scorecard";
      scorecardId: Id<"scorecards">;
      role: ScorecardMemberRole;
    };

type ManageScorecardOperation =
  | {
      type: "scorecard.create";
      name: string;
      tagIds: Id<"tags">[];
      members: ScorecardMemberInput[];
      optionalQuota: number;
      targetCount?: number;
    }
  | {
      type: "scorecard.update";
      scorecardId: Id<"scorecards">;
      name?: string;
      tagIds?: Id<"tags">[];
      members?: ScorecardMemberInput[];
      optionalQuota?: number;
      targetCount?: number | null;
    }
  | {
      type: "scorecard.archive";
      scorecardId: Id<"scorecards">;
      archived: boolean;
    };

type ScorecardToolHandler = (
  rpcId: unknown,
  sessionUserId: string,
  parsedScopes: ParsedMcpScopes,
  rawArgs: unknown,
) => Promise<Response>;

export type ScorecardExecutors = {
  read: (args: {
    userId: string;
    tagRootId?: Id<"tags">;
    now: number;
    soonWindowMs: number;
    tagId?: Id<"tags">;
    scorecardId?: Id<"scorecards">;
  }) => Promise<unknown>;
  manage: (args: {
    userId: string;
    tagRootId?: Id<"tags">;
    operation: ManageScorecardOperation;
    now: number;
  }) => Promise<unknown>;
};

const tagIdsSchema = {
  type: "array",
  uniqueItems: true,
  items: { type: "string", minLength: 1 },
};

const membersSchema = {
  type: "array",
  minItems: 1,
  items: {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["signalId", "role"],
        properties: {
          type: { const: "signal" },
          signalId: { type: "string", minLength: 1 },
          role: { type: "string", enum: ["required", "optional"] },
        },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["type", "scorecardId", "role"],
        properties: {
          type: { const: "scorecard" },
          scorecardId: { type: "string", minLength: 1 },
          role: { type: "string", enum: ["required", "optional"] },
        },
      },
    ],
  },
};

export const scorecardToolDescriptors: McpToolDescriptor[] = [
  {
    name: "readScorecards",
    description:
      "Read the authenticated user's scorecards with member completion and rollup progress. Without targetCount, a scorecard is complete when every required member is complete and at least optionalQuota optional members are complete; count is floor(optionalDoneCount / optionalQuota) when quota > 0. With targetCount, members contribute period completedCount (or nested card count, or 1 if complete) and the card is complete when requireds are done and the sum reaches targetCount; count is that sum. Members are signals or other scorecards.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        scorecardId: {
          type: "string",
          description: "Optional scorecard ID to read a single scorecard.",
        },
        tagId: {
          type: "string",
          description:
            "Optional Tasky tag ID. Matches scorecards tagged with this tag or any descendant tag.",
        },
        now: {
          type: "number",
          description:
            "Unix timestamp in milliseconds used for deterministic evaluation. Defaults to the server's current time.",
        },
        soonWindowMs: {
          type: "number",
          minimum: 0,
          description:
            "How far ahead to classify member signals as soon. Defaults to seven days.",
        },
      },
    },
  },
  {
    name: "manageScorecard",
    description:
      "Create, update, archive, or restore a scorecard. Members are an ordered list of signals or other scorecards with required or optional roles. Signal members may omit type or use type: signal. Nested scorecards use type: scorecard and scorecardId. optionalQuota is how many optional members must be fully complete when targetCount is omitted. targetCount is a session goal: member counts are summed (period occurrences, nested card count, or 1 if complete). On update, targetCount null clears it.",
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
              required: ["type", "name", "tagIds", "members", "optionalQuota"],
              properties: {
                type: { const: "scorecard.create" },
                name: { type: "string" },
                tagIds: tagIdsSchema,
                members: membersSchema,
                optionalQuota: { type: "integer", minimum: 0 },
                targetCount: { type: "integer", minimum: 1 },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["type", "scorecardId"],
              properties: {
                type: { const: "scorecard.update" },
                scorecardId: { type: "string" },
                name: { type: "string" },
                tagIds: tagIdsSchema,
                members: membersSchema,
                optionalQuota: { type: "integer", minimum: 0 },
                targetCount: {
                  anyOf: [
                    { type: "integer", minimum: 1 },
                    { type: "null" },
                  ],
                },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["type", "scorecardId", "archived"],
              properties: {
                type: { const: "scorecard.archive" },
                scorecardId: { type: "string" },
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
  options?: { minimum?: number },
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
  const tagIds: Id<"tags">[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      return {
        error: mcpError(rpcId, -32602, `${fieldName} must contain tag IDs`),
      };
    }
    tagIds.push(item as Id<"tags">);
  }
  return { value: tagIds };
}

function parseOptionalTargetCount(
  rpcId: unknown,
  value: unknown,
  allowNull: boolean,
): { value?: number | null; error?: Response } {
  if (value === undefined) {
    return {};
  }
  if (value === null) {
    if (!allowNull) {
      return {
        error: mcpError(rpcId, -32602, "targetCount must be a positive integer"),
      };
    }
    return { value: null };
  }
  const parsed = parseFiniteNumber(rpcId, value, "targetCount", { minimum: 1 });
  if (parsed.error || parsed.value === undefined) {
    return {
      error: parsed.error ?? mcpError(rpcId, -32602, "Invalid targetCount"),
    };
  }
  if (!Number.isInteger(parsed.value)) {
    return {
      error: mcpError(rpcId, -32602, "targetCount must be an integer"),
    };
  }
  return { value: parsed.value };
}

function parseMembers(
  rpcId: unknown,
  value: unknown,
  fieldName: string,
  required: boolean,
): { value?: ScorecardMemberInput[]; error?: Response } {
  if (value === undefined && !required) {
    return {};
  }
  if (!Array.isArray(value) || value.length === 0) {
    return {
      error: mcpError(rpcId, -32602, `${fieldName} must be a non-empty array`),
    };
  }
  const members: ScorecardMemberInput[] = [];
  for (const item of value) {
    const parsed = parseStrictObject(
      rpcId,
      item,
      ["type", "signalId", "scorecardId", "role"],
      "member",
    );
    if (parsed.error || !parsed.value) {
      return {
        error: parsed.error ?? mcpError(rpcId, -32602, "Invalid member"),
      };
    }
    if (
      parsed.value.role !== "required" &&
      parsed.value.role !== "optional"
    ) {
      return { error: mcpError(rpcId, -32602, "member.role is invalid") };
    }
    const memberType = parsed.value.type;
    if (memberType === "scorecard") {
      if (
        typeof parsed.value.scorecardId !== "string" ||
        !parsed.value.scorecardId.trim()
      ) {
        return {
          error: mcpError(rpcId, -32602, "member.scorecardId is required"),
        };
      }
      members.push({
        type: "scorecard",
        scorecardId: parsed.value.scorecardId as Id<"scorecards">,
        role: parsed.value.role,
      });
      continue;
    }
    if (memberType !== undefined && memberType !== "signal") {
      return { error: mcpError(rpcId, -32602, "member.type is invalid") };
    }
    if (
      typeof parsed.value.signalId !== "string" ||
      !parsed.value.signalId.trim()
    ) {
      return { error: mcpError(rpcId, -32602, "member.signalId is required") };
    }
    members.push({
      type: "signal",
      signalId: parsed.value.signalId as Id<"signals">,
      role: parsed.value.role,
    });
  }
  return { value: members };
}

function parseManageOperation(
  rpcId: unknown,
  input: unknown,
): { value?: ManageScorecardOperation; error?: Response } {
  const parsed = parseStrictObject(
    rpcId,
    input,
    [
      "type",
      "name",
      "tagIds",
      "members",
      "optionalQuota",
      "targetCount",
      "scorecardId",
      "archived",
    ],
    "operation",
  );
  if (parsed.error || !parsed.value) {
    return {
      error: parsed.error ?? mcpError(rpcId, -32602, "Invalid operation"),
    };
  }
  const type = parsed.value.type;
  if (type === "scorecard.create") {
    if (typeof parsed.value.name !== "string" || !parsed.value.name.trim()) {
      return { error: mcpError(rpcId, -32602, "name is required") };
    }
    const tagIds = parseTagIds(rpcId, parsed.value.tagIds, "tagIds", true);
    if (tagIds.error || tagIds.value === undefined) {
      return { error: tagIds.error ?? mcpError(rpcId, -32602, "Invalid tagIds") };
    }
    const members = parseMembers(rpcId, parsed.value.members, "members", true);
    if (members.error || members.value === undefined) {
      return {
        error: members.error ?? mcpError(rpcId, -32602, "Invalid members"),
      };
    }
    const quota = parseFiniteNumber(
      rpcId,
      parsed.value.optionalQuota,
      "optionalQuota",
      { minimum: 0 },
    );
    if (quota.error || quota.value === undefined) {
      return {
        error: quota.error ?? mcpError(rpcId, -32602, "Invalid optionalQuota"),
      };
    }
    if (!Number.isInteger(quota.value)) {
      return {
        error: mcpError(rpcId, -32602, "optionalQuota must be an integer"),
      };
    }
    const targetCount = parseOptionalTargetCount(
      rpcId,
      parsed.value.targetCount,
      false,
    );
    if (targetCount.error) {
      return { error: targetCount.error };
    }
    return {
      value: {
        type: "scorecard.create",
        name: parsed.value.name,
        tagIds: tagIds.value,
        members: members.value,
        optionalQuota: quota.value,
        targetCount: targetCount.value ?? undefined,
      },
    };
  }
  if (type === "scorecard.update") {
    if (
      typeof parsed.value.scorecardId !== "string" ||
      !parsed.value.scorecardId.trim()
    ) {
      return { error: mcpError(rpcId, -32602, "scorecardId is required") };
    }
    const name =
      parsed.value.name === undefined
        ? undefined
        : typeof parsed.value.name === "string"
          ? parsed.value.name
          : undefined;
    if (parsed.value.name !== undefined && typeof parsed.value.name !== "string") {
      return { error: mcpError(rpcId, -32602, "name must be a string") };
    }
    const tagIds = parseTagIds(rpcId, parsed.value.tagIds, "tagIds", false);
    if (tagIds.error) {
      return { error: tagIds.error };
    }
    const members = parseMembers(rpcId, parsed.value.members, "members", false);
    if (members.error) {
      return { error: members.error };
    }
    let optionalQuota: number | undefined;
    if (parsed.value.optionalQuota !== undefined) {
      const quota = parseFiniteNumber(
        rpcId,
        parsed.value.optionalQuota,
        "optionalQuota",
        { minimum: 0 },
      );
      if (quota.error || quota.value === undefined) {
        return {
          error: quota.error ?? mcpError(rpcId, -32602, "Invalid optionalQuota"),
        };
      }
      if (!Number.isInteger(quota.value)) {
        return {
          error: mcpError(rpcId, -32602, "optionalQuota must be an integer"),
        };
      }
      optionalQuota = quota.value;
    }
    const targetCount = parseOptionalTargetCount(
      rpcId,
      parsed.value.targetCount,
      true,
    );
    if (targetCount.error) {
      return { error: targetCount.error };
    }
    return {
      value: {
        type: "scorecard.update",
        scorecardId: parsed.value.scorecardId as Id<"scorecards">,
        name,
        tagIds: tagIds.value,
        members: members.value,
        optionalQuota,
        targetCount: targetCount.value,
      },
    };
  }
  if (type === "scorecard.archive") {
    if (
      typeof parsed.value.scorecardId !== "string" ||
      !parsed.value.scorecardId.trim()
    ) {
      return { error: mcpError(rpcId, -32602, "scorecardId is required") };
    }
    if (typeof parsed.value.archived !== "boolean") {
      return { error: mcpError(rpcId, -32602, "archived must be a boolean") };
    }
    return {
      value: {
        type: "scorecard.archive",
        scorecardId: parsed.value.scorecardId as Id<"scorecards">,
        archived: parsed.value.archived,
      },
    };
  }
  return { error: mcpError(rpcId, -32602, "Invalid manage operation") };
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

export function createScorecardToolHandlers(
  executors: ScorecardExecutors,
): Record<string, ScorecardToolHandler> {
  return {
    readScorecards: async (rpcId, sessionUserId, parsedScopes, rawArgs) => {
      if (!hasRequiredScope(parsedScopes, SIGNALS_READ_SCOPE)) {
        return mcpError(
          rpcId,
          -32001,
          `Missing required scope: ${SIGNALS_READ_SCOPE}`,
        );
      }
      const parsed = parseStrictObject(rpcId, rawArgs ?? {}, [
        "scorecardId",
        "tagId",
        "now",
        "soonWindowMs",
      ]);
      if (parsed.error || !parsed.value) {
        return parsed.error ?? mcpError(rpcId, -32602, "Invalid arguments");
      }
      const scorecardId = parseOptionalText(
        rpcId,
        parsed.value.scorecardId,
        "scorecardId",
      );
      if (scorecardId.error) {
        return scorecardId.error;
      }
      const tagId = parseOptionalText(rpcId, parsed.value.tagId, "tagId");
      if (tagId.error) {
        return tagId.error;
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
          tagId: tagId.value as Id<"tags"> | undefined,
          scorecardId: scorecardId.value as Id<"scorecards"> | undefined,
        });
      });
    },
    manageScorecard: async (rpcId, sessionUserId, parsedScopes, rawArgs) => {
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
          operation.error ??
          mcpError(rpcId, -32602, "Invalid manage operation")
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
