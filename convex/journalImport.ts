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
  settingsFor,
  dateSchema,
  digest,
  DIMENSIONS,
  MODEL,
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
  handler: async (ctx, args): Promise<Id<"journalSettings">> => {
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
      .query("journalSettings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing) {
      if (
        existing.baseId !== args.baseId ||
        existing.table !== args.table ||
        existing.tokenEnv !== args.tokenEnv
      )
        throw new Error("Journal source already bound");
      return existing._id;
    }
    const source = await ctx.db
      .query("journalSettings")
      .withIndex("by_source", (q) =>
        q.eq("baseId", args.baseId).eq("table", args.table),
      )
      .first();
    if (source) throw new Error("Source already bound to another user");
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
    return ctx.db.insert("journalSettings", {
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
  const c = await settingsFor(ctx, userId, false);
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
    const settingsPage = await ctx.db
      .query("journalSettings")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .paginate({ numItems: 50, cursor: cursor ?? null });
    for (const c of settingsPage.page)
      if (!c.lastRequestedAt || Date.now() - c.lastRequestedAt >= 60_000)
        await start(ctx, c.userId);
    if (!settingsPage.isDone)
      await ctx.scheduler.runAfter(0, internal.journalImport.dispatch, {
        cursor: settingsPage.continueCursor,
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
  const c = await settingsFor(ctx, run.userId, false);
  if (
    !c?.enabled ||
    c.userId !== run.userId ||
    c.currentRun !== runId ||
    (c.leaseUntil ?? 0) < Date.now()
  )
    throw new Error("Stale sync worker");
  return { run, settings: c };
}
export const state = internalQuery({
  args: { runId: v.id("journalSyncRuns"), batch: v.number() },
  handler: async (ctx, args) => current(ctx, args.runId, args.batch),
});
async function next(
  ctx: MutationCtx,
  run: Doc<"journalSyncRuns">,
  settings: Doc<"journalSettings">,
) {
  await ctx.db.patch(run._id, { batch: run.batch + 1, attempt: 0 });
  await ctx.db.patch(settings._id, { leaseUntil: Date.now() + leaseMs });
  await ctx.scheduler.runAfter(250, internal.journalSync.step, {
    runId: run._id,
    batch: run.batch + 1,
  });
}

export const beginSourceFetch = internalMutation({
  args: {
    runId: v.id("journalSyncRuns"),
    batch: v.number(),
    sourceVersion: v.string(),
    sourceModifiedAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { run, settings } = await current(ctx, args.runId, args.batch);
    if (run.status !== "fetching" || run.sourceVersion !== undefined)
      throw new Error("Invalid source check phase");
    await ctx.db.patch(run._id, {
      sourceVersion: args.sourceVersion,
      sourceModifiedAt: args.sourceModifiedAt,
    });
    await ctx.db.patch(settings._id, { lastSourceCheck: Date.now() });
    await next(ctx, run, settings);
  },
});

export const completeUnchanged = internalMutation({
  args: {
    runId: v.id("journalSyncRuns"),
    batch: v.number(),
    sourceVersion: v.string(),
    sourceModifiedAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { run, settings } = await current(ctx, args.runId, args.batch);
    const canInitializeCheckpoint =
      settings.lastSourceVersion === undefined &&
      settings.lastFullFetch !== undefined &&
      settings.documents === settings.embeddings &&
      (args.sourceModifiedAt === undefined ||
        Date.parse(args.sourceModifiedAt) <= settings.lastFullFetch);
    if (
      run.status !== "fetching" ||
      run.sourceVersion !== undefined ||
      (settings.lastSourceVersion !== args.sourceVersion &&
        !canInitializeCheckpoint)
    )
      throw new Error("Invalid unchanged source");
    const now = Date.now();
    await ctx.db.patch(settings._id, {
      currentRun: undefined,
      leaseUntil: undefined,
      lastSourceCheck: now,
      lastSourceVersion: args.sourceVersion,
      lastSourceModifiedAt: args.sourceModifiedAt,
    });
    await ctx.db.patch(run._id, {
      status: "complete",
      finishedAt: now,
    });
  },
});

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
    const { run, settings: c } = await current(ctx, args.runId, args.batch);
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
      const value = {
        userId: c.userId,
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
        const contentChanged = old.contentHash !== hash;
        const requiresEmbedding = active && (!old.active || contentChanged);
        if (
          old.active !== active ||
          contentChanged ||
          old.date !== record.date
        ) {
          changed = true;
          documents += Number(active) - Number(old.active);
          if (!active || contentChanged || !old.active)
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
          needsEmbedding:
            active && (requiresEmbedding || old.needsEmbedding === true)
              ? true
              : undefined,
        });
      } else {
        await ctx.db.insert("journalEntries", {
          ...value,
          updatedAt: Date.now(),
          needsEmbedding: active ? true : undefined,
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
    const { run, settings: c } = await current(ctx, args.runId, args.batch);
    if (run.status !== "reconciling")
      throw new Error("Invalid reconciliation phase");
    const page = await ctx.db
      .query("journalEntries")
      .withIndex("by_user", (q) => q.eq("userId", c.userId))
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
              needsEmbedding: undefined,
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
    const { run, settings: c } = await current(ctx, args.runId, args.batch);
    if (run.status !== "embedding") throw new Error("Invalid embedding phase");
    const entries = await ctx.db
      .query("journalEntries")
      .withIndex("by_user_needs_embedding", (q) =>
        q.eq("userId", c.userId).eq("needsEmbedding", true),
      )
      .take(32);
    return {
      entries: entries.map((d) => ({
        id: d._id,
        hash: d.contentHash,
        text: d.text,
      })),
    };
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
  },
  handler: async (ctx, args) => {
    const { run, settings: c } = await current(ctx, args.runId, args.batch);
    if (run.status !== "embedding" || args.items.length > 32)
      throw new Error("Invalid embedding phase");
    let embeddings = c.embeddings,
      added = 0;
    for (const item of args.items) {
      const d = await ctx.db.get(item.id);
      if (
        !d ||
        d.userId !== c.userId ||
        !d.active ||
        d.needsEmbedding !== true ||
        d.contentHash !== item.hash
      )
        throw new Error("Entry changed while embedding");
      if (!validVector(item.vector)) throw new Error("Invalid embedding");
      const old = await ctx.db
        .query("journalEmbeddings")
        .withIndex("by_entry", (q) => q.eq("entryId", d._id))
        .unique();
      if (old) {
        if (old.userId !== c.userId)
          throw new Error("Embedding ownership mismatch");
        await ctx.db.delete(old._id);
      } else embeddings++;
      await ctx.db.insert("journalEmbeddings", {
        userId: c.userId,
        entryId: d._id,
        profileId: c.profileId,
        contentHash: d.contentHash,
        date: d.date,
        vector: item.vector,
        embeddedAt: Date.now(),
      });
      await ctx.db.patch(d._id, { needsEmbedding: undefined });
      added++;
    }
    await ctx.db.patch(c._id, {
      embeddings,
      revision: c.revision + Number(added > 0),
    });
    await ctx.db.patch(run._id, { embedded: run.embedded + added });
    if (args.items.length === 32) {
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
      ...(run.sourceVersion !== undefined
        ? {
            lastSourceVersion: run.sourceVersion,
            lastSourceModifiedAt: run.sourceModifiedAt,
            lastSourceCheck: Date.now(),
          }
        : {}),
    });
    await ctx.db.patch(run._id, { status: "complete", finishedAt: Date.now() });
  },
});
export const failure = internalMutation({
  args: { runId: v.id("journalSyncRuns"), batch: v.number(), code: v.string() },
  handler: async (ctx, args) => {
    const { run, settings: c } = await current(ctx, args.runId, args.batch);
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
