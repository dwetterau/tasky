import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "./auth";
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
