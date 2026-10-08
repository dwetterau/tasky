import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

// A transactional claim makes refresh rotation single-use across HTTP actions.
export const claimRefresh = internalMutation({
  args: { tokenHash: v.string(), expiresAt: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (args.expiresAt <= Date.now()) return false;
    const existing = await ctx.db
      .query("mcpRefreshClaims")
      .withIndex("by_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (existing) return false;
    await ctx.db.insert("mcpRefreshClaims", args);
    return true;
  },
});
export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("mcpRefreshClaims")
      .withIndex("by_expiry", (q) => q.lt("expiresAt", Date.now()))
      .take(500);
    for (const row of expired) await ctx.db.delete(row._id);
  },
});
