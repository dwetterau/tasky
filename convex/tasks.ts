import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "./auth";
import { Id } from "./_generated/dataModel";
import { taskStatus, taskPriority } from "./schema";

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

    // Fetch tags for each task
    const tasksWithTags = await Promise.all(
      tasks.map(async (task) => {
        const tags = await Promise.all(
          task.tagIds.map((tagId) => ctx.db.get(tagId))
        );
        return {
          ...task,
          tags: tags.filter((t) => t !== null),
        };
      })
    );

    return tasksWithTags;
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
    return await ctx.db.insert("tasks", {
      userId,
      content: args.content,
      tagIds: args.tagIds ?? [],
      status,
      priority: args.priority ?? "triage",
      dueDate: args.dueDate,
      createdFromCaptureId: args.createdFromCaptureId,
      statusUpdatedAt: now,
      completedAt: status === "done" ? now : undefined,
    });
  },
});

export const createFromCapture = mutation({
  args: {
    captureId: v.id("captures"),
    tagIds: v.optional(v.array(v.id("tags"))),
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
      priority: "triage",
      createdFromCaptureId: args.captureId,
      statusUpdatedAt: now,
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
      if (args.status === "done" && task.status !== "done") {
        updates.completedAt = now;
      } else if (args.status !== "done" && task.status === "done") {
        // Clear completedAt if moving out of done status
        updates.completedAt = undefined;
      }
    }
    if (args.priority !== undefined) updates.priority = args.priority;
    if (args.dueDate !== undefined) updates.dueDate = args.dueDate ?? undefined;

    await ctx.db.patch(args.id, updates);
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
    if (args.status === "done" && task.status !== "done") {
      updates.completedAt = now;
    } else if (args.status !== "done" && task.status === "done") {
      updates.completedAt = undefined;
    }

    await ctx.db.patch(args.id, updates);
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
    await ctx.db.delete(args.id);
  },
});

// Search tasks by full-text search and/or tag filtering (with recursive child tags)
export const search = query({
  args: {
    searchText: v.optional(v.string()),
    tagId: v.optional(v.id("tags")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    // If no search criteria, return empty (use list() for all tasks)
    if (!args.searchText && !args.tagId) {
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

    // If tag filtering is requested, filter by tag and all its recursive children
    if (args.tagId) {
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

    // Fetch tags for each task
    const tasksWithTags = await Promise.all(
      tasks.map(async (task) => {
        const tags = await Promise.all(
          task.tagIds.map((tagId) => ctx.db.get(tagId))
        );
        return {
          ...task,
          tags: tags.filter((t) => t !== null),
        };
      })
    );

    return tasksWithTags;
  },
});
