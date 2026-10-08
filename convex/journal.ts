import { v } from "convex/values";
import {
  internalQuery,
  internalMutation,
  type QueryCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  settingsFor,
  present,
  listSchema,
  textSchema,
  getSchema,
  matches,
  cursorBinding,
  encodeCursor,
  decodeCursor,
  cosine,
  validVector,
} from "./lib/journal";

function dateQuery(
  ctx: QueryCtx,
  c: Doc<"journalSettings">,
  from?: string,
  to?: string,
) {
  return ctx.db
    .query("journalEntries")
    .withIndex("by_user_active_date", (q) => {
      const base = q.eq("userId", c.userId).eq("active", true);
      if (from && to) return base.gte("date", from).lte("date", to);
      if (from) return base.gte("date", from);
      if (to) return base.lte("date", to);
      return base;
    });
}
export const status = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const c = await settingsFor(ctx, userId, false);
    const p = await ctx.db.get(c.profileId);
    if (!p || p.userId !== userId) throw new Error("Invalid journal profile");
    const first = await dateQuery(ctx, c).first(),
      last = await dateQuery(ctx, c).order("desc").first();
    const runs = await ctx.db
      .query("journalSyncRuns")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(5);
    return {
      documents: c.documents,
      pending_embeddings: c.documents - c.embeddings,
      readable: c.readable,
      first_date: first?.date ?? null,
      last_date: last?.date ?? null,
      last_full_fetch: c.lastFullFetch ?? null,
      last_full_index: c.lastFullIndex ?? null,
      embedding_profile: {
        provider: p.provider,
        model: p.model,
        dimensions: p.dimensions,
        format: p.format,
      },
      recent_syncs: runs.map((r) => ({
        status: r.status,
        mode: r.mode,
        seen: r.seen,
        embedded: r.embedded,
        started_at: r.startedAt,
        finished_at: r.finishedAt,
        error: r.error,
      })),
    };
  },
});
export const get = internalQuery({
  args: { userId: v.string(), input: v.any() },
  handler: async (ctx, { userId, input }) => {
    const c = await settingsFor(ctx, userId),
      args = getSchema.parse(input);
    const documents = new Map<string, ReturnType<typeof present>>();
    const missing_ids: string[] = [],
      missing_dates: string[] = [];
    for (const id of args.ids) {
      const d = await ctx.db
        .query("journalEntries")
        .withIndex("by_user_source", (q) =>
          q.eq("userId", userId).eq("sourceKey", id),
        )
        .unique();
      if (!d || !d.active) missing_ids.push(id);
      else documents.set(d.sourceKey, present(d));
    }
    for (const date of args.dates) {
      const rows = await dateQuery(ctx, c, date, date).take(101);
      if (rows.length > 100)
        throw new Error("Too many entries on one date; use list_entries");
      if (!rows.length) missing_dates.push(date);
      for (const d of rows) documents.set(d.sourceKey, present(d));
    }
    const result = {
      documents: [...documents.values()].sort(
        (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
      ),
      missing_ids,
      missing_dates,
    };
    if (new TextEncoder().encode(JSON.stringify(result)).length > 1_000_000)
      throw new Error("Batch too large; request fewer dates/IDs");
    return result;
  },
});
export const list = internalQuery({
  args: { userId: v.string(), input: v.any() },
  handler: async (ctx, { userId, input }) => {
    const c = await settingsFor(ctx, userId),
      args = listSchema.parse(input);
    const signature = await cursorBinding(
      userId,
      ["list", args.date_from, args.date_to],
      c.revision,
    );
    const page = await dateQuery(ctx, c, args.date_from, args.date_to).paginate(
      { numItems: args.limit, cursor: decodeCursor(args.cursor, signature) },
    );
    return {
      documents: page.page.map((d) => present(d)),
      next_cursor: page.isDone
        ? null
        : encodeCursor(signature, page.continueCursor),
      journal_documents: c.documents,
    };
  },
});
export const text = internalQuery({
  args: { userId: v.string(), input: v.any() },
  handler: async (ctx, { userId, input }) => {
    const c = await settingsFor(ctx, userId),
      args = textSchema.parse(input);
    const signature = await cursorBinding(
      userId,
      ["text", args.query, args.mode, args.date_from, args.date_to],
      c.revision,
    );
    // Cursor follows examined rows, not only matches. An empty page may have a continuation.
    const page = await dateQuery(ctx, c, args.date_from, args.date_to).paginate(
      { numItems: args.limit, cursor: decodeCursor(args.cursor, signature) },
    );
    return {
      results: page.page
        .filter((d) => matches(d.text, args.query, args.mode))
        .map((d) => ({ document: present(d, true) })),
      mode: args.mode,
      scanned: page.page.length,
      next_cursor: page.isDone
        ? null
        : encodeCursor(signature, page.continueCursor),
    };
  },
});
export const searchContext = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const c = await settingsFor(ctx, userId),
      profile = await ctx.db.get(c.profileId);
    if (!profile || profile.userId !== userId)
      throw new Error("Invalid journal profile");
    return { settings: c, profile };
  },
});
export const lexical = internalQuery({
  args: {
    userId: v.string(),
    query: v.string(),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await settingsFor(ctx, args.userId);
    let q = ctx.db
      .query("journalEntries")
      .withSearchIndex("search_text_user", (q) =>
        q
          .search("text", args.query)
          .eq("userId", args.userId)
          .eq("active", true),
      );
    if (args.from) q = q.filter((q) => q.gte(q.field("date"), args.from!));
    if (args.to) q = q.filter((q) => q.lte(q.field("date"), args.to!));
    return (await q.take(100)).map((d) => ({
      entryId: d._id,
      hash: d.contentHash,
    }));
  },
});
export const scorePage = internalQuery({
  args: {
    userId: v.string(),
    vector: v.array(v.number()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    cursor: v.union(v.string(), v.null()),
    revision: v.number(),
  },
  handler: async (ctx, args) => {
    if (!validVector(args.vector)) throw new Error("Invalid query embedding");
    const c = await settingsFor(ctx, args.userId);
    if (c.revision !== args.revision)
      throw new Error("Journal changed during search; retry");
    const page = await ctx.db
      .query("journalEmbeddings")
      .withIndex("by_user_date", (q) => {
        const base = q.eq("userId", args.userId);
        if (args.from && args.to)
          return base.gte("date", args.from).lte("date", args.to);
        if (args.from) return base.gte("date", args.from);
        if (args.to) return base.lte("date", args.to);
        return base;
      })
      .paginate({ numItems: 100, cursor: args.cursor });
    return {
      hits: page.page
        .filter((e) => e.userId === args.userId && e.profileId === c.profileId)
        .map((e) => ({
          entryId: e.entryId,
          hash: e.contentHash,
          score: cosine(args.vector, e.vector),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 100),
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});
export const vectorHits = internalQuery({
  args: {
    userId: v.string(),
    ids: v.array(v.id("journalEmbeddings")),
    revision: v.number(),
  },
  handler: async (ctx, { userId, ids, revision }) => {
    const c = await settingsFor(ctx, userId);
    if (c.revision !== revision)
      throw new Error("Journal changed during search; retry");
    const rows = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return rows.map((e) =>
      e && e.userId === userId && e.profileId === c.profileId
        ? { entryId: e.entryId, hash: e.contentHash }
        : null,
    );
  },
});
export const hydrate = internalQuery({
  args: {
    userId: v.string(),
    hits: v.array(
      v.object({
        entryId: v.id("journalEntries"),
        hash: v.string(),
        score: v.number(),
      }),
    ),
    revision: v.number(),
  },
  handler: async (ctx, { userId, hits, revision }) => {
    const c = await settingsFor(ctx, userId);
    if (c.revision !== revision)
      throw new Error("Journal changed during search; retry");
    const out = [];
    for (const hit of hits) {
      const d = await ctx.db.get(hit.entryId);
      if (d && d.userId === userId && d.active && d.contentHash === hit.hash)
        out.push({ document: present(d, true), score: hit.score });
    }
    return out;
  },
});
export const claimSearch = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const c = await settingsFor(ctx, userId);
    const fresh = !c.searchWindow || Date.now() - c.searchWindow >= 60_000;
    if (!fresh && (c.searchCount ?? 0) >= 30)
      throw new Error("Journal search rate limit; retry later");
    await ctx.db.patch(c._id, {
      searchWindow: fresh ? Date.now() : c.searchWindow,
      searchCount: fresh ? 1 : (c.searchCount ?? 0) + 1,
    });
  },
});
