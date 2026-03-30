import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { createAuth, oauthScopes } from "./auth";
import { oAuthDiscoveryMetadata, oAuthProtectedResourceMetadata, withMcpAuth } from "better-auth/plugins";
import {
  hasRequiredScope,
  splitScopeString,
  TAG_ROOT_PREFIX,
  TASKS_READ_SCOPE,
  TASKS_WRITE_SCOPE,
} from "./mcpScopes";
import type { Id } from "./_generated/dataModel";

const jsonHeaders = {
  "content-type": "application/json",
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function mcpError(id: unknown, code: number, message: string): Response {
  return jsonResponse({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

type ParsedScopes = {
  scopes: Set<string>;
  tagRootId?: Id<"tags">;
};

function mcpToolResult(id: unknown, payload: unknown): Response {
  return jsonResponse({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    },
  });
}

function parseScopes(scopeString: string): ParsedScopes {
  const scopeValues = new Set<string>();
  for (const scope of splitScopeString(scopeString)) {
    scopeValues.add(scope);
  }
  let tagRootId: Id<"tags"> | undefined;
  for (const scope of scopeValues) {
    if (scope.startsWith(TAG_ROOT_PREFIX)) {
      const parsed = scope.slice(TAG_ROOT_PREFIX.length).trim();
      if (parsed) {
        tagRootId = parsed as Id<"tags">;
        break;
      }
    }
  }
  return { scopes: scopeValues, tagRootId };
}

function parseTaskStatuses(input: unknown):
  | Array<"not_started" | "in_progress" | "agent_running" | "blocked" | "closed">
  | undefined {
  if (!Array.isArray(input)) return undefined;
  return input.filter(
    (status): status is "not_started" | "in_progress" | "agent_running" | "blocked" | "closed" =>
      status === "not_started" ||
      status === "in_progress" ||
      status === "agent_running" ||
      status === "blocked" ||
      status === "closed"
  );
}

type TaskStatus = "not_started" | "in_progress" | "agent_running" | "blocked" | "closed";
type TaskPriority = "triage" | "low" | "medium" | "high" | "urgent";

type ParsedTaskMutationArgs = {
  taskId?: Id<"tasks">;
  content?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  addAgent?: string;
  removeAgentById?: Id<"agents">;
  addPullRequestByUrl?: string;
  removePullRequestByUrl?: string;
  addLinearIssueByUrl?: string;
  removeLinearIssueByUrl?: string;
};

type MappedLinearIssueResult = {
  id: Id<"linearIssues">;
  url: string;
  identifier: string;
};

type UpdateTaskFromMcpResult = {
  taskId: Id<"tasks">;
  updatedFields: {
    content: boolean;
    status: boolean;
    priority: boolean;
    dueDate: boolean;
  };
  addedAgent?: {
    id: Id<"agents">;
    externalId: string;
  };
  removedAgent?: {
    id: Id<"agents">;
    externalId: string;
  };
  addedPullRequest?: {
    id: Id<"pullRequests">;
    url: string;
  };
  removedPullRequest?: {
    id: Id<"pullRequests">;
    url: string;
  };
  addedLinearIssue?: MappedLinearIssueResult;
  removedLinearIssue?: MappedLinearIssueResult;
};

type CreateTaskFromMcpResult = {
  taskId: Id<"tasks">;
  addedAgent?: {
    id: Id<"agents">;
    externalId: string;
  };
  addedPullRequest?: {
    id: Id<"pullRequests">;
    url: string;
  };
  addedLinearIssue?: MappedLinearIssueResult;
};

function parseTaskStatus(input: unknown): TaskStatus | undefined {
  if (
    input === "not_started" ||
    input === "in_progress" ||
    input === "agent_running" ||
    input === "blocked" ||
    input === "closed"
  ) {
    return input;
  }
  return undefined;
}

function parseTaskPriority(input: unknown): TaskPriority | undefined {
  if (input === "triage" || input === "low" || input === "medium" || input === "high" || input === "urgent") {
    return input;
  }
  return undefined;
}

function isValidIsoLocalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === year &&
    date.getMonth() === monthIndex &&
    date.getDate() === day
  );
}

function parseTaskMutationArgs(
  rpcId: unknown,
  rawArgs: unknown,
  options: {
    requireTaskId: boolean;
    requireContent: boolean;
    allowRemoveFields: boolean;
  }
): { parsed?: ParsedTaskMutationArgs; error?: Response } {
  if (rawArgs !== undefined && (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs))) {
    return { error: mcpError(rpcId, -32602, "Invalid arguments") };
  }

  const allowedKeys = new Set([
    "content",
    "status",
    "priority",
    "dueDate",
    "addAgent",
    "addPullRequestByUrl",
    "addLinearIssueByUrl",
  ]);
  if (options.requireTaskId) {
    allowedKeys.add("taskId");
  }
  if (options.allowRemoveFields) {
    allowedKeys.add("removeAgentById");
    allowedKeys.add("removePullRequestByUrl");
    allowedKeys.add("removeLinearIssueByUrl");
  }
  for (const key of Object.keys((rawArgs ?? {}) as Record<string, unknown>)) {
    if (!allowedKeys.has(key)) {
      return { error: mcpError(rpcId, -32602, `Unexpected argument: ${key}`) };
    }
  }

  const args = (rawArgs ?? {}) as {
    taskId?: unknown;
    content?: unknown;
    status?: unknown;
    priority?: unknown;
    dueDate?: unknown;
    addAgent?: unknown;
    removeAgentById?: unknown;
    addPullRequestByUrl?: unknown;
    removePullRequestByUrl?: unknown;
    addLinearIssueByUrl?: unknown;
    removeLinearIssueByUrl?: unknown;
  };

  const taskId = typeof args.taskId === "string" ? (args.taskId as Id<"tasks">) : undefined;
  if (options.requireTaskId && !taskId) {
    return { error: mcpError(rpcId, -32602, "taskId is required") };
  }

  if (options.requireContent) {
    if (typeof args.content !== "string" || !args.content.trim()) {
      return { error: mcpError(rpcId, -32602, "content is required and must be a non-empty string") };
    }
  } else if (args.content !== undefined && typeof args.content !== "string") {
    return { error: mcpError(rpcId, -32602, "content must be a string") };
  }

  const status = parseTaskStatus(args.status);
  if (args.status !== undefined && status === undefined) {
    return { error: mcpError(rpcId, -32602, "Invalid status") };
  }

  const priority = parseTaskPriority(args.priority);
  if (args.priority !== undefined && priority === undefined) {
    return { error: mcpError(rpcId, -32602, "Invalid priority") };
  }

  let dueDate: string | null | undefined;
  if (args.dueDate !== undefined) {
    if (args.dueDate === null) {
      dueDate = null;
    } else if (typeof args.dueDate === "string" && isValidIsoLocalDate(args.dueDate)) {
      dueDate = args.dueDate;
    } else {
      return {
        error: mcpError(
          rpcId,
          -32602,
          "dueDate must be null or a valid ISO date string in YYYY-MM-DD format"
        ),
      };
    }
  }

  if (args.addAgent !== undefined && typeof args.addAgent !== "string") {
    return { error: mcpError(rpcId, -32602, "addAgent must be a string") };
  }
  if (args.addPullRequestByUrl !== undefined && typeof args.addPullRequestByUrl !== "string") {
    return { error: mcpError(rpcId, -32602, "addPullRequestByUrl must be a string") };
  }
  if (args.addLinearIssueByUrl !== undefined && typeof args.addLinearIssueByUrl !== "string") {
    return { error: mcpError(rpcId, -32602, "addLinearIssueByUrl must be a string") };
  }
  if (options.allowRemoveFields) {
    if (args.removeAgentById !== undefined && typeof args.removeAgentById !== "string") {
      return { error: mcpError(rpcId, -32602, "removeAgentById must be a string") };
    }
    if (args.removePullRequestByUrl !== undefined && typeof args.removePullRequestByUrl !== "string") {
      return { error: mcpError(rpcId, -32602, "removePullRequestByUrl must be a string") };
    }
    if (args.removeLinearIssueByUrl !== undefined && typeof args.removeLinearIssueByUrl !== "string") {
      return { error: mcpError(rpcId, -32602, "removeLinearIssueByUrl must be a string") };
    }
  }

  return {
    parsed: {
      taskId,
      content: args.content as string | undefined,
      status,
      priority,
      dueDate,
      addAgent: args.addAgent as string | undefined,
      removeAgentById: args.removeAgentById as Id<"agents"> | undefined,
      addPullRequestByUrl: args.addPullRequestByUrl as string | undefined,
      removePullRequestByUrl: args.removePullRequestByUrl as string | undefined,
      addLinearIssueByUrl: args.addLinearIssueByUrl as string | undefined,
      removeLinearIssueByUrl: args.removeLinearIssueByUrl as string | undefined,
    },
  };
}

