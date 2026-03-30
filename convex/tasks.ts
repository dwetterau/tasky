import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { getAuthUserId } from "./auth";
import { Doc, Id } from "./_generated/dataModel";
import { taskStatus, taskPriority, EventSource } from "./schema";
import { insertEvent } from "./events";
import { parseGitHubPullRequestUrl } from "./pullRequests";
import { parseLinearIssueUrl } from "./linearIssues";
import { extractCursorAgentExternalId } from "./cursorAgentUrl";

const CLOSED_TASK_RETENTION_MS = 32 * 24 * 60 * 60 * 1000;

function filterStaleClosedTasks<
  T extends {
    status: Doc<"tasks">["status"];
    completedAt?: number;
    statusUpdatedAt?: number;
    _creationTime: number;
  },
>(
  tasks: T[],
  now = Date.now()
): T[] {
  return tasks.filter((task) => {
    if (task.status !== "closed") return true;
    const closedAt = task.completedAt ?? task.statusUpdatedAt ?? task._creationTime;
    return now - closedAt <= CLOSED_TASK_RETENTION_MS;
  });
}

function normalizeTaskTagIds(tagIds: Id<"tags">[] | undefined): Id<"tags">[] {
  return Array.from(new Set(tagIds ?? []));
}

async function assertOwnedTaskTagIds(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  tagIds: Id<"tags">[] | undefined
): Promise<Id<"tags">[]> {
  const normalizedTagIds = normalizeTaskTagIds(tagIds);
  if (normalizedTagIds.length === 0) {
    return [];
  }

  const tags = await Promise.all(normalizedTagIds.map((tagId) => ctx.db.get(tagId)));
  const hasInvalidTag = tags.some((tag) => !tag || tag.userId !== userId);
  if (hasInvalidTag) {
    throw new Error("One or more tags are invalid for this user");
  }

  return normalizedTagIds;
}

async function syncTaskTagLinks(
  ctx: MutationCtx,
  userId: string,
  taskId: Id<"tasks">,
  tagIds: Id<"tags">[]
): Promise<void> {
  const nextTagIds = new Set(normalizeTaskTagIds(tagIds));
  const existingLinks = await ctx.db
    .query("taskTags")
    .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", taskId))
    .collect();

  const seenExistingTagIds = new Set<Id<"tags">>();
  for (const link of existingLinks) {
    if (!nextTagIds.has(link.tagId) || seenExistingTagIds.has(link.tagId)) {
      await ctx.db.delete(link._id);
      continue;
    }
    seenExistingTagIds.add(link.tagId);
  }

  for (const tagId of nextTagIds) {
    if (!seenExistingTagIds.has(tagId)) {
      await ctx.db.insert("taskTags", {
        userId,
        taskId,
        tagId,
      });
    }
  }
}

function normalizePullRequestForTask(
  pullRequest: Doc<"pullRequests">
): Doc<"pullRequests"> & {
  normalized: ReturnType<typeof parseGitHubPullRequestUrl> | null;
} {
  let normalized: ReturnType<typeof parseGitHubPullRequestUrl> | null = null;
  try {
    normalized = parseGitHubPullRequestUrl(pullRequest.url);
  } catch {
    normalized = null;
  }

  return { ...pullRequest, normalized };
}

function normalizeLinearIssueForTask(
  linearIssue: Doc<"linearIssues">
): Doc<"linearIssues"> & {
  normalized: ReturnType<typeof parseLinearIssueUrl> | null;
} {
  let normalized: ReturnType<typeof parseLinearIssueUrl> | null = null;
  try {
    normalized = parseLinearIssueUrl(linearIssue.url);
  } catch {
    normalized = null;
  }

  return { ...linearIssue, normalized };
}

async function loadTaskRelations(
  ctx: QueryCtx,
  userId: string,
  taskId: Id<"tasks">
): Promise<{
  agents: Doc<"agents">[];
  pullRequests: Array<
    Doc<"pullRequests"> & {
      normalized: ReturnType<typeof parseGitHubPullRequestUrl> | null;
    }
  >;
  linearIssues: Array<
    Doc<"linearIssues"> & {
      normalized: ReturnType<typeof parseLinearIssueUrl> | null;
    }
  >;
}> {
  const [agents, pullRequests, linearIssues] = await Promise.all([
    ctx.db.query("agents").withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", taskId)).collect(),
    ctx.db
      .query("pullRequests")
      .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", taskId))
      .collect(),
    ctx.db
      .query("linearIssues")
      .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", taskId))
      .collect(),
  ]);

  return {
    agents,
    pullRequests: pullRequests.map(normalizePullRequestForTask),
    linearIssues: linearIssues.map(normalizeLinearIssueForTask),
  };
}

