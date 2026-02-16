import { v } from "convex/values";
import { mutation, query, MutationCtx } from "./_generated/server";
import { getAuthUserId } from "./auth";
import { Id } from "./_generated/dataModel";
import { EventAction } from "./schema";

/**
 * Insert an event into the events table. Call from within other mutations.
 */
export async function insertEvent(
  ctx: MutationCtx,
  args: {
    userId: string;
    entityId: string;
    action: EventAction;
    tagIds?: Id<"tags">[];
  }
) {
  await ctx.db.insert("events", {
    userId: args.userId,
    timestamp: Date.now(),
    entityId: args.entityId,
    action: args.action,
    tagIds: args.tagIds,
  });
}

export const listByTimeRange = query({
  args: {
    startTime: v.number(),
    endTime: v.number(),
    tagId: v.optional(v.id("tags")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    let events = await ctx.db
      .query("events")
      .withIndex("by_user_timestamp", (q) =>
        q.eq("userId", userId).gte("timestamp", args.startTime).lte("timestamp", args.endTime)
      )
      .collect();

    // Tag filtering in memory
    if (args.tagId) {
      const tag = await ctx.db.get(args.tagId);
      if (!tag || tag.userId !== userId) {
        return [];
      }

      const matchingTagIds = new Set<Id<"tags">>([args.tagId]);
      if (tag.childrenRecursive) {
        for (const childId of tag.childrenRecursive) {
          matchingTagIds.add(childId);
        }
      }

      events = events.filter(
        (event) =>
          event.tagIds && event.tagIds.some((tagId) => matchingTagIds.has(tagId))
      );
    }

    return events;
  },
});