async function handleReadTasksTool(
  executeListForMcp: (args: {
    userId: string;
    includeClosed: boolean;
    statuses?: Array<"not_started" | "in_progress" | "agent_running" | "blocked" | "closed">;
    tagRootId?: Id<"tags">;
    searchQuery?: string;
    filterTag?: string;
  }) => Promise<unknown>,
  rpcId: unknown,
  sessionUserId: string,
  parsedScopes: ParsedScopes,
  rawArgs: unknown
): Promise<Response> {
  if (!hasRequiredScope(parsedScopes, TASKS_READ_SCOPE)) {
    return mcpError(rpcId, -32001, "Missing required scope: tasks:read");
  }

  if (rawArgs !== undefined && (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs))) {
    return mcpError(rpcId, -32602, "Invalid arguments");
  }

  const args = (rawArgs ?? {}) as {
    includeClosed?: unknown;
    statuses?: unknown;
    searchQuery?: unknown;
    filterTag?: unknown;
  };

  const includeClosed = args.includeClosed === true;
  const statuses = parseTaskStatuses(args.statuses);
  if (args.searchQuery !== undefined && typeof args.searchQuery !== "string") {
    return mcpError(rpcId, -32602, "searchQuery must be a string");
  }
  const searchQuery = typeof args.searchQuery === "string" ? args.searchQuery : undefined;
  if (args.filterTag !== undefined && typeof args.filterTag !== "string") {
    return mcpError(rpcId, -32602, "filterTag must be a string");
  }
  const filterTag = typeof args.filterTag === "string" ? args.filterTag : undefined;

  try {
    const tasks = await executeListForMcp({
      userId: sessionUserId,
      includeClosed,
      statuses,
      tagRootId: parsedScopes.tagRootId,
      searchQuery,
      filterTag,
    });
    return mcpToolResult(rpcId, tasks);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed";
    return mcpError(rpcId, -32000, message);
  }
}

