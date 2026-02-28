import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "./auth";
import { insertEvent } from "./events";

export const list = query({
  args: {
    includeCompleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    // If includeCompleted is true, get all captures; otherwise filter to only incomplete
    const includeCompleted = args.includeCompleted ?? false;

    let query;
    if (includeCompleted) {
      // Get all captures for user
      query = ctx.db
        .query("captures")
        .withIndex("by_user", (q) => q.eq("userId", userId));
    } else {
      // Get only incomplete captures
      query = ctx.db
        .query("captures")
        .withIndex("by_user_completed", (q) =>
          q.eq("userId", userId).eq("completed", false)
        );
    }

    // Sort by creation time descending (newest first) and limit to 50
    const captures = await query.order("desc").take(50);
    return captures;
  },
});

export const listOpenForDashboard = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    // Dashboard capture age needs the full open set, not a paginated slice.
    return await ctx.db
      .query("captures")
      .withIndex("by_user_completed", (q) =>
        q.eq("userId", userId).eq("completed", false)
      )
      .collect();
  },
});

export const create = mutation({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const captureId = await ctx.db.insert("captures", {
      userId,
      text: args.text,
      completed: false,
    });
    await insertEvent(ctx, {
      userId,
      entityId: captureId,
      action: { type: "capture.created" },
    });
    return captureId;
  },
});

export const toggle = mutation({
  args: { id: v.id("captures") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const capture = await ctx.db.get(args.id);
    if (!capture || capture.userId !== userId) {
      throw new Error("Capture not found or access denied");
    }
    const newCompleted = !capture.completed;
    await ctx.db.patch(args.id, {
      completed: newCompleted,
      statusUpdatedAt: Date.now(),
    });
    await insertEvent(ctx, {
      userId,
      entityId: args.id,
      action: { type: newCompleted ? "capture.completed" : "capture.uncompleted" },
    });
  },
});

export const remove = mutation({
  args: { id: v.id("captures") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const capture = await ctx.db.get(args.id);
    if (!capture || capture.userId !== userId) {
      throw new Error("Capture not found or access denied");
    }
    await insertEvent(ctx, {
      userId,
      entityId: args.id,
      action: { type: "capture.deleted" },
    });
    await ctx.db.delete(args.id);
  },
});

export const update = mutation({
  args: { id: v.id("captures"), text: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const capture = await ctx.db.get(args.id);
    if (!capture || capture.userId !== userId) {
      throw new Error("Capture not found or access denied");
    }
    await ctx.db.patch(args.id, { text: args.text });
    await insertEvent(ctx, {
      userId,
      entityId: args.id,
      action: { type: "capture.edited" },
    });
  },
});
