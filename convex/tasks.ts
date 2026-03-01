import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, QueryCtx } from "./_generated/server";
import { getAuthUserId } from "./auth";
import { Doc, Id } from "./_generated/dataModel";
import { taskStatus, taskPriority } from "./schema";
import { insertEvent } from "./events";
import { parseGitHubPullRequestUrl } from "./pullRequests";

async function hydrateTasksWithRelations<T extends { _id: Id<"tasks">; tagIds: Id<"tags">[] }>(
  ctx: QueryCtx,
  userId: string,
  tasks: T[]
): Promise<
  Array<
    T & {
      tags: Doc<"tags">[];
      agents: Doc<"agents">[];
      pullRequests: Array<
        Doc<"pullRequests"> & {
          normalized: ReturnType<typeof parseGitHubPullRequestUrl> | null;
        }
      >;
    }
  >
> {
  const [allAgents, allPullRequests] = await Promise.all([
    ctx.db.query("agents").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
    ctx.db.query("pullRequests").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
  ]);

  const agentsByTaskId = new Map<Id<"tasks">, typeof allAgents>();
  for (const agent of allAgents) {
    const listForTask = agentsByTaskId.get(agent.taskId);
    if (listForTask) {
      listForTask.push(agent);
    } else {
      agentsByTaskId.set(agent.taskId, [agent]);
    }
  }

  const pullRequestsByTaskId = new Map<
    Id<"tasks">,
    Array<
      (typeof allPullRequests)[number] & {
        normalized: {
          url: string;
          domain: string;
          owner: string;
          repo: string;
          number: number;
        } | null;
      }
    >
  >();
  for (const pullRequest of allPullRequests) {
    let normalized: ReturnType<typeof parseGitHubPullRequestUrl> | null = null;
    try {
      normalized = parseGitHubPullRequestUrl(pullRequest.url);
    } catch {
      normalized = null;
    }
    const next = { ...pullRequest, normalized };
    const listForTask = pullRequestsByTaskId.get(pullRequest.taskId);
    if (listForTask) {
      listForTask.push(next);
    } else {
      pullRequestsByTaskId.set(pullRequest.taskId, [next]);
    }
  }

  return await Promise.all(
    tasks.map(async (task) => {
      const tags = await Promise.all(task.tagIds.map((tagId) => ctx.db.get(tagId)));
      return {
        ...task,
        tags: tags.filter((t) => t !== null),
        agents: agentsByTaskId.get(task._id) ?? [],
        pullRequests: pullRequestsByTaskId.get(task._id) ?? [],
      };
    })
  );
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return await hydrateTasksWithRelations(ctx, userId, tasks);
  },
});

const openTaskStatuses: Array<Doc<"tasks">["status"]> = ["not_started", "in_progress", "blocked"];
const allTaskStatuses: Array<Doc<"tasks">["status"]> = [...openTaskStatuses, "closed"];

function extractAgentExternalId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^bc-[A-Za-z0-9.-]+$/.test(trimmed)) return trimmed;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== "cursor.com" && hostname !== "www.cursor.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && parts[0] === "agents" && /^bc-[A-Za-z0-9.-]+$/.test(parts[1])) {
      return parts[1];
    }
  } catch {
    return null;
  }
  return null;
}