async function handleUpdateTaskTool(
  executeUpdateFromMcp: (args: {
    userId: string;
    id: Id<"tasks">;
    tagRootId?: Id<"tags">;
    content?: string;
    status?: "not_started" | "in_progress" | "agent_running" | "blocked" | "closed";
    priority?: "triage" | "low" | "medium" | "high" | "urgent";
    dueDate?: string | null;
    addAgent?: string;
    removeAgentById?: Id<"agents">;
    addPullRequestByUrl?: string;
    removePullRequestByUrl?: string;
    addLinearIssueByUrl?: string;
    removeLinearIssueByUrl?: string;
  }) => Promise<UpdateTaskFromMcpResult>,
  syncLinearIssueAfterAttach: (args: { userId: string; linearIssue: MappedLinearIssueResult }) => Promise<void>,
  rpcId: unknown,
  sessionUserId: string,
  parsedScopes: ParsedScopes,
  rawArgs: unknown
): Promise<Response> {
  if (!hasRequiredScope(parsedScopes, TASKS_WRITE_SCOPE)) {
    return mcpError(rpcId, -32001, "Missing required scope: tasks:write");
  }

  const { parsed, error } = parseTaskMutationArgs(rpcId, rawArgs, {
    requireTaskId: true,
    requireContent: false,
    allowRemoveFields: true,
  });
  if (error || !parsed || !parsed.taskId) {
    return error ?? mcpError(rpcId, -32602, "Invalid arguments");
  }

  const hasAnyUpdate =
    parsed.content !== undefined ||
    parsed.status !== undefined ||
    parsed.priority !== undefined ||
    parsed.dueDate !== undefined ||
    parsed.addAgent !== undefined ||
    parsed.removeAgentById !== undefined ||
    parsed.addPullRequestByUrl !== undefined ||
    parsed.removePullRequestByUrl !== undefined ||
    parsed.addLinearIssueByUrl !== undefined ||
    parsed.removeLinearIssueByUrl !== undefined;
  if (!hasAnyUpdate) {
    return mcpError(
      rpcId,
      -32602,
      "No updates provided. Set at least one of content/status/priority/dueDate/add*/remove*."
    );
  }

  try {
    const result = await executeUpdateFromMcp({
      userId: sessionUserId,
      id: parsed.taskId,
      tagRootId: parsedScopes.tagRootId,
      content: parsed.content,
      status: parsed.status,
      priority: parsed.priority,
      dueDate: parsed.dueDate,
      addAgent: parsed.addAgent,
      removeAgentById: parsed.removeAgentById,
      addPullRequestByUrl: parsed.addPullRequestByUrl,
      removePullRequestByUrl: parsed.removePullRequestByUrl,
      addLinearIssueByUrl: parsed.addLinearIssueByUrl,
      removeLinearIssueByUrl: parsed.removeLinearIssueByUrl,
    });
    if (result.addedLinearIssue) {
      await syncLinearIssueAfterAttach({
        userId: sessionUserId,
        linearIssue: result.addedLinearIssue,
      });
    }
    return mcpToolResult(rpcId, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed";
    return mcpError(rpcId, -32000, message);
  }
}

async function handleCreateTaskTool(
  executeCreateFromMcp: (args: {
    userId: string;
    tagRootId?: Id<"tags">;
    content: string;
    status?: "not_started" | "in_progress" | "agent_running" | "blocked" | "closed";
    priority?: "triage" | "low" | "medium" | "high" | "urgent";
    dueDate?: string | null;
    addAgent?: string;
    addPullRequestByUrl?: string;
    addLinearIssueByUrl?: string;
  }) => Promise<CreateTaskFromMcpResult>,
  syncLinearIssueAfterAttach: (args: { userId: string; linearIssue: MappedLinearIssueResult }) => Promise<void>,
  rpcId: unknown,
  sessionUserId: string,
  parsedScopes: ParsedScopes,
  rawArgs: unknown
): Promise<Response> {
  if (!hasRequiredScope(parsedScopes, TASKS_WRITE_SCOPE)) {
    return mcpError(rpcId, -32001, "Missing required scope: tasks:write");
  }
  const { parsed, error } = parseTaskMutationArgs(rpcId, rawArgs, {
    requireTaskId: false,
    requireContent: true,
    allowRemoveFields: false,
  });
  if (error || !parsed || parsed.content === undefined) {
    return error ?? mcpError(rpcId, -32602, "Invalid arguments");
  }

  try {
    const result = await executeCreateFromMcp({
      userId: sessionUserId,
      tagRootId: parsedScopes.tagRootId,
      content: parsed.content,
      status: parsed.status,
      priority: parsed.priority,
      dueDate: parsed.dueDate,
      addAgent: parsed.addAgent,
      addPullRequestByUrl: parsed.addPullRequestByUrl,
      addLinearIssueByUrl: parsed.addLinearIssueByUrl,
    });
    if (result.addedLinearIssue) {
      await syncLinearIssueAfterAttach({
        userId: sessionUserId,
        linearIssue: result.addedLinearIssue,
      });
    }
    return mcpToolResult(rpcId, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed";
    return mcpError(rpcId, -32000, message);
  }
}

async function handleListCapturesTool(
  executeListCapturesForMcp: (args: {
    userId: string;
    includeCompleted?: boolean;
  }) => Promise<unknown>,
  rpcId: unknown,
  sessionUserId: string,
  parsedScopes: ParsedScopes,
  rawArgs: unknown
): Promise<Response> {
  if (!hasRequiredScope(parsedScopes, TASKS_READ_SCOPE)) {
    return mcpError(rpcId, -32001, "Missing required scope: tasks:read");
  }
  if (rawArgs !== undefined && (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs))) {
    return mcpError(rpcId, -32602, "Invalid arguments");
  }

  const allowedKeys = new Set(["includeCompleted"]);
  for (const key of Object.keys((rawArgs ?? {}) as Record<string, unknown>)) {
    if (!allowedKeys.has(key)) {
      return mcpError(rpcId, -32602, `Unexpected argument: ${key}`);
    }
  }

  const args = (rawArgs ?? {}) as { includeCompleted?: unknown };
  if (args.includeCompleted !== undefined && typeof args.includeCompleted !== "boolean") {
    return mcpError(rpcId, -32602, "includeCompleted must be a boolean");
  }

  try {
    const captures = await executeListCapturesForMcp({
      userId: sessionUserId,
      includeCompleted: args.includeCompleted as boolean | undefined,
    });
    return mcpToolResult(rpcId, captures);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed";
    return mcpError(rpcId, -32000, message);
  }
}

async function handleUpdateCapturesTool(
  executeUpdateCapturesFromMcp: (args: {
    userId: string;
    ids: Id<"captures">[];
    status: "done" | "deleted";
  }) => Promise<unknown>,
  rpcId: unknown,
  sessionUserId: string,
  parsedScopes: ParsedScopes,
  rawArgs: unknown
): Promise<Response> {
  if (!hasRequiredScope(parsedScopes, TASKS_WRITE_SCOPE)) {
    return mcpError(rpcId, -32001, "Missing required scope: tasks:write");
  }
  if (rawArgs !== undefined && (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs))) {
    return mcpError(rpcId, -32602, "Invalid arguments");
  }

  const allowedKeys = new Set(["ids", "status"]);
  for (const key of Object.keys((rawArgs ?? {}) as Record<string, unknown>)) {
    if (!allowedKeys.has(key)) {
      return mcpError(rpcId, -32602, `Unexpected argument: ${key}`);
    }
  }

  const args = (rawArgs ?? {}) as { ids?: unknown; status?: unknown };
  if (!Array.isArray(args.ids) || args.ids.length === 0 || args.ids.some((id) => typeof id !== "string")) {
    return mcpError(rpcId, -32602, "ids is required and must be a non-empty string array");
  }
  if (args.status !== "done" && args.status !== "deleted") {
    return mcpError(rpcId, -32602, "status must be either done or deleted");
  }

  try {
    const result = await executeUpdateCapturesFromMcp({
      userId: sessionUserId,
      ids: args.ids as Id<"captures">[],
      status: args.status,
    });
    return mcpToolResult(rpcId, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed";
    return mcpError(rpcId, -32000, message);
  }
}

async function handleCreateCapturesTool(
  executeCreateCapturesFromMcp: (args: {
    userId: string;
    texts: string[];
  }) => Promise<unknown>,
  rpcId: unknown,
  sessionUserId: string,
  parsedScopes: ParsedScopes,
  rawArgs: unknown
): Promise<Response> {
  if (!hasRequiredScope(parsedScopes, TASKS_WRITE_SCOPE)) {
    return mcpError(rpcId, -32001, "Missing required scope: tasks:write");
  }
  if (rawArgs !== undefined && (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs))) {
    return mcpError(rpcId, -32602, "Invalid arguments");
  }

  const allowedKeys = new Set(["texts"]);
  for (const key of Object.keys((rawArgs ?? {}) as Record<string, unknown>)) {
    if (!allowedKeys.has(key)) {
      return mcpError(rpcId, -32602, `Unexpected argument: ${key}`);
    }
  }

  const args = (rawArgs ?? {}) as { texts?: unknown };
  if (!Array.isArray(args.texts) || args.texts.length === 0 || args.texts.some((text) => typeof text !== "string")) {
    return mcpError(rpcId, -32602, "texts is required and must be a non-empty string array");
  }
  if (args.texts.some((text) => !text.trim())) {
    return mcpError(rpcId, -32602, "texts entries must be non-empty strings");
  }

  try {
    const result = await executeCreateCapturesFromMcp({
      userId: sessionUserId,
      texts: args.texts,
    });
    return mcpToolResult(rpcId, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed";
    return mcpError(rpcId, -32000, message);
  }
}

function getToolsList() {
  return [
    {
      name: "readTasks",
      description:
        "Return tasks for the authenticated user. By default, only non-closed tasks are returned. Supports optional full-text search via searchQuery and tag filtering via filterTag.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          includeClosed: { type: "boolean" },
          statuses: {
            type: "array",
            items: {
              type: "string",
              enum: ["not_started", "in_progress", "agent_running", "blocked", "closed"],
            },
          },
          searchQuery: { type: "string" },
          filterTag: {
            type: "string",
            description:
              "Tag name filter using trimmed/lowercased closest-match logic: exact match first, then prefix/contains variants. Results include tasks at/under the matched tag.",
          },
        },
      },
    },
    {
      name: "createTask",
      description:
        "Create a task for the authenticated user. Supports content/status/priority/dueDate and additive agent/PR attachment fields.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["content"],
        properties: {
          content: { type: "string" },
          status: {
            type: "string",
            enum: ["not_started", "in_progress", "agent_running", "blocked", "closed"],
          },
          priority: {
            type: "string",
            enum: ["triage", "low", "medium", "high", "urgent"],
          },
          dueDate: {
            description:
              "Due date in local ISO format YYYY-MM-DD. Pass null to create without a due date.",
            oneOf: [{ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, { type: "null" }],
          },
          addAgent: { type: "string" },
          addPullRequestByUrl: { type: "string" },
          addLinearIssueByUrl: { type: "string" },
        },
      },
    },
    {
      name: "listCaptures",
      description:
        "List captures for the authenticated user. Returns id/text/creation time; defaults to open captures.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          includeCompleted: { type: "boolean" },
        },
      },
    },
    {
      name: "updateCaptures",
      description:
        "Update multiple captures by id with a single status action: done (mark complete) or deleted.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["ids", "status"],
        properties: {
          ids: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
          status: {
            type: "string",
            enum: ["done", "deleted"],
          },
        },
      },
    },
    {
      name: "createCaptures",
      description:
        "Create multiple captures for the authenticated user from a single list of capture text values.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["texts"],
        properties: {
          texts: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
            description: "Capture text values to create. Each entry must be a non-empty string.",
          },
        },
      },
    },
    {
      name: "updateTask",
      description:
        "Partially update a task. Supports content/status/priority and additive agent/PR attachment changes.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["taskId"],
        properties: {
          taskId: { type: "string" },
          content: { type: "string" },
          status: {
            type: "string",
            enum: ["not_started", "in_progress", "agent_running", "blocked", "closed"],
          },
          priority: {
            type: "string",
            enum: ["triage", "low", "medium", "high", "urgent"],
          },
          dueDate: {
            description:
              "Due date in local ISO format YYYY-MM-DD. Pass null to clear an existing due date.",
            oneOf: [{ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, { type: "null" }],
          },
          addAgent: { type: "string" },
          removeAgentById: { type: "string" },
          addPullRequestByUrl: { type: "string" },
          removePullRequestByUrl: { type: "string" },
          addLinearIssueByUrl: { type: "string" },
          removeLinearIssueByUrl: { type: "string" },
        },
      },
    },
  ];
}