async function loadTasksByIds(
  ctx: QueryCtx,
  userId: string,
  taskIds: Iterable<Id<"tasks">>
): Promise<Doc<"tasks">[]> {
  const uniqueTaskIds = Array.from(new Set(taskIds));
  const tasks = await Promise.all(uniqueTaskIds.map((taskId) => ctx.db.get(taskId)));
  return tasks.filter((task): task is Doc<"tasks"> => task !== null && task.userId === userId);
}

async function getTaskIdsForTagSubtree(
  ctx: QueryCtx,
  userId: string,
  rootTagId: Id<"tags">,
  invalidErrorMessage?: string
): Promise<Set<Id<"tasks">>> {
  const rootTag = await ctx.db.get(rootTagId);
  if (!rootTag || rootTag.userId !== userId) {
    throw new Error(invalidErrorMessage ?? "Tag not found or access denied");
  }

  const matchingTagIds = new Set<Id<"tags">>([rootTagId]);
  for (const childId of rootTag.childrenRecursive ?? []) {
    matchingTagIds.add(childId);
  }

  const taskIds = new Set<Id<"tasks">>();
  for (const tagId of matchingTagIds) {
    const links = await ctx.db
      .query("taskTags")
      .withIndex("by_user_tag", (q) => q.eq("userId", userId).eq("tagId", tagId))
      .collect();
    for (const link of links) {
      taskIds.add(link.taskId);
    }
  }

  return taskIds;
}

async function hydrateTasksWithScopedRelations<T extends { _id: Id<"tasks">; tagIds: Id<"tags">[] }>(
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
      linearIssues: Array<
        Doc<"linearIssues"> & {
          normalized: ReturnType<typeof parseLinearIssueUrl> | null;
        }
      >;
    }
  >
> {
  return await Promise.all(
    tasks.map(async (task) => {
      const [tags, relations] = await Promise.all([
        Promise.all(task.tagIds.map((tagId) => ctx.db.get(tagId))),
        loadTaskRelations(ctx, userId, task._id),
      ]);

      return {
        ...task,
        tags: tags.filter((tag): tag is Doc<"tags"> => tag !== null),
        agents: relations.agents,
        pullRequests: relations.pullRequests,
        linearIssues: relations.linearIssues,
      };
    })
  );
}

export const list = query({
  args: {
    closedAfter: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const [openTaskGroups, recentClosedTasks] = await Promise.all([
      Promise.all(
        openTaskStatuses.map((status) =>
          ctx.db
            .query("tasks")
            .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", status))
            .collect()
        )
      ),
      ctx.db
        .query("tasks")
        .withIndex("by_user_status_status_updated_at", (q) =>
          q.eq("userId", userId).eq("status", "closed").gte("statusUpdatedAt", args.closedAfter)
        )
        .collect(),
    ]);

    return await hydrateTasksWithScopedRelations(ctx, userId, [...openTaskGroups.flat(), ...recentClosedTasks]);
  },
});

const openTaskStatuses: Array<Doc<"tasks">["status"]> = ["not_started", "in_progress", "agent_running", "blocked"];
const allTaskStatuses: Array<Doc<"tasks">["status"]> = [...openTaskStatuses, "closed"];

function normalizeTagText(value: string): string {
  return value.trim().toLowerCase();
}

function findClosestTagByName(tags: Doc<"tags">[], rawFilter: string): Doc<"tags"> | null {
  const query = normalizeTagText(rawFilter);
  if (!query) {
    return null;
  }

  const candidates = tags.map((tag) => {
    const normalizedName = normalizeTagText(tag.name);
    let rank = 99;
    if (normalizedName === query) {
      rank = 0;
    } else if (normalizedName.startsWith(query)) {
      rank = 1;
    } else if (query.startsWith(normalizedName)) {
      rank = 2;
    } else if (normalizedName.includes(query)) {
      rank = 3;
    } else if (query.includes(normalizedName)) {
      rank = 4;
    }
    const lengthDelta = Math.abs(normalizedName.length - query.length);
    return { tag, normalizedName, rank, lengthDelta };
  });

  const matched = candidates
    .filter((candidate) => candidate.rank < 99)
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.lengthDelta !== b.lengthDelta) return a.lengthDelta - b.lengthDelta;
      return a.normalizedName.localeCompare(b.normalizedName);
    })[0];

  return matched?.tag ?? null;
}

