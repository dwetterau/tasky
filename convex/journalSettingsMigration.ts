// Temporary, operator-only bridge. Remove after production cutover.
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const begin = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const legacy = await ctx.db
      .query("journalCorpora")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!legacy) throw new Error("No legacy journal settings");
    if (legacy.currentRun) throw new Error("Wait for the active journal sync");
    const profile = await ctx.db.get(legacy.profileId);
    if (!profile || profile.userId !== userId)
      throw new Error("Profile owner mismatch");
    const existing = await ctx.db
      .query("journalSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      if (
        legacy.enabled ||
        existing.baseId !== legacy.baseId ||
        existing.table !== legacy.table ||
        existing.profileId !== legacy.profileId
      )
        throw new Error("Conflicting journal settings");
      return existing._id;
    }
    const { _id, _creationTime, ...fields } = legacy;
    const id = await ctx.db.insert("journalSettings", {
      ...fields,
      revision: legacy.revision + 1,
    });
    await ctx.db.patch(_id, { enabled: false });
    return { id, originalCreatedAt: _creationTime };
  },
});

export const page = internalMutation({
  args: {
    userId: v.string(),
    table: v.union(
      v.literal("journalEntries"),
      v.literal("journalEmbeddings"),
      v.literal("journalSyncRuns"),
    ),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { userId, table, cursor }) => {
    const legacy = await ctx.db
      .query("journalCorpora")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const settings = await ctx.db
      .query("journalSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (
      !legacy ||
      legacy.enabled ||
      !settings ||
      settings.profileId !== legacy.profileId
    )
      throw new Error("Begin migration first");
    // Full table pagination remains stable while obsolete index fields are removed.
    const batch = await ctx.db.query(table).paginate({ numItems: 100, cursor });
    let changed = 0;
    for (const row of batch.page) {
      if (row.userId !== userId) continue;
      if (row.corpusId !== undefined && row.corpusId !== legacy._id)
        throw new Error("Legacy journal owner mismatch");
      if (
        row.corpusId !== undefined ||
        ("partition" in row && row.partition !== undefined)
      ) {
        await ctx.db.patch(row._id, {
          corpusId: undefined,
          ...(table === "journalEmbeddings" ? { partition: undefined } : {}),
        });
        changed++;
      }
    }
    return { changed, cursor: batch.isDone ? null : batch.continueCursor };
  },
});

export const finish = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const legacy = await ctx.db
      .query("journalCorpora")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!legacy) return;
    const settings = await ctx.db
      .query("journalSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (
      legacy.enabled ||
      !settings ||
      settings.profileId !== legacy.profileId ||
      settings.baseId !== legacy.baseId ||
      settings.table !== legacy.table
    )
      throw new Error("Settings migration incomplete");
    for (const table of [
      "journalEntries",
      "journalEmbeddings",
      "journalSyncRuns",
    ] as const) {
      if (
        await ctx.db
          .query(table)
          .withIndex("by_corpus", (q) => q.eq("corpusId", legacy._id))
          .first()
      )
        throw new Error("Legacy references remain");
    }
    await ctx.db.delete(legacy._id);
  },
});