const mcpServerHandler = httpAction(async (ctx, req) => {
  const auth = createAuth(ctx);
  const authWrappedHandler = withMcpAuth(auth, async (innerReq, session) => {
      const sessionUserId = session.userId;
      if (!sessionUserId) {
        return new Response("Unauthorized", { status: 401 });
      }

      if (innerReq.method !== "POST") {
        return jsonResponse({ error: "Method not supported. Use POST JSON-RPC requests." }, 405);
      }

      let body: unknown;
      try {
        body = await innerReq.json();
      } catch {
        return jsonResponse({ error: "Invalid JSON body." }, 400);
      }

      const rpc = body as {
        id?: unknown;
        method?: unknown;
        params?: unknown;
      };

      if (rpc.method === "initialize") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: rpc.id ?? null,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: "tasky-mcp",
              version: "1.0.0",
            },
          },
        });
      }

      if (rpc.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }

      const parsedScopes = parseScopes(session.scopes);
      const rpcId = rpc.id ?? null;

      if (rpc.method === "tools/list") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: rpcId,
          result: {
            tools: getToolsList(),
          },
        });
      }

      if (rpc.method === "tools/call") {
        const params = (rpc.params ?? {}) as {
          name?: unknown;
          arguments?: unknown;
        };
        const toolName = typeof params.name === "string" ? params.name : undefined;
        if (
          toolName !== "readTasks" &&
          toolName !== "createTask" &&
          toolName !== "listCaptures" &&
          toolName !== "updateCaptures" &&
          toolName !== "createCaptures" &&
          toolName !== "updateTask"
        ) {
          return mcpError(rpcId, -32601, "Tool not found");
        }

        if (toolName === "readTasks") {
          return handleReadTasksTool(
            (args) => ctx.runQuery(internal.tasks.listForMcp, args),
            rpcId,
            sessionUserId,
            parsedScopes,
            params.arguments
          );
        }
        if (toolName === "createTask") {
          const syncLinearIssueAfterAttach = async (args: {
            userId: string;
            linearIssue: MappedLinearIssueResult;
          }) => {
            await ctx.runAction(internal.linearIssues.syncLinearIssuesBatchInternal, {
              userId: args.userId,
              items: [
                {
                  linearIssueId: args.linearIssue.id,
                  url: args.linearIssue.url,
                  identifier: args.linearIssue.identifier,
                },
              ],
            });
          };
          return handleCreateTaskTool(
            (args) => ctx.runMutation(internal.tasks.createFromMcp, args),
            syncLinearIssueAfterAttach,
            rpcId,
            sessionUserId,
            parsedScopes,
            params.arguments
          );
        }
        if (toolName === "listCaptures") {
          return handleListCapturesTool(
            (args) => ctx.runQuery(internal.captures.listForMcp, args),
            rpcId,
            sessionUserId,
            parsedScopes,
            params.arguments
          );
        }
        if (toolName === "updateCaptures") {
          return handleUpdateCapturesTool(
            (args) => ctx.runMutation(internal.captures.updateFromMcp, args),
            rpcId,
            sessionUserId,
            parsedScopes,
            params.arguments
          );
        }
        if (toolName === "createCaptures") {
          return handleCreateCapturesTool(
            (args) => ctx.runMutation(internal.captures.createFromMcp, args),
            rpcId,
            sessionUserId,
            parsedScopes,
            params.arguments
          );
        }
        const syncLinearIssueAfterAttach = async (args: {
          userId: string;
          linearIssue: MappedLinearIssueResult;
        }) => {
          await ctx.runAction(internal.linearIssues.syncLinearIssuesBatchInternal, {
            userId: args.userId,
            items: [
              {
                linearIssueId: args.linearIssue.id,
                url: args.linearIssue.url,
                identifier: args.linearIssue.identifier,
              },
            ],
          });
        };
        return handleUpdateTaskTool(
          (args) => ctx.runMutation(internal.tasks.updateFromMcp, args),
          syncLinearIssueAfterAttach,
          rpcId,
          sessionUserId,
          parsedScopes,
          params.arguments
        );
      }

      return mcpError(rpcId, -32601, "Method not found");
    });

  return authWrappedHandler(req);
});

