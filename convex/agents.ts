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

export const listWithTasks = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const agents = await ctx.db
      .query("agents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();

    const allTags = await ctx.db
      .query("tags")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const tagById = new Map(allTags.map((t) => [t._id, t]));

    return await Promise.all(
      agents.map(async (agent) => {
        const task = await ctx.db.get(agent.taskId);
        if (!task || task.userId !== userId) {
          return { ...agent, task: null };
        }
        return {
          ...agent,
          task: {
            _id: task._id,
            _creationTime: task._creationTime,
            content: task.content,
            status: task.status,
            priority: task.priority,
            dueDate: task.dueDate,
            tagIds: task.tagIds,
            tags: task.tagIds
              .map((id) => tagById.get(id))
              .filter((t): t is NonNullable<typeof t> => t != null)
              .map((t) => ({ _id: t._id, name: t.name, color: t.color })),
          },
        };
      })
    );
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
      return {
        status: "invalid_external_id" as const,
        message: "External ID is required",
      };
    }

    const existing = await ctx.db
      .query("agents")
      .withIndex("by_user_external_id", (q) =>
        q.eq("userId", userId).eq("externalId", externalId)
      )
      .first();
    if (existing) {
      if (existing.taskId === args.taskId) {
        return {
          status: "already_attached_to_task" as const,
          agentId: existing._id,
        };
      }
      return {
        status: "linked_to_other_task" as const,
      };
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
      updatedAt: now,
    });

    await insertEvent(ctx, {
      userId,
      entityId: agentId,
      action: { type: "agent.created" },
      tagIds: task.tagIds.length > 0 ? task.tagIds : undefined,
    });

    return {
      status: "attached" as const,
      agentId,
    };
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
    prUrl?: string;
  };
};

type CursorLaunchResponse = {
  id: string;
  name?: string;
  status?: string;
  target?: {
    url?: string;
    prUrl?: string;
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

function normalizeRepositoryUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Repository is required");
  }

  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Repository must be a valid GitHub URL");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname !== "github.com" && hostname !== "www.github.com") {
    throw new Error("Repository must point to github.com");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("Repository URL must look like github.com/<owner>/<repo>");
  }

  return `https://github.com/${parts[0]}/${parts[1]}`;
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

