import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "./auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }
    return await ctx.db
      .query("captures")
      .withIndex("by_user", (q) => q.eq("userId", userId))
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
    await ctx.db.patch(args.id, { completed: !capture.completed });
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