const oauthProtectedResourceMetadataHandler = httpAction(async (_ctx, req) => {
  const auth = createAuth(_ctx);
  const response = await oAuthProtectedResourceMetadata(auth)(req);
  const metadata = (await response.json()) as Record<string, unknown>;
  return jsonResponse({ ...metadata, scopes_supported: [...oauthScopes] }, response.status);
});

const protectedResourceOptionsHandler = httpAction(async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
});

function corsOptionsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
}

async function proxyJson(req: Request, targetPath: string): Promise<Response> {
  const target = new URL(targetPath, req.url);
  const proxied = await fetch(target.toString(), { method: "GET" });
  const body = await proxied.text();
  return new Response(body, {
    status: proxied.status,
    headers: {
      "content-type": proxied.headers.get("content-type") ?? "application/json",
      "access-control-allow-origin": "*",
      "cache-control": proxied.headers.get("cache-control") ?? "no-store",
    },
  });
}

const oauthOpenIdConfigCompatHandler = httpAction(async (_ctx, req) => {
  if (req.method === "OPTIONS") {
    return corsOptionsResponse();
  }
  return proxyJson(req, "/api/auth/convex/.well-known/openid-configuration");
});

const oauthAuthServerMetadataCompatHandler = httpAction(async (_ctx, req) => {
  if (req.method === "OPTIONS") {
    return corsOptionsResponse();
  }
  const auth = createAuth(_ctx);
  const response = await oAuthDiscoveryMetadata(auth)(req);
  const metadata = (await response.json()) as Record<string, unknown>;
  return jsonResponse({ ...metadata, scopes_supported: [...oauthScopes] }, response.status);
});

const oauthJwksCompatHandler = httpAction(async (_ctx, req) => {
  if (req.method === "OPTIONS") {
    return corsOptionsResponse();
  }
  return proxyJson(req, "/api/auth/convex/jwks");
});

export const mcpGetHandler = mcpServerHandler;
export const mcpPostHandler = mcpServerHandler;
export const mcpDeleteHandler = mcpServerHandler;
export const oauthProtectedResourceMetadataGetHandler = oauthProtectedResourceMetadataHandler;
export const oauthProtectedResourceMetadataOptionsHandler = protectedResourceOptionsHandler;
export const oauthOpenIdConfigCompatGetHandler = oauthOpenIdConfigCompatHandler;
export const oauthOpenIdConfigCompatOptionsHandler = oauthOpenIdConfigCompatHandler;
export const oauthAuthServerMetadataCompatGetHandler = oauthAuthServerMetadataCompatHandler;
export const oauthAuthServerMetadataCompatOptionsHandler = oauthAuthServerMetadataCompatHandler;
export const oauthJwksCompatGetHandler = oauthJwksCompatHandler;
export const oauthJwksCompatOptionsHandler = oauthJwksCompatHandler;
