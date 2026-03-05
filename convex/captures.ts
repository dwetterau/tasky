import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
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

export const listForMcp = internalQuery({
  args: {
    userId: v.string(),
    includeCompleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const includeCompleted = args.includeCompleted ?? false;
    const captures = includeCompleted
      ? await ctx.db
          .query("captures")
          .withIndex("by_user", (q) => q.eq("userId", args.userId))
          .order("desc")
          .collect()
      : await ctx.db
          .query("captures")
          .withIndex("by_user_completed", (q) =>
            q.eq("userId", args.userId).eq("completed", false)
          )
          .order("desc")
          .collect();

    return captures.map((capture) => ({
      _id: capture._id,
      _creationTime: capture._creationTime,
      text: capture.text,
    }));
  },
});

export const updateFromMcp = internalMutation({
  args: {
    userId: v.string(),
    ids: v.array(v.id("captures")),
    status: v.union(v.literal("done"), v.literal("deleted")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const results: Array<{
      id: (typeof args.ids)[number];
      result: "done" | "deleted" | "already_done" | "not_found";
    }> = [];
    let updatedCount = 0;

    for (const id of args.ids) {
      const capture = await ctx.db.get(id);
      if (!capture || capture.userId !== args.userId) {
        results.push({ id, result: "not_found" });
        continue;
      }

      if (args.status === "done") {
        if (capture.completed) {
          results.push({ id, result: "already_done" });
          continue;
        }
        await ctx.db.patch(id, {
          completed: true,
          statusUpdatedAt: now,
        });
        await insertEvent(ctx, {
          userId: args.userId,
          entityId: id,
          action: { type: "capture.completed" },
          source: "MCP",
        });
        updatedCount += 1;
        results.push({ id, result: "done" });
        continue;
      }

      await insertEvent(ctx, {
        userId: args.userId,
        entityId: id,
        action: { type: "capture.deleted" },
        source: "MCP",
      });
      await ctx.db.delete(id);
      updatedCount += 1;
      results.push({ id, result: "deleted" });
    }

    return {
      status: args.status,
      updatedCount,
      results,
    };
  },
});

export const createFromMcp = internalMutation({
  args: {
    userId: v.string(),
    texts: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const created: Array<{ id: string; text: string }> = [];

    for (let index = 0; index < args.texts.length; index += 1) {
      const trimmedText = args.texts[index]?.trim();
      if (!trimmedText) {
        throw new Error(`texts[${index}] must be a non-empty string`);
      }

      const captureId = await ctx.db.insert("captures", {
        userId: args.userId,
        text: trimmedText,
        completed: false,
      });
      await insertEvent(ctx, {
        userId: args.userId,
        entityId: captureId,
        action: { type: "capture.created" },
        source: "MCP",
      });
      created.push({ id: captureId, text: trimmedText });
    }

    return {
      createdCount: created.length,
      captures: created,
    };
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
