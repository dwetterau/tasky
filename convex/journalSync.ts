import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { embedTexts } from "./journalEmbeddings";

export const step = internalAction({
  args: { runId: v.id("journalSyncRuns"), batch: v.number() },
  handler: async (ctx, args): Promise<void> => {
    let state;
    try {
      state = await ctx.runQuery(internal.journalImport.state, args);
    } catch {
      return;
    }
    const { run, corpus } = state;
    try {
      if (run.status === "fetching") {
        const token = process.env[corpus.tokenEnv];
        if (!token) throw new Error("Source credential is unavailable");
        const url = new URL(
          `https://api.airtable.com/v0/${encodeURIComponent(corpus.baseId)}/${encodeURIComponent(corpus.table)}`,
        );
        url.searchParams.set("pageSize", "100");
        url.searchParams.append("fields[]", "Date");
        url.searchParams.append("fields[]", "Entry");
        if (run.offset) url.searchParams.set("offset", run.offset);
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(45_000),
          redirect: "error",
        });
        if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
        const payload = (await response.json()) as {
          records?: Array<{ id: string; fields: Record<string, unknown> }>;
          offset?: string;
        };
        if (
          !Array.isArray(payload.records) ||
          payload.records.length > 100 ||
          (payload.offset !== undefined && typeof payload.offset !== "string")
        )
          throw new Error("Invalid source response");
        const records = payload.records.map((r) => {
          if (
            typeof r.id !== "string" ||
            !r.fields ||
            (r.fields.Entry !== undefined &&
              typeof r.fields.Entry !== "string") ||
            (r.fields.Date !== undefined && typeof r.fields.Date !== "string")
          )
            throw new Error("Invalid source record");
          return {
            recordId: r.id,
            date: (r.fields.Date as string | undefined) ?? "",
            text: (r.fields.Entry as string | undefined) ?? "",
          };
        });
        await ctx.runMutation(internal.journalImport.ingestPage, {
          ...args,
          records,
          offset: payload.offset,
        });
      } else if (run.status === "reconciling") {
        await ctx.runMutation(internal.journalImport.reconcilePage, args);
      } else if (run.status === "embedding") {
        const page = await ctx.runQuery(
          internal.journalImport.embeddingPage,
          args,
        );
        const vectors = page.entries.length
          ? await embedTexts(page.entries.map((e) => e.text))
          : [];
        await ctx.runMutation(internal.journalImport.saveEmbeddingPage, {
          ...args,
          items: page.entries.map((e, i) => ({
            id: e.id,
            hash: e.hash,
            vector: vectors[i],
          })),
          cursor: page.cursor,
        });
      }
    } catch {
      // Never persist a provider response, journal input or request URL in logs.
      await ctx
        .runMutation(internal.journalImport.failure, {
          ...args,
          code: `${run.status}_failed`,
        })
        .catch(() => undefined);
    }
  },
});
