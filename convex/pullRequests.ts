import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, action } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthUserId } from "./auth";
import { decryptApiKey } from "./apiKeys";
import { insertEvent } from "./events";

export function parseGitHubPullRequestUrl(rawUrl: string): {
  url: string;
  domain: string;
  owner: string;
  repo: string;
  number: number;
} {
  const trimmed = rawUrl.trim();
  const parseInput = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(parseInput);
  } catch {
    throw new Error("Invalid pull request URL");
  }

  const hostname = parsed.hostname.toLowerCase();
  const domain = hostname === "www.github.com" ? "github.com" : hostname;
  if (domain !== "github.com") {
    throw new Error("Only github.com pull request URLs are supported");
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 4 || parts[2].toLowerCase() !== "pull") {
    throw new Error("URL must match github.com/<owner>/<repo>/pull/<number>");
  }

  const owner = parts[0].toLowerCase();
  const repo = parts[1].toLowerCase();
  const number = Number(parts[3]);
  if (!owner || !repo || !Number.isInteger(number) || number <= 0) {
    throw new Error("Invalid pull request URL");
  }

  return {
    // Canonical storage form is protocol-less and normalized for dedupe/display.
    url: `github.com/${owner}/${repo}/pull/${number}`,
    domain,
    owner,
    repo,
    number,
  };
}

const PULL_REQUEST_ALREADY_LINKED_ERROR = "Pull request is already linked to another task";

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

    const rows = await ctx.db
      .query("pullRequests")
      .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", args.taskId))
      .order("desc")
      .collect();

    return rows.map((row) => {
      try {
        const normalized = parseGitHubPullRequestUrl(row.url);
        return { ...row, normalized };
      } catch {
        return {
          ...row,
          normalized: null,
        };
      }
    });
  },
});

export const createForTask = mutation({
  args: {
    taskId: v.id("tasks"),
    url: v.string(),
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

    let normalized: ReturnType<typeof parseGitHubPullRequestUrl>;
    try {
      normalized = parseGitHubPullRequestUrl(args.url.trim());
    } catch (error) {
      return {
        status: "invalid_pull_request_url" as const,
        message: error instanceof Error ? error.message : "Invalid pull request URL",
      };
    }
    const existing = await ctx.db
      .query("pullRequests")
      .withIndex("by_user_url", (q) => q.eq("userId", userId).eq("url", normalized.url))
      .first();
    if (existing) {
      if (existing.taskId === args.taskId) {
        return {
          status: "already_attached_to_task" as const,
          pullRequestId: existing._id,
        };
      }
      return {
        status: "linked_to_other_task" as const,
      };
    }

    const now = Date.now();
    const pullRequestId = await ctx.db.insert("pullRequests", {
      userId,
      taskId: args.taskId,
      url: normalized.url,
      updatedAt: now,
    });

    await insertEvent(ctx, {
      userId,
      entityId: pullRequestId,
      action: { type: "pull_request.created" },
      tagIds: task.tagIds.length > 0 ? task.tagIds : undefined,
    });

    return {
      status: "attached" as const,
      pullRequestId,
    };
  },
});

export const remove = mutation({
  args: { id: v.id("pullRequests") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const pullRequest = await ctx.db.get(args.id);
    if (!pullRequest || pullRequest.userId !== userId) {
      throw new Error("Pull request not found or access denied");
    }

    const task = await ctx.db.get(pullRequest.taskId);
    const tagIds = task && task.userId === userId && task.tagIds.length > 0 ? task.tagIds : undefined;

    await insertEvent(ctx, {
      userId,
      entityId: args.id,
      action: { type: "pull_request.deleted" },
      tagIds,
    });

    await ctx.db.delete(args.id);
  },
});

const syncPatchState = v.union(v.literal("OPEN"), v.literal("CLOSED"), v.literal("MERGED"));

export const patchSyncFieldsInternal = internalMutation({
  args: {
    pullRequestId: v.id("pullRequests"),
    userId: v.string(),
    githubState: v.optional(syncPatchState),
    isDraft: v.boolean(),
    isMerged: v.boolean(),
    lastSyncedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const pullRequest = await ctx.db.get(args.pullRequestId);
    if (!pullRequest || pullRequest.userId !== args.userId) {
      return false;
    }

    await ctx.db.patch(args.pullRequestId, {
      githubState: args.githubState,
      isDraft: args.isDraft,
      isMerged: args.isMerged,
      lastSyncedAt: args.lastSyncedAt,
      updatedAt: Date.now(),
    });

    return true;
  },
});

type BatchItem = {
  pullRequestId: Id<"pullRequests">;
  owner: string;
  repo: string;
  number: number;
  alias: string;
};

type DedupedBatchItem = {
  owner: string;
  repo: string;
  number: number;
  alias: string;
  pullRequestIds: Id<"pullRequests">[];
};

function sanitizeGraphQlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildBatchQuery(items: BatchItem[]): string {
  const fields = items
    .map(
      (item) =>
        `${item.alias}: repository(owner: "${sanitizeGraphQlString(item.owner)}", name: "${sanitizeGraphQlString(item.repo)}") { pullRequest(number: ${item.number}) { state isDraft merged } }`
    )
    .join("\n");
  return `query PullRequestBatchSync {\n${fields}\n}`;
}

function normalizeBatchItem(
  item: {
    pullRequestId: Id<"pullRequests">;
    url: string;
    owner?: string;
    repo?: string;
    number?: number;
  },
  alias: string
): BatchItem | null {
  const owner = item.owner?.trim();
  const repo = item.repo?.trim();
  const number = item.number;
  if (owner && repo && typeof number === "number" && Number.isInteger(number) && number > 0) {
    return {
      pullRequestId: item.pullRequestId,
      owner,
      repo,
      number,
      alias,
    };
  }

  try {
    const parsed = parseGitHubPullRequestUrl(item.url);
    return {
      pullRequestId: item.pullRequestId,
      owner: parsed.owner,
      repo: parsed.repo,
      number: parsed.number,
      alias,
    };
  } catch {
    return null;
  }
}

