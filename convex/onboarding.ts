import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "./auth";

export const getState = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        hasCompletedOnboarding: false,
        completedAt: null,
      };
    }

    const state = await ctx.db
      .query("onboardingStates")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    return {
      hasCompletedOnboarding: !!state,
      completedAt: state?.completedAt ?? null,
    };
  },
});

export const complete = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("onboardingStates")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastViewedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("onboardingStates", {
      userId,
      completedAt: now,
      lastViewedAt: now,
    });
  },
});

