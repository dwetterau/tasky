import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { syncPortfolioForUser } from "./portfolio";

const DAILY_DISPATCH_USER_ID = "__daily_portfolio_sync_dispatch__";
const DAILY_DISPATCH_LEASE_MS = 23 * 60 * 60_000;
const MAX_RETRY_ATTEMPTS = 2;

export function retryDelayMs(attempt: number): number {
  return attempt <= 0 ? 60_000 : 5 * 60_000;
}

/**
 * Starts one sequential daily run. The global lease prevents a second cron
 * from creating another queue while the current queue is still active.
 */
export const dispatchDaily = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const startedAt = Date.now();
    const state = await ctx.db
      .query("portfolioSyncStates")
      .withIndex("by_user", (q) => q.eq("userId", DAILY_DISPATCH_USER_ID))
      .unique();
    if (
      state?.syncStartedAt !== undefined &&
      startedAt - state.syncStartedAt < DAILY_DISPATCH_LEASE_MS
    ) {
      return null;
    }

    const runId = crypto.randomUUID();
    if (state) {
      await ctx.db.patch(state._id, {
        syncLeaseId: runId,
        syncStartedAt: startedAt,
      });
    } else {
      await ctx.db.insert("portfolioSyncStates", {
        userId: DAILY_DISPATCH_USER_ID,
        lastSyncedAt: 0,
        syncLeaseId: runId,
        syncStartedAt: startedAt,
      });
    }
    await ctx.scheduler.runAfter(0, internal.portfolioSync.scheduleNext, {
      runId,
    });
    return null;
  },
});

/**
 * Finds the next distinct portfolio owner after the previous user. Since the
 * by_user index is ordered by userId, this skips all additional portfolios for
 * that user without loading them.
 */
export const scheduleNext = internalMutation({
  args: {
    runId: v.string(),
    afterUserId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { runId, afterUserId }) => {
    const state = await ctx.db
      .query("portfolioSyncStates")
      .withIndex("by_user", (q) => q.eq("userId", DAILY_DISPATCH_USER_ID))
      .unique();
    if (state?.syncLeaseId !== runId) {
      return null;
    }

    const next =
      afterUserId === undefined
        ? await ctx.db
            .query("portfolios")
            .withIndex("by_user")
            .order("asc")
            .first()
        : await ctx.db
            .query("portfolios")
            .withIndex("by_user", (q) => q.gt("userId", afterUserId))
            .order("asc")
            .first();

    if (!next) {
      await ctx.db.patch(state._id, {
        lastSyncedAt: Date.now(),
        syncLeaseId: undefined,
        syncStartedAt: undefined,
      });
      return null;
    }

    await ctx.scheduler.runAfter(0, internal.portfolioSync.runDailyForUser, {
      runId,
      userId: next.userId,
      attempt: 0,
    });
    return null;
  },
});

async function scheduleRetry(
  ctx: Parameters<typeof syncPortfolioForUser>[0],
  args: { runId: string; userId: string; attempt: number },
) {
  await ctx.scheduler.runAfter(
    retryDelayMs(args.attempt),
    internal.portfolioSync.runDailyForUser,
    {
      runId: args.runId,
      userId: args.userId,
      attempt: args.attempt + 1,
    },
  );
}

async function scheduleFollowingUser(
  ctx: Parameters<typeof syncPortfolioForUser>[0],
  runId: string,
  userId: string,
) {
  await ctx.runMutation(internal.portfolioSync.scheduleNext, {
    runId,
    afterUserId: userId,
  });
}

export const runDailyForUser = internalAction({
  args: {
    runId: v.string(),
    userId: v.string(),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const result = await syncPortfolioForUser(ctx, args.userId);
      if (
        !result.success &&
        result.message === "A portfolio sync is already running." &&
        args.attempt < MAX_RETRY_ATTEMPTS
      ) {
        await scheduleRetry(ctx, args);
        return null;
      }
      if (!result.success) {
        console.warn(
          JSON.stringify({
            event: "daily_portfolio_sync_unsuccessful",
            userId: args.userId,
            message: result.message,
          }),
        );
      }
    } catch (error) {
      if (args.attempt < MAX_RETRY_ATTEMPTS) {
        await scheduleRetry(ctx, args);
        return null;
      }
      console.error(
        JSON.stringify({
          event: "daily_portfolio_sync_failed",
          userId: args.userId,
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    }

    await scheduleFollowingUser(ctx, args.runId, args.userId);
    return null;
  },
});
