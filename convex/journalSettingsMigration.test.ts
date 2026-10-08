import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { DIMENSIONS, MODEL, digest } from "./lib/journal";

it("moves one owner's settings, preserves evidence and vectors, and resumes idempotently", async () => {
  const t = convexTest(schema, modules);
  const rows = await t.run(async (ctx) => {
    const rows = [];
    for (const userId of ["owner", "other-owner"]) {
      const profileId = await ctx.db.insert("journalEmbeddingProfiles", {
        userId,
        provider: "convex-ai-gateway",
        model: MODEL,
        dimensions: DIMENSIONS,
        format: "whole-entry-v1;cosine",
        documentPrefix: "",
        queryPrefix: "",
        createdAt: 1,
      });
      const corpusId = await ctx.db.insert("journalCorpora", {
        userId,
        baseId: "app" + userId,
        table: "Journal",
        tokenEnv: "JOURNAL_AIRTABLE_TOKEN",
        profileId,
        enabled: true,
        readable: true,
        revision: 7,
        documents: 1,
        embeddings: 1,
        lastFullFetch: 1,
        lastFullIndex: 2,
      });
      const runId = await ctx.db.insert("journalSyncRuns", {
        userId,
        corpusId,
        mode: "airtable",
        status: "complete",
        startedAt: 1,
        finishedAt: 2,
        seen: 1,
        embedded: 1,
        attempt: 0,
        batch: 3,
      });
      const contentHash = await digest("private " + userId);
      const entryId = await ctx.db.insert("journalEntries", {
        userId,
        corpusId,
        sourceKey: "app" + userId + "/Journal/recOne",
        recordId: "recOne",
        date: "2026-01-01",
        text: "private " + userId,
        contentHash,
        url: "https://example.test",
        active: true,
        lastSeenRun: runId,
        updatedAt: 1,
      });
      const vectorId = await ctx.db.insert("journalEmbeddings", {
        userId,
        corpusId,
        entryId,
        profileId,
        contentHash,
        date: "2026-01-01",
        partition: JSON.stringify([userId, corpusId, profileId]),
        vector: [1, ...Array(DIMENSIONS - 1).fill(0)],
        embeddedAt: 2,
      });
      rows.push({ userId, corpusId, entryId, vectorId, runId, profileId });
    }
    return rows;
  });
  const [owner, other] = rows;
  const original = await t.run(async (ctx) => ({
    entry: await ctx.db.get(owner.entryId),
    vector: await ctx.db.get(owner.vectorId),
    otherVector: await ctx.db.get(other.vectorId),
  }));
  await t.run((ctx) =>
    ctx.db.patch(owner.corpusId, { currentRun: owner.runId }),
  );
  await expect(
    t.mutation(internal.journalSettingsMigration.begin, {
      userId: owner.userId,
    }),
  ).rejects.toThrow("active journal sync");
  await t.run((ctx) => ctx.db.patch(owner.corpusId, { currentRun: undefined }));
  await t.mutation(internal.journalSettingsMigration.begin, {
    userId: owner.userId,
  });
  await t.mutation(internal.journalSettingsMigration.begin, {
    userId: owner.userId,
  });
  await expect(
    t.mutation(internal.journalSettingsMigration.finish, {
      userId: owner.userId,
    }),
  ).rejects.toThrow("Legacy references remain");
  for (const table of [
    "journalEntries",
    "journalEmbeddings",
    "journalSyncRuns",
  ] as const) {
    await t.mutation(internal.journalSettingsMigration.page, {
      userId: owner.userId,
      table,
      cursor: null,
    });
    const repeated = await t.mutation(internal.journalSettingsMigration.page, {
      userId: owner.userId,
      table,
      cursor: null,
    });
    expect(repeated.changed).toBe(0);
  }
  await t.mutation(internal.journalSettingsMigration.finish, {
    userId: owner.userId,
  });
  await t.mutation(internal.journalSettingsMigration.finish, {
    userId: owner.userId,
  });
  await t.run(async (ctx) => {
    expect(await ctx.db.get(owner.corpusId)).toBeNull();
    expect(await ctx.db.get(other.corpusId)).not.toBeNull();
    const settings = await ctx.db
      .query("journalSettings")
      .withIndex("by_user", (q) => q.eq("userId", owner.userId))
      .unique();
    expect(settings).toMatchObject({
      enabled: true,
      readable: true,
      revision: 8,
      documents: 1,
      embeddings: 1,
      lastFullIndex: 2,
      profileId: owner.profileId,
    });
    expect(await ctx.db.get(owner.entryId)).toEqual({
      ...original.entry,
      corpusId: undefined,
    });
    expect(await ctx.db.get(owner.vectorId)).toEqual({
      ...original.vector,
      corpusId: undefined,
      partition: undefined,
    });
    expect(await ctx.db.get(other.vectorId)).toEqual(original.otherVector);
  });
  const status = await t.query(internal.journal.status, {
    userId: owner.userId,
  });
  expect(status.documents).toBe(1);
  expect(status.pending_embeddings).toBe(0);
});
