import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal, components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  corpusFor,
  dateSchema,
  digest,
  DIMENSIONS,
  MODEL,
  partition,
  validVector,
} from "./lib/journal";

const leaseMs = 10 * 60_000;
export const enroll = internalMutation({
  args: {
    userId: v.string(),
    expectedEmail: v.string(),
    baseId: v.string(),
    table: v.string(),
    tokenEnv: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"journalCorpora">> => {
    const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "_id", value: args.userId }],
    });
    if (!user || user.email !== args.expectedEmail || !user.emailVerified)
      throw new Error("Verified account does not match enrollment");
    if (
      !/^app\w+$/.test(args.baseId) ||
      !args.table.trim() ||
      !/^JOURNAL_AIRTABLE_TOKEN(?:_[A-Z0-9_]+)?$/.test(args.tokenEnv)
    )
      throw new Error("Invalid journal source configuration");
    const existing = await ctx.db
      .query("journalCorpora")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing) {
      if (
        existing.baseId !== args.baseId ||
        existing.table !== args.table ||
        existing.tokenEnv !== args.tokenEnv
      )
        throw new Error("Corpus source already bound");
      return existing._id;
    }
    const source = await ctx.db
      .query("journalCorpora")
      .withIndex("by_source", (q) =>
        q.eq("baseId", args.baseId).eq("table", args.table),
      )
      .first();
    if (source) throw new Error("Source already bound to another corpus");
    const profileId = await ctx.db.insert("journalEmbeddingProfiles", {
      userId: args.userId,
      provider: "convex-ai-gateway",
      model: MODEL,
      dimensions: DIMENSIONS,
      format: "whole-entry-v1;cosine",
      documentPrefix: "",
      queryPrefix: "",
      createdAt: Date.now(),
    });
    return ctx.db.insert("journalCorpora", {
      userId: args.userId,
      baseId: args.baseId,
      table: args.table,
      tokenEnv: args.tokenEnv,
      profileId,
      enabled: true,
      readable: false,
      revision: 0,
      documents: 0,
      embeddings: 0,
    });
  },
});
async function start(ctx: MutationCtx, userId: string) {
  const c = await corpusFor(ctx, userId, false);
  if (c.currentRun && (c.leaseUntil ?? 0) > Date.now())
    return { queued: false };
  if (c.lastRequestedAt && Date.now() - c.lastRequestedAt < 60_000)
    throw new Error("Sync recently requested; retry later");
  if (c.currentRun) {
    const old = await ctx.db.get(c.currentRun);
    if (old && old.status !== "complete" && old.status !== "failed")
      await ctx.db.patch(old._id, {
        status: "failed",
        error: "Lease expired",
        finishedAt: Date.now(),
      });
  }
  const id = await ctx.db.insert("journalSyncRuns", {
    userId,
    corpusId: c._id,
    mode: "airtable",
    status: "fetching",
    startedAt: Date.now(),
    seen: 0,
    embedded: 0,
    attempt: 0,
    batch: 0,
  });
  await ctx.db.patch(c._id, {
    currentRun: id,
    leaseUntil: Date.now() + leaseMs,
    lastRequestedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.journalSync.step, {
    runId: id,
    batch: 0,
  });
  return { queued: true };
}
export const requestSync = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }): Promise<{ queued: boolean }> =>
    start(ctx, userId),
});
export const dispatch = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }): Promise<void> => {
    const corpora = await ctx.db
      .query("journalCorpora")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .paginate({ numItems: 50, cursor: cursor ?? null });
    for (const c of corpora.page)
      if (!c.lastRequestedAt || Date.now() - c.lastRequestedAt >= 60_000)
        await start(ctx, c.userId);
    if (!corpora.isDone)
      await ctx.scheduler.runAfter(0, internal.journalImport.dispatch, {
        cursor: corpora.continueCursor,
      });
  },
});
async function current(
  ctx: Pick<QueryCtx, "db">,
  runId: Id<"journalSyncRuns">,
  batch: number,
) {
  const run = await ctx.db.get(runId);
  if (
    !run ||
    run.batch !== batch ||
    run.status === "complete" ||
    run.status === "failed"
  )
    throw new Error("Stale sync worker");
  const c = await ctx.db.get(run.corpusId);
  if (
    !c?.enabled ||
    c.userId !== run.userId ||
    c.currentRun !== runId ||
    (c.leaseUntil ?? 0) < Date.now()
  )
    throw new Error("Stale sync worker");
  return { run, corpus: c };
}
export const state = internalQuery({
  args: { runId: v.id("journalSyncRuns"), batch: v.number() },
  handler: async (ctx, args) => current(ctx, args.runId, args.batch),
});
async function next(
  ctx: MutationCtx,
  run: Doc<"journalSyncRuns">,
  corpus: Doc<"journalCorpora">,
) {
  await ctx.db.patch(run._id, { batch: run.batch + 1, attempt: 0 });
  await ctx.db.patch(corpus._id, { leaseUntil: Date.now() + leaseMs });
  await ctx.scheduler.runAfter(250, internal.journalSync.step, {
    runId: run._id,
    batch: run.batch + 1,
  });
}
async function removeVector(ctx: MutationCtx, id: Id<"journalEntries">) {
  const e = await ctx.db
    .query("journalEmbeddings")
    .withIndex("by_entry", (q) => q.eq("entryId", id))
    .unique();
  if (e) await ctx.db.delete(e._id);
  return e ? 1 : 0;
}
export const ingestPage = internalMutation({
  args: {
    runId: v.id("journalSyncRuns"),
    batch: v.number(),
    records: v.array(
      v.object({ recordId: v.string(), date: v.string(), text: v.string() }),
    ),
    offset: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { run, corpus: c } = await current(ctx, args.runId, args.batch);
    if (run.status !== "fetching" || args.records.length > 100)
      throw new Error("Invalid fetch phase");
    let documents = c.documents,
      embeddings = c.embeddings,
      changed = false;
    for (const record of args.records) {
      if (
        !/^rec\w+$/.test(record.recordId) ||
        new TextEncoder().encode(record.text).length > 100_000
      )
        throw new Error("Invalid source record");
      const active =
        Boolean(record.text.trim()) &&
        dateSchema.safeParse(record.date).success;
      const sourceKey = `${c.baseId}/${c.table}/${record.recordId}`;
      const hash = await digest(record.text);
      const old = await ctx.db
        .query("journalEntries")
        .withIndex("by_user_source", (q) =>
          q.eq("userId", c.userId).eq("sourceKey", sourceKey),
        )
        .unique();
      if (old && old.corpusId !== c._id)
        throw new Error("Source ownership mismatch");
      const value = {
        userId: c.userId,
        corpusId: c._id,
        sourceKey,
        recordId: record.recordId,
        date: record.date,
        text: record.text,
        contentHash: hash,
        url: `https://airtable.com/${c.baseId}/${record.recordId}`,
        active,
        lastSeenRun: run._id,
        missingSinceRun: undefined,
      };
      if (old) {
        if (
          old.active !== active ||
          old.contentHash !== hash ||
          old.date !== record.date
        ) {
          changed = true;
          documents += Number(active) - Number(old.active);
          if (!active || old.contentHash !== hash)
            embeddings -= await removeVector(ctx, old._id);
          else if (old.date !== record.date) {
            const e = await ctx.db
              .query("journalEmbeddings")
              .withIndex("by_entry", (q) => q.eq("entryId", old._id))
              .unique();
            if (e) await ctx.db.patch(e._id, { date: record.date });
          }
        }
        await ctx.db.patch(old._id, {
          ...value,
          updatedAt: Date.now(),
          embeddingError: undefined,
        });
      } else {
        await ctx.db.insert("journalEntries", {
          ...value,
          updatedAt: Date.now(),
        });
        documents += Number(active);
        changed = true;
      }
    }
    await ctx.db.patch(c._id, {
      documents,
      embeddings,
      revision: c.revision + Number(changed),
      ...(changed ? { lastFullIndex: undefined } : {}),
    });
    await ctx.db.patch(run._id, {
      seen: run.seen + args.records.length,
      offset: args.offset,
      ...(!args.offset
        ? {
            status: "reconciling" as const,
            cursor: undefined,
            fullFetchAt: Date.now(),
          }
        : {}),
    });
    if (!args.offset) await ctx.db.patch(c._id, { lastFullFetch: Date.now() });
    await next(ctx, run, c);
  },
});
export const reconcilePage = internalMutation({
  args: { runId: v.id("journalSyncRuns"), batch: v.number() },
  handler: async (ctx, args) => {
    const { run, corpus: c } = await current(ctx, args.runId, args.batch);
    if (run.status !== "reconciling")
      throw new Error("Invalid reconciliation phase");
    const page = await ctx.db
      .query("journalEntries")
      .withIndex("by_corpus", (q) => q.eq("corpusId", c._id))
      .paginate({ numItems: 100, cursor: run.cursor ?? null });
    let documents = c.documents,
      embeddings = c.embeddings,
      changed = false;
    for (const d of page.page) {
      if (d.userId !== c.userId) throw new Error("Source ownership mismatch");
      if (d.active && d.lastSeenRun !== run._id) {
        if (d.missingSinceRun && d.missingSinceRun !== run._id) {
          const previous = await ctx.db.get(d.missingSinceRun);
          // A second complete enumeration confirms a missing record; an incomplete
          // run never supplies the first observation used for deletion.
          if (previous?.fullFetchAt) {
            embeddings -= await removeVector(ctx, d._id);
            documents--;
            changed = true;
            await ctx.db.patch(d._id, {
              active: false,
              text: "",
              updatedAt: Date.now(),
            });
            continue;
          }
        }
        await ctx.db.patch(d._id, { missingSinceRun: run._id });
      }
    }
    await ctx.db.patch(c._id, {
      documents,
      embeddings,
      revision: c.revision + Number(changed),
    });
    await ctx.db.patch(run._id, {
      cursor: page.isDone ? undefined : page.continueCursor,
      ...(page.isDone ? { status: "embedding" as const } : {}),
    });
    await next(ctx, run, c);
  },
});
export const embeddingPage = internalQuery({
  args: { runId: v.id("journalSyncRuns"), batch: v.number() },
  handler: async (ctx, args) => {
    const { run, corpus: c } = await current(ctx, args.runId, args.batch);
    if (run.status !== "embedding") throw new Error("Invalid embedding phase");
    const page = await ctx.db
      .query("journalEntries")
      .withIndex("by_user_corpus_active_date", (q) =>
        q.eq("userId", c.userId).eq("corpusId", c._id).eq("active", true),
      )
      .paginate({ numItems: 32, cursor: run.cursor ?? null });
    const entries = [];
    for (const d of page.page) {
      const e = await ctx.db
        .query("journalEmbeddings")
        .withIndex("by_entry", (q) => q.eq("entryId", d._id))
        .unique();
      if (
        !e ||
        e.userId !== c.userId ||
        e.profileId !== c.profileId ||
        e.contentHash !== d.contentHash
      )
        entries.push({ id: d._id, hash: d.contentHash, text: d.text });
    }
    return { entries, cursor: page.isDone ? null : page.continueCursor };
  },
});
export const saveEmbeddingPage = internalMutation({
  args: {
    runId: v.id("journalSyncRuns"),
    batch: v.number(),
    items: v.array(
      v.object({
        id: v.id("journalEntries"),
        hash: v.string(),
        vector: v.array(v.number()),
      }),
    ),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const { run, corpus: c } = await current(ctx, args.runId, args.batch);
    if (run.status !== "embedding" || args.items.length > 32)
      throw new Error("Invalid embedding phase");
    let embeddings = c.embeddings,
      added = 0;
    for (const item of args.items) {
      const d = await ctx.db.get(item.id);
      if (
        !d ||
        d.userId !== c.userId ||
        d.corpusId !== c._id ||
        !d.active ||
        d.contentHash !== item.hash
      )
        throw new Error("Entry changed while embedding");
      if (!validVector(item.vector)) throw new Error("Invalid embedding");
      const old = await ctx.db
        .query("journalEmbeddings")
        .withIndex("by_entry", (q) => q.eq("entryId", d._id))
        .unique();
      if (old) {
        if (old.userId !== c.userId || old.corpusId !== c._id)
          throw new Error("Embedding ownership mismatch");
        await ctx.db.delete(old._id);
      } else embeddings++;
      await ctx.db.insert("journalEmbeddings", {
        userId: c.userId,
        corpusId: c._id,
        entryId: d._id,
        profileId: c.profileId,
        contentHash: d.contentHash,
        date: d.date,
        partition: partition(c),
        vector: item.vector,
        embeddedAt: Date.now(),
      });
      added++;
    }
    await ctx.db.patch(c._id, {
      embeddings,
      revision: c.revision + Number(added > 0),
    });
    await ctx.db.patch(run._id, {
      embedded: run.embedded + added,
      cursor: args.cursor ?? undefined,
    });
    if (args.cursor) {
      await next(ctx, run, c);
      return;
    }
    if (embeddings !== c.documents)
      throw new Error("Journal embedding coverage mismatch");
    await ctx.db.patch(c._id, {
      readable: true,
      lastFullIndex: Date.now(),
      leaseUntil: undefined,
      currentRun: undefined,
    });
    await ctx.db.patch(run._id, { status: "complete", finishedAt: Date.now() });
  },
});
export const failure = internalMutation({
  args: { runId: v.id("journalSyncRuns"), batch: v.number(), code: v.string() },
  handler: async (ctx, args) => {
    const { run, corpus: c } = await current(ctx, args.runId, args.batch);
    const attempt = run.attempt + 1;
    if (attempt >= 5) {
      await ctx.db.patch(run._id, {
        status: "failed",
        error: args.code.slice(0, 100),
        finishedAt: Date.now(),
        attempt,
      });
      await ctx.db.patch(c._id, {
        leaseUntil: undefined,
        currentRun: undefined,
      });
      return;
    }
    await ctx.db.patch(run._id, { attempt });
    await ctx.db.patch(c._id, { leaseUntil: Date.now() + leaseMs });
    await ctx.scheduler.runAfter(
      Math.min(60_000, 2000 * 2 ** attempt),
      internal.journalSync.step,
      { runId: run._id, batch: run.batch },
    );
  },
});