export const listForMcp = internalQuery({
  args: {
    userId: v.string(),
    statuses: v.optional(v.array(taskStatus)),
    includeClosed: v.optional(v.boolean()),
    tagRootId: v.optional(v.id("tags")),
    searchQuery: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const statuses =
      args.statuses && args.statuses.length > 0
        ? Array.from(new Set(args.statuses))
        : args.includeClosed
          ? allTaskStatuses
          : openTaskStatuses;

    const normalizedSearchQuery = args.searchQuery?.trim();
    let tasks;
    if (normalizedSearchQuery) {
      tasks = await ctx.db
        .query("tasks")
        .withSearchIndex("search_content", (q) =>
          q.search("content", normalizedSearchQuery).eq("userId", args.userId)
        )
        .collect();
      const statusSet = new Set(statuses);
      tasks = tasks.filter((task) => statusSet.has(task.status));
    } else {
      const taskGroups = await Promise.all(
        statuses.map((status) =>
          ctx.db
            .query("tasks")
            .withIndex("by_user_status", (q) => q.eq("userId", args.userId).eq("status", status))
            .collect()
        )
      );
      tasks = taskGroups.flat();
    }

    if (args.tagRootId) {
      const rootTag = await ctx.db.get(args.tagRootId);
      if (!rootTag || rootTag.userId !== args.userId) {
        throw new Error("Tag scope is invalid for this user");
      }

      const matchingTagIds = new Set<Id<"tags">>([args.tagRootId]);
      for (const childId of rootTag.childrenRecursive ?? []) {
        matchingTagIds.add(childId);
      }

      tasks = tasks.filter((task) => task.tagIds.some((tagId) => matchingTagIds.has(tagId)));
    }

    const taskIds = new Set(tasks.map((task) => task._id));
    const [allAgents, allPullRequests] = await Promise.all([
      ctx.db.query("agents").withIndex("by_user", (q) => q.eq("userId", args.userId)).collect(),
      ctx.db.query("pullRequests").withIndex("by_user", (q) => q.eq("userId", args.userId)).collect(),
    ]);

    const agentsByTaskId = new Map<Id<"tasks">, Doc<"agents">[]>();
    for (const agent of allAgents) {
      if (!taskIds.has(agent.taskId)) continue;
      const listForTask = agentsByTaskId.get(agent.taskId);
      if (listForTask) {
        listForTask.push(agent);
      } else {
        agentsByTaskId.set(agent.taskId, [agent]);
      }
    }

    const pullRequestsByTaskId = new Map<
      Id<"tasks">,
      Array<
        Doc<"pullRequests"> & {
          normalized: ReturnType<typeof parseGitHubPullRequestUrl> | null;
        }
      >
    >();
    for (const pullRequest of allPullRequests) {
      if (!taskIds.has(pullRequest.taskId)) continue;
      let normalized: ReturnType<typeof parseGitHubPullRequestUrl> | null = null;
      try {
        normalized = parseGitHubPullRequestUrl(pullRequest.url);
      } catch {
        normalized = null;
      }
      const next = { ...pullRequest, normalized };
      const listForTask = pullRequestsByTaskId.get(pullRequest.taskId);
      if (listForTask) {
        listForTask.push(next);
      } else {
        pullRequestsByTaskId.set(pullRequest.taskId, [next]);
      }
    }

    return tasks
      .sort((a, b) => b._creationTime - a._creationTime)
      .map((task) => ({
        _id: task._id,
        _creationTime: task._creationTime,
        content: task.content,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        completedAt: task.completedAt,
        statusUpdatedAt: task.statusUpdatedAt,
        tagIds: task.tagIds,
        agents: agentsByTaskId.get(task._id) ?? [],
        pullRequests: pullRequestsByTaskId.get(task._id) ?? [],
      }));
  },
});