function getEventTagIds(tagIds: Id<"tags">[]): Id<"tags">[] | undefined {
  return tagIds.length > 0 ? tagIds : undefined;
}

async function attachAgentToTaskIfMissing(args: {
  ctx: MutationCtx;
  userId: string;
  taskId: Id<"tasks">;
  addAgentInput: string;
  now: number;
  source?: EventSource;
  eventTagIds?: Id<"tags">[];
}): Promise<
  | {
      id: Id<"agents">;
      externalId: string;
    }
  | undefined
> {
  const externalId = extractCursorAgentExternalId(args.addAgentInput);
  if (!externalId) {
    throw new Error("Invalid agent input. Use bc-... or cursor.com/agents/bc-...");
  }

  const existingForTask = await args.ctx.db
    .query("agents")
    .withIndex("by_user_task_external_id", (q) =>
      q.eq("userId", args.userId).eq("taskId", args.taskId).eq("externalId", externalId)
    )
    .first();
  if (existingForTask) {
    return undefined;
  }

  const existingForUser = await args.ctx.db
    .query("agents")
    .withIndex("by_user_external_id", (q) => q.eq("userId", args.userId).eq("externalId", externalId))
    .first();
  if (existingForUser && existingForUser.taskId !== args.taskId) {
    throw new Error("Agent external ID already exists on another task");
  }
  if (existingForUser) {
    return undefined;
  }

  const agentId = await args.ctx.db.insert("agents", {
    userId: args.userId,
    taskId: args.taskId,
    externalId,
    link: `https://cursor.com/agents/${externalId}`,
    title: externalId,
    status: "",
    lastSyncedAt: undefined,
    updatedAt: args.now,
  });
  await insertEvent(args.ctx, {
    userId: args.userId,
    entityId: agentId,
    action: { type: "agent.created" },
    source: args.source,
    tagIds: args.eventTagIds,
  });
  return { id: agentId, externalId };
}

async function attachPullRequestToTaskIfMissing(args: {
  ctx: MutationCtx;
  userId: string;
  taskId: Id<"tasks">;
  addPullRequestByUrl: string;
  now: number;
  source?: EventSource;
  eventTagIds?: Id<"tags">[];
}): Promise<
  | {
      id: Id<"pullRequests">;
      url: string;
    }
  | undefined
> {
  const normalized = parseGitHubPullRequestUrl(args.addPullRequestByUrl);
  const existingForTask = await args.ctx.db
    .query("pullRequests")
    .withIndex("by_user_task_url", (q) =>
      q.eq("userId", args.userId).eq("taskId", args.taskId).eq("url", normalized.url)
    )
    .first();
  if (existingForTask) {
    return undefined;
  }

  const existingForUser = await args.ctx.db
    .query("pullRequests")
    .withIndex("by_user_url", (q) => q.eq("userId", args.userId).eq("url", normalized.url))
    .first();
  if (existingForUser && existingForUser.taskId !== args.taskId) {
    throw new Error("Pull request is already linked to another task");
  }
  if (existingForUser) {
    return undefined;
  }

  const pullRequestId = await args.ctx.db.insert("pullRequests", {
    userId: args.userId,
    taskId: args.taskId,
    url: normalized.url,
    updatedAt: args.now,
  });
  await insertEvent(args.ctx, {
    userId: args.userId,
    entityId: pullRequestId,
    action: { type: "pull_request.created" },
    source: args.source,
    tagIds: args.eventTagIds,
  });
  return { id: pullRequestId, url: normalized.url };
}

async function attachLinearIssueToTaskIfMissing(args: {
  ctx: MutationCtx;
  userId: string;
  taskId: Id<"tasks">;
  addLinearIssueByUrl: string;
  now: number;
  source?: EventSource;
  eventTagIds?: Id<"tags">[];
}): Promise<
  | {
      id: Id<"linearIssues">;
      url: string;
      identifier: string;
    }
  | undefined
