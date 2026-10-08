import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { searchSchema } from "./lib/journal";
import { embedTexts } from "./journalEmbeddings";

type Hit = { entryId: Id<"journalEntries">; hash: string; score: number };
export const search = internalAction({
  args: { userId: v.string(), input: v.any() },
  handler: async (ctx, { userId, input }): Promise<unknown> => {
    const args = searchSchema.parse(input);
    const { corpus, partition } = await ctx.runQuery(
      internal.journal.searchContext,
      { userId },
    );
    await ctx.runMutation(internal.journal.claimSearch, { userId });
    let semantic: Hit[] = [],
      warning: string | undefined;
    let vector: number[] | undefined;
    try {
      [vector] = await embedTexts([args.query]);
    } catch {
      if (args.mode === "semantic")
        throw new Error(
          "Semantic search is unavailable; use text/date retrieval",
        );
      warning = "Semantic retrieval unavailable; lexical results only";
    }
    if (vector) {
      if (args.date_from || args.date_to) {
        let cursor: string | null = null,
          pages = 0;
        do {
          const page: { hits: Hit[]; cursor: string | null } =
            await ctx.runQuery(internal.journal.scorePage, {
              userId,
              vector,
              from: args.date_from,
              to: args.date_to,
              cursor,
              revision: corpus.revision,
            });
          semantic.push(...page.hits);
          semantic.sort((a, b) => b.score - a.score);
          semantic = semantic.slice(0, 100);
          cursor = page.cursor;
          if (++pages >= 100 && cursor)
            throw new Error(
              "Date range exceeds search work limit; narrow the dates",
            );
        } while (cursor);
      } else {
        const found = await ctx.vectorSearch("journalEmbeddings", "by_vector", {
          vector,
          limit: 100,
          filter: (q) => q.eq("partition", partition),
        });
        const rows = await ctx.runQuery(internal.journal.vectorHits, {
          userId,
          ids: found.map((r) => r._id),
          revision: corpus.revision,
        });
        semantic = rows.flatMap((row, i) =>
          row ? [{ ...row, score: found[i]._score }] : [],
        );
      }
    }
    let hits = semantic;
    if (args.mode === "hybrid") {
      const lexical = await ctx.runQuery(internal.journal.lexical, {
        userId,
        query: args.query,
        from: args.date_from,
        to: args.date_to,
      });
      const combined = new Map<string, Hit>();
      for (const list of [semantic, lexical])
        list.forEach((hit, index) => {
          const prior = combined.get(hit.entryId);
          combined.set(hit.entryId, {
            ...hit,
            score: (prior?.score ?? 0) + 1 / (60 + index + 1),
          });
        });
      hits = [...combined.values()].sort(
        (a, b) => b.score - a.score || a.entryId.localeCompare(b.entryId),
      );
    }
    const results = await ctx.runQuery(internal.journal.hydrate, {
      userId,
      hits: hits.slice(0, args.limit),
      revision: corpus.revision,
    });
    return {
      results,
      mode: warning ? "lexical" : args.mode,
      ...(warning ? { warning } : {}),
      status: await ctx.runQuery(internal.journal.status, { userId }),
    };
  },
});