export const updateFromMcp = internalMutation({
  args: {
    userId: v.string(),
    id: v.id("tasks"),
    tagRootId: v.optional(v.id("tags")),
    content: v.optional(v.string()),
    status: v.optional(taskStatus),
    priority: v.optional(taskPriority),
    dueDate: v.optional(v.union(v.string(), v.null())),
    addAgent: v.optional(v.string()),
    removeAgentById: v.optional(v.id("agents")),
    addPullRequestByUrl: v.optional(v.string()),
    removePullRequestByUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (!task || task.userId !== args.userId) {
      throw new Error("Task not found or access denied");
    }

    if (args.tagRootId) {
      const rootTag = await ctx.db.get(args.tagRootId);
      if (!rootTag || rootTag.userId !== args.userId) {
        throw new Error("Tag scope is invalid for this user");
      }
      const matchingTagIds = new Set<Id<"tags">>([args.tagRootId]);
      for (const childId of rootTag.childrenRecursive ?? []) {
        matchingTagIds.add(childId);
      }
      const inScope = task.tagIds.some((tagId) => matchingTagIds.has(tagId));
      if (!inScope) {
        throw new Error("Task is outside the allowed tag scope");
      }
    }

    const now = Date.now();
    const updates: {
      content?: string;
      status?: typeof args.status;
      priority?: typeof args.priority;
      dueDate?: string | undefined;
      statusUpdatedAt?: number;
      completedAt?: number | undefined;
    } = {};
    let taskEdited = false;

    if (args.content !== undefined && args.content !== task.content) {
      updates.content = args.content;
      taskEdited = true;
    }
    if (args.status !== undefined && args.status !== task.status) {
      updates.status = args.status;
      updates.statusUpdatedAt = now;
      taskEdited = true;
      if (args.status === "closed" && task.status !== "closed") {
        updates.completedAt = now;
      } else if (args.status !== "closed" && task.status === "closed") {
        updates.completedAt = undefined;
      }
    }
    if (args.priority !== undefined && args.priority !== task.priority) {
      updates.priority = args.priority;
      taskEdited = true;
    }
    if (args.dueDate !== undefined) {
      const normalizedDueDate = args.dueDate ?? undefined;
      if (normalizedDueDate !== task.dueDate) {
        updates.dueDate = normalizedDueDate;
        taskEdited = true;
      }
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(args.id, updates);
    }

    if (taskEdited) {
      await insertEvent(ctx, {
        userId: args.userId,
        entityId: args.id,
        action: { type: "task.edited" },
        tagIds: task.tagIds.length > 0 ? task.tagIds : undefined,
      });
    }
    if (args.status !== undefined && args.status !== task.status) {
      await insertEvent(ctx, {
        userId: args.userId,
        entityId: args.id,
        action: { type: "task.status_changed", from: task.status, to: args.status },
        tagIds: task.tagIds.length > 0 ? task.tagIds : undefined,
      });
    }
    if (args.priority !== undefined && args.priority !== task.priority) {
      await insertEvent(ctx, {
        userId: args.userId,
        entityId: args.id,
        action: { type: "task.priority_changed", from: task.priority, to: args.priority },
        tagIds: task.tagIds.length > 0 ? task.tagIds : undefined,
      });
    }

    let addedAgent:
      | {
          id: Id<"agents">;
          externalId: string;
        }
      | undefined;
    let removedAgent:
      | {
          id: Id<"agents">;
          externalId: string;
        }
      | undefined;

    if (args.addAgent !== undefined) {
      const externalId = extractAgentExternalId(args.addAgent);
      if (!externalId) {
        throw new Error("Invalid agent input. Use bc-... or cursor.com/agents/bc-...");
      }
      const existingForTask = await ctx.db
        .query("agents")
        .withIndex("by_user_task", (q) => q.eq("userId", args.userId).eq("taskId", args.id))
        .filter((q) => q.eq(q.field("externalId"), externalId))
        .first();
      if (!existingForTask) {
        const existingForUser = await ctx.db
          .query("agents")
          .withIndex("by_user_external_id", (q) =>
            q.eq("userId", args.userId).eq("externalId", externalId)
          )
          .first();
        if (existingForUser) {
          throw new Error("Agent external ID already exists on another task");
        }
        const agentId = await ctx.db.insert("agents", {
          userId: args.userId,
          taskId: args.id,
          externalId,
          link: `https://cursor.com/agents/${externalId}`,
          title: externalId,
          status: "",
          lastSyncedAt: undefined,
          updatedAt: now,
        });
        await insertEvent(ctx, {
          userId: args.userId,
          entityId: agentId,
          action: { type: "agent.created" },
          tagIds: task.tagIds.length > 0 ? task.tagIds : undefined,
        });
        addedAgent = { id: agentId, externalId };
      }
    }

    if (args.removeAgentById !== undefined) {
      const existingForTask = await ctx.db.get(args.removeAgentById);
      if (existingForTask && existingForTask.userId === args.userId && existingForTask.taskId === args.id) {
        await insertEvent(ctx, {
          userId: args.userId,
          entityId: existingForTask._id,
          action: { type: "agent.deleted" },
          tagIds: task.tagIds.length > 0 ? task.tagIds : undefined,
        });
        await ctx.db.delete(existingForTask._id);
        removedAgent = { id: existingForTask._id, externalId: existingForTask.externalId };
      }
    }

    let addedPullRequest:
      | {
          id: Id<"pullRequests">;
          url: string;
        }
      | undefined;
    let removedPullRequest:
      | {
          id: Id<"pullRequests">;
          url: string;
        }
      | undefined;

    if (args.addPullRequestByUrl !== undefined) {
      const normalized = parseGitHubPullRequestUrl(args.addPullRequestByUrl);
      const existingForTask = await ctx.db
        .query("pullRequests")
        .withIndex("by_user_task", (q) => q.eq("userId", args.userId).eq("taskId", args.id))
        .filter((q) => q.eq(q.field("url"), normalized.url))
        .first();
      if (!existingForTask) {
        const pullRequestId = await ctx.db.insert("pullRequests", {
          userId: args.userId,
          taskId: args.id,
          url: normalized.url,
          updatedAt: now,
        });
        await insertEvent(ctx, {
          userId: args.userId,
          entityId: pullRequestId,
          action: { type: "pull_request.created" },
          tagIds: task.tagIds.length > 0 ? task.tagIds : undefined,
        });
        addedPullRequest = { id: pullRequestId, url: normalized.url };
      }
    }

    if (args.removePullRequestByUrl !== undefined) {
      const normalized = parseGitHubPullRequestUrl(args.removePullRequestByUrl);
      const existingForTask = await ctx.db
        .query("pullRequests")
        .withIndex("by_user_task", (q) => q.eq("userId", args.userId).eq("taskId", args.id))
        .filter((q) => q.eq(q.field("url"), normalized.url))
        .first();
      if (existingForTask) {
        await insertEvent(ctx, {
          userId: args.userId,
          entityId: existingForTask._id,
          action: { type: "pull_request.deleted" },
          tagIds: task.tagIds.length > 0 ? task.tagIds : undefined,
        });
        await ctx.db.delete(existingForTask._id);
        removedPullRequest = { id: existingForTask._id, url: normalized.url };
      }
    }

    return {
      taskId: args.id,
      updatedFields: {
        content: updates.content !== undefined,
        status: updates.status !== undefined,
        priority: updates.priority !== undefined,
        dueDate: updates.dueDate !== undefined || (args.dueDate === null && task.dueDate !== undefined),
      },
      addedAgent,
      removedAgent,
      addedPullRequest,
      removedPullRequest,
    };
  },
});

