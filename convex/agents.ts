import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthUserId } from "./auth";
import { decryptApiKey } from "./apiKeys";
import { insertEvent } from "./events";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    return await ctx.db
      .query("agents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

export const listByTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const task = await ctx.db.get(args.taskId);
    if (!task || task.userId !== userId) {
      return [];
    }

    return await ctx.db
      .query("agents")
      .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", args.taskId))
      .order("desc")
      .collect();
  },
});

export const createForTask = mutation({
  args: {
    taskId: v.id("tasks"),
    externalId: v.string(),
    link: v.string(),
    title: v.string(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const task = await ctx.db.get(args.taskId);
    if (!task || task.userId !== userId) {
      throw new Error("Task not found or access denied");
    }

    const externalId = args.externalId.trim();
    if (!externalId) {
      throw new Error("External ID is required");
    }

    const existing = await ctx.db
      .query("agents")
      .withIndex("by_user_external_id", (q) =>
        q.eq("userId", userId).eq("externalId", externalId)
      )
      .first();
    if (existing) {
      throw new Error("Agent external ID already exists");
    }

    const now = Date.now();
    const agentId = await ctx.db.insert("agents", {
      userId,
      taskId: args.taskId,
      externalId,
      link: args.link.trim(),
      title: args.title.trim(),
      status: args.status.trim(),
      lastSyncedAt: undefined,
      createdAt: now,
      updatedAt: now,
    });

    await insertEvent(ctx, {
      userId,
      entityId: agentId,
      action: { type: "agent.created" },
      tagIds: task.tagIds.length > 0 ? task.tagIds : undefined,
    });

    return agentId;
  },
});

export const remove = mutation({
  args: { id: v.id("agents") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const agent = await ctx.db.get(args.id);
    if (!agent || agent.userId !== userId) {
      throw new Error("Agent not found or access denied");
    }

    const task = await ctx.db.get(agent.taskId);
    const tagIds = task && task.userId === userId && task.tagIds.length > 0 ? task.tagIds : undefined;

    await insertEvent(ctx, {
      userId,
      entityId: args.id,
      action: { type: "agent.deleted" },
      tagIds,
    });

    await ctx.db.delete(args.id);
  },
});

export const patchSyncFieldsInternal = internalMutation({
  args: {
    agentId: v.id("agents"),
    userId: v.string(),
    status: v.optional(v.string()),
    title: v.optional(v.string()),
    link: v.optional(v.string()),
    lastSyncedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.userId !== args.userId) {
      return false;
    }

    await ctx.db.patch(args.agentId, {
      status: args.status ?? agent.status,
      title: args.title ?? agent.title,
      link: args.link ?? agent.link,
      lastSyncedAt: args.lastSyncedAt,
      updatedAt: Date.now(),
    });
    return true;
  },
});

type CursorAgentResponse = {
  id: string;
  name?: string;
  status?: string;
  target?: {
    url?: string;
  };
};

type FetchStatus = "updated" | "not_found" | "failed";
type FetchResult =
  | { status: "updated"; payload: CursorAgentResponse }
  | { status: "not_found" }
  | { status: "failed"; reason: string };