export const launch = action({
  args: {
    repository: v.string(),
    branch: v.string(),
    promptText: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const promptText = args.promptText.trim();
    if (!promptText) {
      throw new Error("Prompt is required");
    }

    const repository = normalizeRepositoryUrl(args.repository);
    const branch = args.branch.trim();
    if (!branch) {
      throw new Error("Branch is required");
    }
    const keyRow = await ctx.runQuery(internal.apiKeys.getLatestByTypeInternal, {
      userId,
      type: "cursor_agent_sdk",
    });
    if (!keyRow) {
      throw new Error("Add a Cursor Agent SDK key in Settings before starting an agent");
    }

    const token = await decryptApiKey(keyRow.encryptedValue, keyRow.iv);
    if (!token.trim()) {
      throw new Error("Add a valid Cursor Agent SDK key in Settings before starting an agent");
    }

    const response = await fetch("https://api.cursor.com/v0/agents", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: buildBasicAuthHeader(token),
      },
      body: JSON.stringify({
        prompt: {
          text: promptText,
        },
        source: {
          repository,
          ref: branch,
        },
      }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      if (response.status === 401 || response.status === 403) {
        throw new Error("Cursor rejected the saved SDK key. Update it in Settings and try again.");
      }
      throw new Error(
        `Cursor agent launch failed with status ${response.status}${
          responseText ? `: ${responseText.slice(0, 200)}` : ""
        }`
      );
    }

    const payload = (await response.json()) as CursorLaunchResponse;
    const externalId = String(payload.id ?? "").trim();
    if (!externalId) {
      throw new Error("Cursor agent launch did not return an agent ID");
    }

    return {
      externalId,
      title: String(payload.name ?? externalId).trim() || externalId,
      status: String(payload.status ?? "CREATING").trim() || "CREATING",
      link: String(payload.target?.url ?? `https://cursor.com/agents/${externalId}`).trim(),
      prUrl: String(payload.target?.prUrl ?? "").trim() || undefined,
      repository,
    };
  },
});

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
        taskId: v.id("tasks"),
      })
    ),
    pullRequestsToSync: v.optional(
      v.array(
        v.object({
          pullRequestId: v.id("pullRequests"),
          url: v.string(),
          owner: v.optional(v.string()),
          repo: v.optional(v.string()),
          number: v.optional(v.number()),
        })
      )
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
          prUrl: undefined,
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
          prUrl: undefined,
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
      prUrl?: string;
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
          const prUrl = String(entry.result.payload.target?.prUrl ?? "").trim() || undefined;
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
          perAgentResults.push({ agentId, status: "updated", prUrl });
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

    const pullRequestSyncById = new Map<
      Id<"pullRequests">,
      {
        pullRequestId: Id<"pullRequests">;
        url: string;
        owner?: string;
        repo?: string;
        number?: number;
      }
    >();
    for (const item of args.pullRequestsToSync ?? []) {
      pullRequestSyncById.set(item.pullRequestId, item);
    }

    const taskIdByAgentId = new Map(args.items.map((item) => [item.agentId, item.taskId]));
    const discoveredPullRequests = new Map<
      string,
      {
        taskId: Id<"tasks">;
        url: string;
      }
    >();
    for (const result of perAgentResults) {
      if (!result.prUrl) continue;
      const taskId = taskIdByAgentId.get(result.agentId);
      if (!taskId) continue;
      discoveredPullRequests.set(`${taskId}:${result.prUrl}`, {
        taskId,
        url: result.prUrl,
      });
    }

    for (const item of discoveredPullRequests.values()) {
      const attached = await ctx.runMutation(internal.pullRequests.createForTaskIfMissingInternal, {
        userId,
        taskId: item.taskId,
        url: item.url,
      });
      if (
        attached.status !== "attached" &&
        attached.status !== "already_attached_to_task"
      ) {
        continue;
      }
      pullRequestSyncById.set(attached.pullRequestId, {
        pullRequestId: attached.pullRequestId,
        url: attached.url,
        owner: attached.owner,
        repo: attached.repo,
        number: attached.number,
      });
    }

    if (pullRequestSyncById.size > 0) {
      await ctx.runAction(internal.pullRequests.syncPullRequestsBatchInternal, {
        userId,
        items: Array.from(pullRequestSyncById.values()),
      });
    }

    const affectedTaskIds = Array.from(new Set(args.items.map((item) => item.taskId)));
    if (affectedTaskIds.length > 0) {
      await ctx.runMutation(internal.tasks.fillEmptyContentFromAgentTitleInternal, {
        userId,
        taskIds: affectedTaskIds,
      });
      await ctx.runMutation(internal.tasks.syncTaskStatusesFromAgentsInternal, {
        userId,
        taskIds: affectedTaskIds,
      });
    }

    return {
      status: "ok" as const,
      updatedCount,
      results: [...invalidResults, ...perAgentResults],
    };
  },
});

type CursorListAgent = {
  id: string;
  name?: string;
  status?: string;
  source?: {
    repository?: string;
    ref?: string;
  };
  target?: {
    url?: string;
    prUrl?: string;
    branchName?: string;
  };
  summary?: string;
  createdAt?: string;
};

type CursorListResponse = {
  agents: CursorListAgent[];
  nextCursor?: string;
};

export const listFromCursorApi = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const keyRow = await ctx.runQuery(internal.apiKeys.getLatestByTypeInternal, {
      userId,
      type: "cursor_agent_sdk",
    });
    if (!keyRow) {
      return { status: "no_api_key" as const, agents: [] as CursorListAgent[] };
    }

    const token = await decryptApiKey(keyRow.encryptedValue, keyRow.iv);
    if (!token.trim()) {
      return { status: "no_api_key" as const, agents: [] as CursorListAgent[] };
    }

    const response = await fetch("https://api.cursor.com/v0/agents?limit=100", {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: buildBasicAuthHeader(token),
      },
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { status: "auth_error" as const, agents: [] as CursorListAgent[] };
      }
      return { status: "api_error" as const, agents: [] as CursorListAgent[] };
    }

    const payload = (await response.json()) as CursorListResponse;
    return { status: "ok" as const, agents: payload.agents ?? [] };
  },
});