export const syncPullRequestsBatch = action({
  args: {
    items: v.array(
      v.object({
        pullRequestId: v.id("pullRequests"),
        url: v.string(),
        owner: v.optional(v.string()),
        repo: v.optional(v.string()),
        number: v.optional(v.number()),
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
      type: "github",
    });
    if (!keyRow) {
      return {
        status: "skipped_no_pat" as const,
        updatedCount: 0,
        results: args.items.map((item) => ({
          pullRequestId: item.pullRequestId,
          status: "skipped_no_pat" as const,
        })),
      };
    }

    const token = await decryptApiKey(keyRow.encryptedValue, keyRow.iv);
    if (!token.trim()) {
      return {
        status: "skipped_no_pat" as const,
        updatedCount: 0,
        results: args.items.map((item) => ({
          pullRequestId: item.pullRequestId,
          status: "skipped_no_pat" as const,
        })),
      };
    }

    const normalizedItems = args.items.map((item, index) => normalizeBatchItem(item, `pr${index.toString(36)}`));
    const validItems = normalizedItems.filter((item): item is BatchItem => item !== null);
    const invalidResults = normalizedItems
      .map((item, index) => ({ normalized: item, original: args.items[index] }))
      .filter((item) => item.normalized === null)
      .map((item) => ({
        pullRequestId: item.original.pullRequestId,
        status: "invalid_url" as const,
      }));

    if (validItems.length === 0) {
      return {
        status: "ok" as const,
        updatedCount: 0,
        results: invalidResults,
      };
    }

    const dedupedByExternalKey = new Map<string, DedupedBatchItem>();
    for (const item of validItems) {
      const externalKey = `${item.owner.toLowerCase()}/${item.repo.toLowerCase()}#${item.number}`;
      const existing = dedupedByExternalKey.get(externalKey);
      if (existing) {
        if (!existing.pullRequestIds.includes(item.pullRequestId)) {
          existing.pullRequestIds.push(item.pullRequestId);
        }
        continue;
      }
      dedupedByExternalKey.set(externalKey, {
        owner: item.owner,
        repo: item.repo,
        number: item.number,
        alias: `pr${dedupedByExternalKey.size.toString(36)}`,
        pullRequestIds: [item.pullRequestId],
      });
    }
    const dedupedItems = Array.from(dedupedByExternalKey.values());

    const queryText = buildBatchQuery(
      dedupedItems.map((item) => ({
        pullRequestId: item.pullRequestIds[0],
        owner: item.owner,
        repo: item.repo,
        number: item.number,
        alias: item.alias,
      }))
    );
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "tasky-pr-sync",
      },
      body: JSON.stringify({ query: queryText }),
    });

    if (!response.ok) {
      return {
        status: "failed" as const,
        updatedCount: 0,
        results: [
          ...invalidResults,
          ...dedupedItems.flatMap((item) =>
            item.pullRequestIds.map((pullRequestId) => ({
              pullRequestId,
              status: "failed" as const,
              reason: `GitHub API returned ${response.status}`,
            }))
          ),
        ],
      };
    }

    const payload = (await response.json()) as {
      data?: Record<
        string,
        | {
            pullRequest: {
              state: "OPEN" | "CLOSED" | "MERGED";
              isDraft: boolean;
              merged: boolean;
            } | null;
          }
        | null
      >;
      errors?: Array<{ path?: Array<string | number>; message?: string }>;
    };

    const errorsByAlias = new Map<string, string>();
    for (const error of payload.errors ?? []) {
      const alias = error.path?.[0];
      if (typeof alias === "string" && error.message) {
        errorsByAlias.set(alias, error.message);
      }
    }

    const successResults: Array<{
      pullRequestId: (typeof args.items)[number]["pullRequestId"];
      status: "updated" | "not_found" | "failed";
      reason?: string;
    }> = [];
    let updatedCount = 0;

    for (const item of dedupedItems) {
      const aliasNode = payload.data?.[item.alias];
      const fieldError = errorsByAlias.get(item.alias);
      if (fieldError) {
        for (const pullRequestId of item.pullRequestIds) {
          successResults.push({
            pullRequestId,
            status: "failed",
            reason: fieldError,
          });
        }
        continue;
      }

      const pullRequestNode = aliasNode?.pullRequest;
      if (!pullRequestNode) {
        for (const pullRequestId of item.pullRequestIds) {
          successResults.push({
            pullRequestId,
            status: "not_found",
          });
        }
        continue;
      }

      for (const pullRequestId of item.pullRequestIds) {
        try {
          const patched = await ctx.runMutation(internal.pullRequests.patchSyncFieldsInternal, {
            pullRequestId,
            userId,
            githubState: pullRequestNode.state,
            isDraft: pullRequestNode.isDraft,
            isMerged: pullRequestNode.merged,
            lastSyncedAt: now,
          });
          if (!patched) {
            successResults.push({
              pullRequestId,
              status: "not_found",
            });
            continue;
          }
          updatedCount += 1;
          successResults.push({
            pullRequestId,
            status: "updated",
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown patch error";
          successResults.push({
            pullRequestId,
            status: "failed",
            reason: message,
          });
        }
      }
    }

    return {
      status: "ok" as const,
      updatedCount,
      results: [...invalidResults, ...successResults],
    };
  },
});