const CURSOR_AGENT_PARALLELISM = 3;
const CURSOR_AGENT_MAX_ATTEMPTS = 4;
const CURSOR_AGENT_BASE_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildBasicAuthHeader(apiKey: string): string {
  return `Basic ${btoa(`${apiKey}:`)}`;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

async function fetchCursorAgentWithRetry(
  token: string,
  externalId: string
): Promise<FetchResult> {
  for (let attempt = 0; attempt < CURSOR_AGENT_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`https://api.cursor.com/v0/agents/${encodeURIComponent(externalId)}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: buildBasicAuthHeader(token),
        },
      });

      if (response.status === 404) {
        return { status: "not_found" };
      }

      if (!response.ok) {
        const shouldRetry = isRetryableStatus(response.status) && attempt < CURSOR_AGENT_MAX_ATTEMPTS - 1;
        if (!shouldRetry) {
          return { status: "failed", reason: `Cursor API returned ${response.status}` };
        }
      } else {
        const payload = (await response.json()) as CursorAgentResponse;
        return { status: "updated", payload };
      }
    } catch (error) {
      if (attempt === CURSOR_AGENT_MAX_ATTEMPTS - 1) {
        return {
          status: "failed",
          reason: error instanceof Error ? error.message : "Network error",
        };
      }
    }

    const jitter = Math.floor(Math.random() * CURSOR_AGENT_BASE_DELAY_MS);
    const backoffMs = CURSOR_AGENT_BASE_DELAY_MS * 2 ** attempt + jitter;
    await sleep(backoffMs);
  }

  return { status: "failed", reason: "Retry limit exceeded" };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  parallelism: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;

  const runners = Array.from({ length: Math.max(1, parallelism) }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) {
        return;
      }
      results[current] = await worker(items[current]);
    }
  });

  await Promise.all(runners);
  return results;
}

export const syncAgentStates = action({
  args: {
    items: v.array(
      v.object({
        agentId: v.id("agents"),
        externalId: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const now = Date.now();
    const keyRow = await ctx.runQuery(internal.apiKeys.getLatestByTypeInternal, {
      userId,
      type: "cursor_agent_sdk",
    });
    if (!keyRow) {
      return {
        status: "skipped_no_token" as const,
        updatedCount: 0,
        results: args.items.map((item) => ({
          agentId: item.agentId,
          status: "skipped_no_token" as const,
        })),
      };
    }

    const token = await decryptApiKey(keyRow.encryptedValue, keyRow.iv);
    if (!token.trim()) {
      return {
        status: "skipped_no_token" as const,
        updatedCount: 0,
        results: args.items.map((item) => ({
          agentId: item.agentId,
          status: "skipped_no_token" as const,
        })),
      };
    }

    const dedupedByExternalId = new Map<string, Id<"agents">[]>();
    const invalidResults: Array<{
      agentId: Id<"agents">;
      status: "failed";
      reason: string;
    }> = [];
    for (const item of args.items) {
      const key = item.externalId.trim();
      if (!key) {
        invalidResults.push({
          agentId: item.agentId,
          status: "failed",
          reason: "Missing externalId",
        });
        continue;
      }
      const list = dedupedByExternalId.get(key);
      if (list) {
        list.push(item.agentId);
      } else {
        dedupedByExternalId.set(key, [item.agentId]);
      }
    }

    const dedupedTargets = Array.from(dedupedByExternalId.entries()).map(([externalId, agentIds]) => ({
      externalId,
      agentIds,
    }));

    const fetched = await mapWithConcurrency(dedupedTargets, CURSOR_AGENT_PARALLELISM, async (target) => ({
      target,
      result: await fetchCursorAgentWithRetry(token, target.externalId),
    }));

    const perAgentResults: Array<{
      agentId: Id<"agents">;
      status: FetchStatus;
      reason?: string;
    }> = [];
    let updatedCount = 0;

    for (const entry of fetched) {
      if (entry.result.status === "not_found") {
        for (const agentId of entry.target.agentIds) {
          perAgentResults.push({ agentId, status: "not_found" });
        }
        continue;
      }

      if (entry.result.status === "failed") {
        for (const agentId of entry.target.agentIds) {
          perAgentResults.push({
            agentId,
            status: "failed",
            reason: entry.result.reason,
          });
        }
        continue;
      }

      for (const agentId of entry.target.agentIds) {
        try {
          const patched = await ctx.runMutation(internal.agents.patchSyncFieldsInternal, {
            agentId,
            userId,
            status: entry.result.payload.status,
            title: entry.result.payload.name,
            link: entry.result.payload.target?.url,
            lastSyncedAt: now,
          });
          if (!patched) {
            perAgentResults.push({ agentId, status: "not_found" });
            continue;
          }
          perAgentResults.push({ agentId, status: "updated" });
          updatedCount += 1;
        } catch (error) {
          perAgentResults.push({
            agentId,
            status: "failed",
            reason: error instanceof Error ? error.message : "Patch failed",
          });
        }
      }
    }

    return {
      status: "ok" as const,
      updatedCount,
      results: [...invalidResults, ...perAgentResults],
    };
  },
});
