import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "./auth";
import { insertEvent } from "./events";

export function parseGitHubPullRequestUrl(rawUrl: string): {
  url: string;
  domain: string;
  owner: string;
  repo: string;
  number: number;
} {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid pull request URL");
  }

  const domain = parsed.hostname.toLowerCase();
  if (domain !== "github.com") {
    throw new Error("Only github.com pull request URLs are supported");
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 4 || parts[2] !== "pull") {
    throw new Error("URL must match github.com/<owner>/<repo>/pull/<number>");
  }

  const owner = parts[0];
  const repo = parts[1];
  const number = Number(parts[3]);
  if (!owner || !repo || !Number.isInteger(number) || number <= 0) {
    throw new Error("Invalid pull request URL");
  }

  return {
    url: parsed.toString(),
    domain,
    owner,
    repo,
    number,
  };
}

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

    const normalized = parseGitHubPullRequestUrl(args.url.trim());
    const now = Date.now();
    const pullRequestId = await ctx.db.insert("pullRequests", {
      userId,
      taskId: args.taskId,
      url: normalized.url,
      createdAt: now,
      updatedAt: now,
    });

    await insertEvent(ctx, {
      userId,
      entityId: pullRequestId,
      action: { type: "pull_request.created" },
      tagIds: task.tagIds.length > 0 ? task.tagIds : undefined,
    });

    return pullRequestId;
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
