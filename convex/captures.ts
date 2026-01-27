import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "./auth";

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

export const create = mutation({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    return await ctx.db.insert("captures", {
      userId,
      text: args.text,
      completed: false,
    });
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
    await ctx.db.patch(args.id, {
      completed: !capture.completed,
      statusUpdatedAt: Date.now(),
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
    await ctx.db.delete(args.id);
  },
});
