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
  | Array<"not_started" | "in_progress" | "blocked" | "closed">
  | undefined {
  if (!Array.isArray(input)) return undefined;
  return input.filter(
    (status): status is "not_started" | "in_progress" | "blocked" | "closed" =>
      status === "not_started" ||
      status === "in_progress" ||
      status === "blocked" ||
      status === "closed"
  );
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

async function handleReadTasksTool(
  executeListForMcp: (args: {
    userId: string;
    includeClosed: boolean;
    statuses?: Array<"not_started" | "in_progress" | "blocked" | "closed">;
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
    status?: "not_started" | "in_progress" | "blocked" | "closed";
    priority?: "triage" | "low" | "medium" | "high";
    dueDate?: string | null;
    addAgent?: string;
    removeAgentById?: Id<"agents">;
    addPullRequestByUrl?: string;
    removePullRequestByUrl?: string;
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

  const allowedKeys = new Set([
    "taskId",
    "content",
    "status",
    "priority",
    "dueDate",
    "addAgent",
    "removeAgentById",
    "addPullRequestByUrl",
    "removePullRequestByUrl",
  ]);
  for (const key of Object.keys((rawArgs ?? {}) as Record<string, unknown>)) {
    if (!allowedKeys.has(key)) {
      return mcpError(rpcId, -32602, `Unexpected argument: ${key}`);
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
  };

  const taskId = typeof args.taskId === "string" ? (args.taskId as Id<"tasks">) : undefined;
  if (!taskId) {
    return mcpError(rpcId, -32602, "taskId is required");
  }

  const status =
    args.status === "not_started" ||
    args.status === "in_progress" ||
    args.status === "blocked" ||
    args.status === "closed"
      ? args.status
      : undefined;
  if (args.status !== undefined && status === undefined) {
    return mcpError(rpcId, -32602, "Invalid status");
  }

  const priority =
    args.priority === "triage" ||
    args.priority === "low" ||
    args.priority === "medium" ||
    args.priority === "high"
      ? args.priority
      : undefined;
  if (args.priority !== undefined && priority === undefined) {
    return mcpError(rpcId, -32602, "Invalid priority");
  }

  let dueDate: string | null | undefined;
  if (args.dueDate !== undefined) {
    if (args.dueDate === null) {
      dueDate = null;
    } else if (typeof args.dueDate === "string" && isValidIsoLocalDate(args.dueDate)) {
      dueDate = args.dueDate;
    } else {
      return mcpError(
        rpcId,
        -32602,
        "dueDate must be null or a valid ISO date string in YYYY-MM-DD format"
      );
    }
  }

  if (args.content !== undefined && typeof args.content !== "string") {
    return mcpError(rpcId, -32602, "content must be a string");
  }
  if (args.addAgent !== undefined && typeof args.addAgent !== "string") {
    return mcpError(rpcId, -32602, "addAgent must be a string");
  }
  if (args.removeAgentById !== undefined && typeof args.removeAgentById !== "string") {
    return mcpError(rpcId, -32602, "removeAgentById must be a string");
  }
  if (args.addPullRequestByUrl !== undefined && typeof args.addPullRequestByUrl !== "string") {
    return mcpError(rpcId, -32602, "addPullRequestByUrl must be a string");
  }
  if (args.removePullRequestByUrl !== undefined && typeof args.removePullRequestByUrl !== "string") {
    return mcpError(rpcId, -32602, "removePullRequestByUrl must be a string");
  }

  const hasAnyUpdate =
    args.content !== undefined ||
    status !== undefined ||
    priority !== undefined ||
    dueDate !== undefined ||
    args.addAgent !== undefined ||
    args.removeAgentById !== undefined ||
    args.addPullRequestByUrl !== undefined ||
    args.removePullRequestByUrl !== undefined;
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
      id: taskId,
      tagRootId: parsedScopes.tagRootId,
      content: args.content as string | undefined,
      status,
      priority,
      dueDate,
      addAgent: args.addAgent as string | undefined,
      removeAgentById: args.removeAgentById as Id<"agents"> | undefined,
      addPullRequestByUrl: args.addPullRequestByUrl as string | undefined,
      removePullRequestByUrl: args.removePullRequestByUrl as string | undefined,
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
              enum: ["not_started", "in_progress", "blocked", "closed"],
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
            enum: ["not_started", "in_progress", "blocked", "closed"],
          },
          priority: {
            type: "string",
            enum: ["triage", "low", "medium", "high"],
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
        if (toolName !== "readTasks" && toolName !== "updateTask") {
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
        return handleUpdateTaskTool(
          (args) => ctx.runMutation(internal.tasks.updateFromMcp, args),
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
