import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { createAuth, oauthScopes } from "./auth";
import { oAuthDiscoveryMetadata, oAuthProtectedResourceMetadata, withMcpAuth } from "better-auth/plugins";
import { hasRequiredScope, splitScopeString, TAG_ROOT_PREFIX, TASKS_READ_SCOPE } from "./mcpScopes";
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

function getToolsList() {
  return [
    {
      name: "readTasks",
      description:
        "Return tasks for the authenticated user. By default, only non-closed tasks are returned.",
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

      const scopeValues = new Set<string>();
      for (const scope of splitScopeString(session.scopes)) {
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
      const parsedScopes = { scopes: scopeValues, tagRootId };
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
        if (toolName !== "readTasks") {
          return mcpError(rpcId, -32601, "Tool not found");
        }

        if (!hasRequiredScope(parsedScopes, TASKS_READ_SCOPE)) {
          return mcpError(rpcId, -32001, "Missing required scope: tasks:read");
        }

        const args = (params.arguments ?? {}) as {
          includeClosed?: unknown;
          statuses?: unknown;
        };

        const includeClosed = args.includeClosed === true;
        const statuses = Array.isArray(args.statuses)
          ? args.statuses.filter(
              (status): status is "not_started" | "in_progress" | "blocked" | "closed" =>
                status === "not_started" ||
                status === "in_progress" ||
                status === "blocked" ||
                status === "closed"
            )
          : undefined;

        try {
          const tasks = await ctx.runQuery(internal.tasks.listForMcp, {
            userId: sessionUserId,
            includeClosed,
            statuses,
            tagRootId: parsedScopes.tagRootId,
          });

          return jsonResponse({
            jsonrpc: "2.0",
            id: rpcId,
            result: {
              content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }],
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Tool execution failed";
          return mcpError(rpcId, -32000, message);
        }
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