export const create = mutation({
  args: {
    content: v.string(),
    tagIds: v.optional(v.array(v.id("tags"))),
    status: v.optional(taskStatus),
    priority: v.optional(taskPriority),
    dueDate: v.optional(v.string()),
    createdFromCaptureId: v.optional(v.id("captures")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const now = Date.now();
    const status = args.status ?? "not_started";
    const taskId = await ctx.db.insert("tasks", {
      userId,
      content: args.content,
      tagIds: args.tagIds ?? [],
      status,
      priority: args.priority ?? "triage",
      dueDate: args.dueDate,
      createdFromCaptureId: args.createdFromCaptureId,
      statusUpdatedAt: now,
      completedAt: status === "closed" ? now : undefined,
    });

    const tagIds = args.tagIds ?? [];
    await insertEvent(ctx, {
      userId,
      entityId: taskId,
      action: { type: "task.created" },
      tagIds: tagIds.length > 0 ? tagIds : undefined,
    });

    // If created from a capture, delete the source capture
    if (args.createdFromCaptureId) {
      const capture = await ctx.db.get(args.createdFromCaptureId);
      if (capture && capture.userId === userId) {
        await insertEvent(ctx, {
          userId,
          entityId: args.createdFromCaptureId,
          action: { type: "capture.filed_as_task" },
        });
        await ctx.db.delete(args.createdFromCaptureId);
      }
    }

    return taskId;
  },
});

export const createFromCapture = mutation({
  args: {
    captureId: v.id("captures"),
    tagIds: v.optional(v.array(v.id("tags"))),
    priority: v.optional(taskPriority),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const capture = await ctx.db.get(args.captureId);
    if (!capture || capture.userId !== userId) {
      throw new Error("Capture not found or access denied");
    }

    const now = Date.now();

    // Create a task with the capture text as initial content
    const taskId = await ctx.db.insert("tasks", {
      userId,
      content: capture.text,
      tagIds: args.tagIds ?? [],
      status: "not_started",
      priority: args.priority ?? "triage",
      createdFromCaptureId: args.captureId,
      statusUpdatedAt: now,
    });

    const tagIds = args.tagIds ?? [];
    await insertEvent(ctx, {
      userId,
      entityId: taskId,
      action: { type: "task.created" },
      tagIds: tagIds.length > 0 ? tagIds : undefined,
    });
    await insertEvent(ctx, {
      userId,
      entityId: args.captureId,
      action: { type: "capture.filed_as_task" },
    });

    // Delete the capture after converting to task
    await ctx.db.delete(args.captureId);

    return taskId;
  },
});

export const update = mutation({
  args: {
    id: v.id("tasks"),
    content: v.optional(v.string()),
    tagIds: v.optional(v.array(v.id("tags"))),
    status: v.optional(taskStatus),
    priority: v.optional(taskPriority),
    dueDate: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const task = await ctx.db.get(args.id);
    if (!task || task.userId !== userId) {
      throw new Error("Task not found or access denied");
    }

    const now = Date.now();
    const updates: {
      content?: string;
      tagIds?: typeof args.tagIds;
      status?: typeof args.status;
      priority?: typeof args.priority;
      dueDate?: string | undefined;
      statusUpdatedAt?: number;
      completedAt?: number | undefined;
    } = {};
    if (args.content !== undefined) updates.content = args.content;
    if (args.tagIds !== undefined) updates.tagIds = args.tagIds;
    if (args.status !== undefined && args.status !== task.status) {
      updates.status = args.status;
      updates.statusUpdatedAt = now;
      // Track completion timestamp
      if (args.status === "closed" && task.status !== "closed") {
        updates.completedAt = now;
      } else if (args.status !== "closed" && task.status === "closed") {
        // Clear completedAt if moving out of closed status
        updates.completedAt = undefined;
      }
    }
    if (args.priority !== undefined) updates.priority = args.priority;
    if (args.dueDate !== undefined) updates.dueDate = args.dueDate ?? undefined;

    await ctx.db.patch(args.id, updates);

    const effectiveTagIds = args.tagIds ?? task.tagIds;
    const eventTagIds = effectiveTagIds.length > 0 ? effectiveTagIds : undefined;

    await insertEvent(ctx, {
      userId,
      entityId: args.id,
      action: { type: "task.edited" },
      tagIds: eventTagIds,
    });

    if (args.status !== undefined && args.status !== task.status) {
      await insertEvent(ctx, {
        userId,
        entityId: args.id,
        action: { type: "task.status_changed", from: task.status, to: args.status },
        tagIds: eventTagIds,
      });
    }

    if (args.priority !== undefined && args.priority !== task.priority) {
      await insertEvent(ctx, {
        userId,
        entityId: args.id,
        action: { type: "task.priority_changed", from: task.priority, to: args.priority },
        tagIds: eventTagIds,
      });
    }
  },
});

// Optimized mutation for drag-and-drop status changes
export const updateStatus = mutation({
  args: {
    id: v.id("tasks"),
    status: taskStatus,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const task = await ctx.db.get(args.id);
    if (!task || task.userId !== userId) {
      throw new Error("Task not found or access denied");
    }

    // Skip if status hasn't changed
    if (task.status === args.status) {
      return;
    }

    const now = Date.now();
    const updates: {
      status: typeof args.status;
      statusUpdatedAt: number;
      completedAt?: number | undefined;
    } = {
      status: args.status,
      statusUpdatedAt: now,
    };

    // Track completion timestamp
    if (args.status === "closed" && task.status !== "closed") {
      updates.completedAt = now;
    } else if (args.status !== "closed" && task.status === "closed") {
      updates.completedAt = undefined;
    }

    await ctx.db.patch(args.id, updates);

    await insertEvent(ctx, {
      userId,
      entityId: args.id,
      action: { type: "task.status_changed", from: task.status, to: args.status },
      tagIds: task.tagIds.length > 0 ? task.tagIds : undefined,
    });
  },
});

// Optimized mutation for drag-and-drop priority changes
export const updatePriority = mutation({
  args: {
    id: v.id("tasks"),
    priority: taskPriority,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const task = await ctx.db.get(args.id);
    if (!task || task.userId !== userId) {
      throw new Error("Task not found or access denied");
    }

    // Skip if priority hasn't changed
    if (task.priority === args.priority) {
      return;
    }

    await ctx.db.patch(args.id, { priority: args.priority });

    await insertEvent(ctx, {
      userId,
      entityId: args.id,
      action: { type: "task.priority_changed", from: task.priority, to: args.priority },
      tagIds: task.tagIds.length > 0 ? task.tagIds : undefined,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const task = await ctx.db.get(args.id);
    if (!task || task.userId !== userId) {
      throw new Error("Task not found or access denied");
    }
    await insertEvent(ctx, {
      userId,
      entityId: args.id,
      action: { type: "task.deleted" },
      tagIds: task.tagIds.length > 0 ? task.tagIds : undefined,
    });

    const [linkedAgents, linkedPullRequests] = await Promise.all([
      ctx.db
        .query("agents")
        .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", args.id))
        .collect(),
      ctx.db
        .query("pullRequests")
        .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", args.id))
        .collect(),
    ]);

    await Promise.all([
      ...linkedAgents.map((agent) => ctx.db.delete(agent._id)),
      ...linkedPullRequests.map((pullRequest) => ctx.db.delete(pullRequest._id)),
    ]);

    await ctx.db.delete(args.id);
  },
});

// Search tasks by full-text search and/or tag filtering (with recursive child tags)
export const search = query({
  args: {
    searchText: v.optional(v.string()),
    tagId: v.optional(v.id("tags")),
    noTag: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    // If no search criteria, return empty (use list() for all tasks)
    if (!args.searchText && !args.tagId && !args.noTag) {
      return [];
    }

    let tasks;

    if (args.searchText && args.searchText.trim()) {
      // Full-text search using Convex search index
      tasks = await ctx.db
        .query("tasks")
        .withSearchIndex("search_content", (q) =>
          q.search("content", args.searchText!).eq("userId", userId)
        )
        .collect();
    } else {
      // No text search, get all user's tasks for tag filtering
      tasks = await ctx.db
        .query("tasks")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
    }

    // If filtering by "no tag", filter for tasks with empty tagIds
    if (args.noTag) {
      tasks = tasks.filter((task) => task.tagIds.length === 0);
    }
    // If tag filtering is requested, filter by tag and all its recursive children
    else if (args.tagId) {
      const tag = await ctx.db.get(args.tagId);
      if (!tag || tag.userId !== userId) {
        return [];
      }

      // Get all tag IDs to match: the selected tag + all its recursive children
      const matchingTagIds = new Set<Id<"tags">>([args.tagId]);
      if (tag.childrenRecursive) {
        for (const childId of tag.childrenRecursive) {
          matchingTagIds.add(childId);
        }
      }

      // Filter tasks that have at least one matching tag
      tasks = tasks.filter((task) =>
        task.tagIds.some((tagId) => matchingTagIds.has(tagId))
      );
    }

    return await hydrateTasksWithRelations(ctx, userId, tasks);
  },
});