> {
  const normalized = parseLinearIssueUrl(args.addLinearIssueByUrl);
  const existingForTask = await args.ctx.db
    .query("linearIssues")
    .withIndex("by_user_task_url", (q) =>
      q.eq("userId", args.userId).eq("taskId", args.taskId).eq("url", normalized.url)
    )
    .first();
  if (existingForTask) {
    return undefined;
  }

  const existingForUser = await args.ctx.db
    .query("linearIssues")
    .withIndex("by_user_url", (q) => q.eq("userId", args.userId).eq("url", normalized.url))
    .first();
  if (existingForUser && existingForUser.taskId !== args.taskId) {
    throw new Error("Linear issue is already linked to another task");
  }
  if (existingForUser) {
    return undefined;
  }

  const linearIssueId = await args.ctx.db.insert("linearIssues", {
    userId: args.userId,
    taskId: args.taskId,
    url: normalized.url,
    identifier: normalized.identifier,
    updatedAt: args.now,
  });
  await insertEvent(args.ctx, {
    userId: args.userId,
    entityId: linearIssueId,
    action: { type: "linear_issue.created" },
    source: args.source,
    tagIds: args.eventTagIds,
  });
  return { id: linearIssueId, url: normalized.url, identifier: normalized.identifier };
}

export const listForMcp = internalQuery({
  args: {
    userId: v.string(),
    statuses: v.optional(v.array(taskStatus)),
    includeClosed: v.optional(v.boolean()),
    tagRootId: v.optional(v.id("tags")),
    searchQuery: v.optional(v.string()),
    filterTag: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const statuses =
      args.statuses && args.statuses.length > 0
        ? Array.from(new Set(args.statuses))
        : args.includeClosed
          ? allTaskStatuses
          : openTaskStatuses;
    const statusSet = new Set(statuses);

    const allTags = await ctx.db.query("tags").withIndex("by_user", (q) => q.eq("userId", args.userId)).collect();
    const tagNameById = new Map(allTags.map((tag) => [tag._id, tag.name]));

    const normalizedSearchQuery = args.searchQuery?.trim();
    const normalizedFilterTag = args.filterTag?.trim();
    const matchedFilterTag =
      normalizedFilterTag ? findClosestTagByName(allTags, normalizedFilterTag) : null;
    if (normalizedFilterTag && !matchedFilterTag) {
      return [];
    }

    let scopedTaskIds: Set<Id<"tasks">> | null = null;
    if (args.tagRootId) {
      scopedTaskIds = await getTaskIdsForTagSubtree(
        ctx,
        args.userId,
        args.tagRootId,
        "Tag scope is invalid for this user"
      );
    }
    if (matchedFilterTag) {
      const filterTaskIds = await getTaskIdsForTagSubtree(
        ctx,
        args.userId,
        matchedFilterTag._id,
        "filterTag is invalid for this user"
      );
      scopedTaskIds =
        scopedTaskIds === null
          ? filterTaskIds
          : new Set(Array.from(scopedTaskIds).filter((taskId) => filterTaskIds.has(taskId)));
    }

    let tasks: Doc<"tasks">[];
    if (normalizedSearchQuery) {
      tasks = await ctx.db
        .query("tasks")
        .withSearchIndex("search_content", (q) =>
          q.search("content", normalizedSearchQuery).eq("userId", args.userId)
        )
        .collect();
      tasks = tasks.filter((task) => statusSet.has(task.status));
      if (scopedTaskIds !== null) {
        tasks = tasks.filter((task) => scopedTaskIds.has(task._id));
      }
    } else if (scopedTaskIds !== null) {
      tasks = await loadTasksByIds(ctx, args.userId, scopedTaskIds);
      tasks = filterStaleClosedTasks(tasks.filter((task) => statusSet.has(task.status)));
    } else {
      const taskGroups = await Promise.all(
        statuses.map((status) =>
          ctx.db
            .query("tasks")
            .withIndex("by_user_status", (q) => q.eq("userId", args.userId).eq("status", status))
            .collect()
        )
      );
      tasks = filterStaleClosedTasks(taskGroups.flat());
    }
    const sortedTasks = tasks.sort((a, b) => b._creationTime - a._creationTime);

    return await Promise.all(
      sortedTasks.map(async (task) => {
        const relations = await loadTaskRelations(ctx, args.userId, task._id);
        return {
          _id: task._id,
          _creationTime: task._creationTime,
          content: task.content,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          completedAt: task.completedAt,
          statusUpdatedAt: task.statusUpdatedAt,
          tags: task.tagIds
            .map((tagId) => tagNameById.get(tagId))
            .filter((tagName): tagName is string => Boolean(tagName)),
          agents: relations.agents,
          pullRequests: relations.pullRequests,
          linearIssues: relations.linearIssues,
        };
      })
    );
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
    addLinearIssueByUrl: v.optional(v.string()),
    removeLinearIssueByUrl: v.optional(v.string()),
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

    if (args.content !== undefined && args.content !== task.content) {
      updates.content = args.content;
    }
    if (args.status !== undefined && args.status !== task.status) {
      updates.status = args.status;
      updates.statusUpdatedAt = now;
      if (args.status === "closed" && task.status !== "closed") {
        updates.completedAt = now;
      } else if (args.status !== "closed" && task.status === "closed") {
        updates.completedAt = undefined;
      }
    }
    if (args.priority !== undefined && args.priority !== task.priority) {
      updates.priority = args.priority;
    }
    if (args.dueDate !== undefined) {
      const normalizedDueDate = args.dueDate ?? undefined;
      if (normalizedDueDate !== task.dueDate) {
        updates.dueDate = normalizedDueDate;
      }
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(args.id, updates);
    }

    const hasPrimaryTaskFieldInRequest =
      args.content !== undefined ||
      args.status !== undefined ||
      args.priority !== undefined ||
      args.dueDate !== undefined;
    if (hasPrimaryTaskFieldInRequest) {
      await insertEvent(ctx, {
        userId: args.userId,
        entityId: args.id,
        action: { type: "task.edited" },
        source: "MCP",
        tagIds: getEventTagIds(task.tagIds),
      });
    }
    if (args.status !== undefined && args.status !== task.status) {
      await insertEvent(ctx, {
        userId: args.userId,
        entityId: args.id,
        action: { type: "task.status_changed", from: task.status, to: args.status },
        source: "MCP",
        tagIds: getEventTagIds(task.tagIds),
      });
    }
    if (args.priority !== undefined && args.priority !== task.priority) {
      await insertEvent(ctx, {
        userId: args.userId,
        entityId: args.id,
        action: { type: "task.priority_changed", from: task.priority, to: args.priority },
        source: "MCP",
        tagIds: getEventTagIds(task.tagIds),
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
      addedAgent = await attachAgentToTaskIfMissing({
        ctx,
        userId: args.userId,
        taskId: args.id,
        addAgentInput: args.addAgent,
        now,
        source: "MCP",
        eventTagIds: getEventTagIds(task.tagIds),
      });
    }

    if (args.removeAgentById !== undefined) {
      const existingForTask = await ctx.db.get(args.removeAgentById);
      if (existingForTask && existingForTask.userId === args.userId && existingForTask.taskId === args.id) {
        await insertEvent(ctx, {
          userId: args.userId,
          entityId: existingForTask._id,
          action: { type: "agent.deleted" },
          source: "MCP",
          tagIds: getEventTagIds(task.tagIds),
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
      addedPullRequest = await attachPullRequestToTaskIfMissing({
        ctx,
        userId: args.userId,
        taskId: args.id,
        addPullRequestByUrl: args.addPullRequestByUrl,
        now,
        source: "MCP",
        eventTagIds: getEventTagIds(task.tagIds),
      });
    }

    if (args.removePullRequestByUrl !== undefined) {
      const normalized = parseGitHubPullRequestUrl(args.removePullRequestByUrl);
      const existingForTask = await ctx.db
        .query("pullRequests")
        .withIndex("by_user_task_url", (q) =>
          q.eq("userId", args.userId).eq("taskId", args.id).eq("url", normalized.url)
        )
        .first();
      if (existingForTask) {
        await insertEvent(ctx, {
          userId: args.userId,
          entityId: existingForTask._id,
          action: { type: "pull_request.deleted" },
          source: "MCP",
          tagIds: getEventTagIds(task.tagIds),
        });
        await ctx.db.delete(existingForTask._id);
        removedPullRequest = { id: existingForTask._id, url: normalized.url };
      }
    }

    let addedLinearIssue:
      | {
          id: Id<"linearIssues">;
          url: string;
          identifier: string;
        }
      | undefined;
    let removedLinearIssue:
      | {
          id: Id<"linearIssues">;
          url: string;
          identifier: string;
        }
      | undefined;

    if (args.addLinearIssueByUrl !== undefined) {
      addedLinearIssue = await attachLinearIssueToTaskIfMissing({
        ctx,
        userId: args.userId,
        taskId: args.id,
        addLinearIssueByUrl: args.addLinearIssueByUrl,
        now,
        source: "MCP",
        eventTagIds: getEventTagIds(task.tagIds),
      });
    }

    if (args.removeLinearIssueByUrl !== undefined) {
      const normalized = parseLinearIssueUrl(args.removeLinearIssueByUrl);
      const existingForTask = await ctx.db
        .query("linearIssues")
        .withIndex("by_user_task_url", (q) =>
          q.eq("userId", args.userId).eq("taskId", args.id).eq("url", normalized.url)
        )
        .first();
      if (existingForTask) {
        await insertEvent(ctx, {
          userId: args.userId,
          entityId: existingForTask._id,
          action: { type: "linear_issue.deleted" },
          source: "MCP",
          tagIds: getEventTagIds(task.tagIds),
        });
        await ctx.db.delete(existingForTask._id);
        removedLinearIssue = {
          id: existingForTask._id,
          url: normalized.url,
          identifier: existingForTask.identifier,
        };
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
      addedLinearIssue,
      removedLinearIssue,
    };
  },
});

export const createFromMcp = internalMutation({
  args: {
    userId: v.string(),
    tagRootId: v.optional(v.id("tags")),
    content: v.string(),
    status: v.optional(taskStatus),
    priority: v.optional(taskPriority),
    dueDate: v.optional(v.union(v.string(), v.null())),
    addAgent: v.optional(v.string()),
    addPullRequestByUrl: v.optional(v.string()),
    addLinearIssueByUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.tagRootId) {
      const rootTag = await ctx.db.get(args.tagRootId);
      if (!rootTag || rootTag.userId !== args.userId) {
        throw new Error("Tag scope is invalid for this user");
      }
    }

    const now = Date.now();
    const status = args.status ?? "not_started";
    const taskId = await ctx.db.insert("tasks", {
      userId: args.userId,
      content: args.content,
      tagIds: [],
      hasTags: false,
      status,
      priority: args.priority ?? "triage",
      dueDate: args.dueDate ?? undefined,
      statusUpdatedAt: now,
      completedAt: status === "closed" ? now : undefined,
    });

    await insertEvent(ctx, {
      userId: args.userId,
      entityId: taskId,
      action: { type: "task.created" },
      source: "MCP",
    });

    const addedAgent =
      args.addAgent === undefined
        ? undefined
        : await attachAgentToTaskIfMissing({
            ctx,
            userId: args.userId,
            taskId,
            addAgentInput: args.addAgent,
            now,
            source: "MCP",
            eventTagIds: undefined,
          });

    const addedPullRequest =
      args.addPullRequestByUrl === undefined
        ? undefined
        : await attachPullRequestToTaskIfMissing({
            ctx,
            userId: args.userId,
            taskId,
            addPullRequestByUrl: args.addPullRequestByUrl,
            now,
            source: "MCP",
            eventTagIds: undefined,
          });

    const addedLinearIssue =
      args.addLinearIssueByUrl === undefined
        ? undefined
        : await attachLinearIssueToTaskIfMissing({
            ctx,
            userId: args.userId,
            taskId,
            addLinearIssueByUrl: args.addLinearIssueByUrl,
            now,
            source: "MCP",
            eventTagIds: undefined,
          });

    return {
      taskId,
      addedAgent,
      addedPullRequest,
      addedLinearIssue,
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
    agentExternalIds: v.optional(v.array(v.string())),
    pullRequestUrls: v.optional(v.array(v.string())),
    linearIssueUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const tagIds = await assertOwnedTaskTagIds(ctx, userId, args.tagIds);
    const now = Date.now();
    const status = args.status ?? "not_started";
    const taskId = await ctx.db.insert("tasks", {
      userId,
      content: args.content,
      tagIds,
      hasTags: tagIds.length > 0,
      status,
      priority: args.priority ?? "triage",
      dueDate: args.dueDate,
      createdFromCaptureId: args.createdFromCaptureId,
      statusUpdatedAt: now,
      completedAt: status === "closed" ? now : undefined,
    });

    const createdAgents: Array<{ agentId: Id<"agents">; externalId: string }> = [];
    await syncTaskTagLinks(ctx, userId, taskId, tagIds);
    await insertEvent(ctx, {
      userId,
      entityId: taskId,
      action: { type: "task.created" },
      tagIds: tagIds.length > 0 ? tagIds : undefined,
    });

    const agentExternalIds = Array.from(
      new Set((args.agentExternalIds ?? []).map((value) => extractCursorAgentExternalId(value)).filter((value): value is string => Boolean(value)))
    );
    for (const externalId of agentExternalIds) {
      const agentId = await ctx.db.insert("agents", {
        userId,
        taskId,
        externalId,
        link: `https://cursor.com/agents/${externalId}`,
        title: externalId,
        status: "",
        lastSyncedAt: undefined,
        updatedAt: now,
      });
      createdAgents.push({ agentId, externalId });
      await insertEvent(ctx, {
        userId,
        entityId: agentId,
        action: { type: "agent.created" },
        tagIds: tagIds.length > 0 ? tagIds : undefined,
      });
    }

    const pullRequestUrls = Array.from(
      new Set(
        (args.pullRequestUrls ?? [])
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      )
    );
    for (const pullRequestUrl of pullRequestUrls) {
      const normalized = parseGitHubPullRequestUrl(pullRequestUrl);
      const pullRequestId = await ctx.db.insert("pullRequests", {
        userId,
        taskId,
        url: normalized.url,
        updatedAt: now,
      });
      await insertEvent(ctx, {
        userId,
        entityId: pullRequestId,
        action: { type: "pull_request.created" },
        tagIds: tagIds.length > 0 ? tagIds : undefined,
      });
    }

    const linearIssueUrls = Array.from(
      new Set(
        (args.linearIssueUrls ?? [])
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      )
    );
    for (const linearIssueUrl of linearIssueUrls) {
      const normalized = parseLinearIssueUrl(linearIssueUrl);
      const linearIssueId = await ctx.db.insert("linearIssues", {
        userId,
        taskId,
        url: normalized.url,
        identifier: normalized.identifier,
        updatedAt: now,
      });
      await insertEvent(ctx, {
        userId,
        entityId: linearIssueId,
        action: { type: "linear_issue.created" },
        tagIds: tagIds.length > 0 ? tagIds : undefined,
      });
    }

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

    return {
      taskId,
      createdAgents,
    };
  },
});

export const fillEmptyContentFromAgentTitleInternal = internalMutation({
  args: {
    userId: v.string(),
    taskIds: v.array(v.id("tasks")),
  },
  handler: async (ctx, args) => {
    for (const taskId of args.taskIds) {
      const task = await ctx.db.get(taskId);
      if (!task || task.userId !== args.userId) continue;
      if (task.content.trim().length > 0) continue;

      const agents = await ctx.db
        .query("agents")
        .withIndex("by_user_task", (q) => q.eq("userId", args.userId).eq("taskId", taskId))
        .order("desc")
        .collect();

      for (const agent of agents) {
        const title = agent.title.trim();
        if (title && title !== agent.externalId.trim()) {
          await ctx.db.patch(taskId, { content: title });
          break;
        }
      }
    }
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
    const tagIds = await assertOwnedTaskTagIds(ctx, userId, args.tagIds);

    const now = Date.now();

    // Create a task with the capture text as initial content
    const taskId = await ctx.db.insert("tasks", {
      userId,
      content: capture.text,
      tagIds,
      hasTags: tagIds.length > 0,
      status: "not_started",
      priority: args.priority ?? "triage",
      createdFromCaptureId: args.captureId,
      statusUpdatedAt: now,
    });

    await syncTaskTagLinks(ctx, userId, taskId, tagIds);
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
    const nextTagIds =
      args.tagIds !== undefined ? await assertOwnedTaskTagIds(ctx, userId, args.tagIds) : undefined;

    const now = Date.now();
    const updates: {
      content?: string;
      tagIds?: Id<"tags">[];
      hasTags?: boolean;
      status?: typeof args.status;
      priority?: typeof args.priority;
      dueDate?: string | undefined;
      statusUpdatedAt?: number;
      completedAt?: number | undefined;
    } = {};
    if (args.content !== undefined) updates.content = args.content;
    if (nextTagIds !== undefined) {
      updates.tagIds = nextTagIds;
      updates.hasTags = nextTagIds.length > 0;
    }
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
    if (nextTagIds !== undefined) {
      await syncTaskTagLinks(ctx, userId, args.id, nextTagIds);
    }

    const effectiveTagIds = nextTagIds ?? task.tagIds;
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

export const syncTaskStatusesFromAgentsInternal = internalMutation({
  args: {
    userId: v.string(),
    taskIds: v.optional(v.array(v.id("tasks"))),
  },
  handler: async (ctx, args) => {
    const userId = args.userId;

    const candidateTaskIds = new Set(args.taskIds ?? []);
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const filteredTasks =
      candidateTaskIds.size > 0
        ? tasks.filter((task) => candidateTaskIds.has(task._id))
        : tasks;

    const updatedTaskIds: Id<"tasks">[] = [];
    for (const task of filteredTasks) {
      if (task.status === "closed") continue;
      const agents = await ctx.db
        .query("agents")
        .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", task._id))
        .collect();
      if (agents.length === 0) continue;

      const hasRunningAgent = agents.some((agent) => {
        const status = agent.status.trim().toUpperCase();
        return status === "RUNNING" || status === "CREATING";
      });
      if (hasRunningAgent) {
        if (task.status === "agent_running") continue;
        await ctx.db.patch(task._id, {
          status: "agent_running",
          statusUpdatedAt: Date.now(),
        });
        await insertEvent(ctx, {
          userId,
          entityId: task._id,
          action: { type: "task.status_changed", from: task.status, to: "agent_running" },
          tagIds: task.tagIds.length > 0 ? task.tagIds : undefined,
        });
        updatedTaskIds.push(task._id);
        continue;
      }

      if (task.status === "agent_running" || task.status === "not_started") {
        await ctx.db.patch(task._id, {
          status: "in_progress",
          statusUpdatedAt: Date.now(),
        });
        await insertEvent(ctx, {
          userId,
          entityId: task._id,
          action: { type: "task.status_changed", from: task.status, to: "in_progress" },
          tagIds: task.tagIds.length > 0 ? task.tagIds : undefined,
        });
        updatedTaskIds.push(task._id);
      }
    }

    return { updatedTaskIds, updatedCount: updatedTaskIds.length };
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

    const [linkedAgents, linkedPullRequests, linkedLinearIssues, linkedTaskTags] = await Promise.all([
      ctx.db
        .query("agents")
        .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", args.id))
        .collect(),
      ctx.db
        .query("pullRequests")
        .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", args.id))
        .collect(),
      ctx.db
        .query("linearIssues")
        .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", args.id))
        .collect(),
      ctx.db
        .query("taskTags")
        .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", args.id))
        .collect(),
    ]);

    await Promise.all([
      ...linkedAgents.map((agent) => ctx.db.delete(agent._id)),
      ...linkedPullRequests.map((pullRequest) => ctx.db.delete(pullRequest._id)),
      ...linkedLinearIssues.map((linearIssue) => ctx.db.delete(linearIssue._id)),
      ...linkedTaskTags.map((taskTag) => ctx.db.delete(taskTag._id)),
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

    const normalizedSearchText = args.searchText?.trim();
    let tasks: Doc<"tasks">[];

    if (normalizedSearchText) {
      tasks = await ctx.db
        .query("tasks")
        .withSearchIndex("search_content", (q) =>
          q.search("content", normalizedSearchText).eq("userId", userId)
        )
        .collect();
      if (args.noTag) {
        tasks = tasks.filter((task) => !(task.hasTags ?? task.tagIds.length > 0));
      } else if (args.tagId) {
        let matchingTaskIds: Set<Id<"tasks">>;
        try {
          matchingTaskIds = await getTaskIdsForTagSubtree(ctx, userId, args.tagId);
        } catch {
          return [];
        }
        tasks = tasks.filter((task) => matchingTaskIds.has(task._id));
      }
    } else if (args.noTag) {
      tasks = await ctx.db
        .query("tasks")
        .withIndex("by_user_has_tags", (q) => q.eq("userId", userId).eq("hasTags", false))
        .collect();
      tasks = filterStaleClosedTasks(tasks);
    } else if (args.tagId) {
      let matchingTaskIds: Set<Id<"tasks">>;
      try {
        matchingTaskIds = await getTaskIdsForTagSubtree(ctx, userId, args.tagId);
      } catch {
        return [];
      }
      tasks = await loadTasksByIds(ctx, userId, matchingTaskIds);
      tasks = filterStaleClosedTasks(tasks);
    } else {
      tasks = [];
    }

    return await hydrateTasksWithScopedRelations(ctx, userId, tasks);
  },
});
