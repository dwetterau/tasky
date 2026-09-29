import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent, getAuthUserId } from "./auth";
import { resolveUserTimezone } from "./lib/recurrenceData";
import { validateTimezone } from "./lib/recurrence";

export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    return user ?? null;
  },
});

export const getTimezone = query({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    return userId ? await resolveUserTimezone(ctx, userId) : null;
  },
});

export const updateTimezone = mutation({
  args: { timezone: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    validateTimezone(args.timezone);
    const existing = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const updatedAt = Date.now();
    if (existing) {
      if (existing.timezone === args.timezone) {
        const enrollment = await ctx.db
          .query("homepageEnrollments")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .unique();
        if (enrollment && enrollment.timezone !== args.timezone) {
          await ctx.db.patch("homepageEnrollments", enrollment._id, {
            timezone: args.timezone,
          });
        }
        return null;
      }
      await ctx.db.patch("userSettings", existing._id, {
        timezone: args.timezone,
        updatedAt,
      });
    } else {
      await ctx.db.insert("userSettings", {
        userId,
        timezone: args.timezone,
        updatedAt,
      });
    }
    const enrollment = await ctx.db
      .query("homepageEnrollments")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (enrollment && enrollment.timezone !== args.timezone) {
      await ctx.db.patch("homepageEnrollments", enrollment._id, {
        timezone: args.timezone,
      });
    }
    return null;
  },
});
