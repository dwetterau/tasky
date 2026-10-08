import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { digest, DIMENSIONS, MODEL, partition } from "./lib/journal";
import {
  createJournalToolHandlers,
  journalToolDescriptors,
  type JournalExecutors,
} from "./mcpTools/journal";

const vector = () => [1, ...Array(DIMENSIONS - 1).fill(0)];
vi.mock("./journalEmbeddings", () => ({
  embedTexts: vi.fn(async (texts: string[]) =>
    texts.map(() => [1, ...Array(1535).fill(0)]),
  ),
}));
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
async function fixture() {
  const t = convexTest(schema, modules);
  const owners = await t.run(async (ctx) => {
    const out = [];
    for (const userId of ["user-a", "user-b"]) {
      const profileId = await ctx.db.insert("journalEmbeddingProfiles", {
        userId,
        provider: "convex-ai-gateway",
        model: MODEL,
        dimensions: DIMENSIONS,
        format: "whole-entry-v1;cosine",
        documentPrefix: "",
        queryPrefix: "",
        createdAt: Date.now(),
      });
      const corpusId = await ctx.db.insert("journalCorpora", {
        userId,
        baseId: `app${userId.replace("-", "")}`,
        table: "Journal",
        tokenEnv: "JOURNAL_AIRTABLE_TOKEN",
        profileId,
        enabled: true,
        readable: true,
        revision: 0,
        documents: 0,
        embeddings: 0,
      });
      const runId = await ctx.db.insert("journalSyncRuns", {
        userId,
        corpusId,
        mode: "airtable",
        status: "fetching",
        startedAt: Date.now(),
        seen: 0,
        embedded: 0,
        attempt: 0,
        batch: 0,
      });
      await ctx.db.patch(corpusId, {
        currentRun: runId,
        leaseUntil: Date.now() + 600_000,
      });
      out.push({ userId, corpusId, profileId, runId });
    }
    return out;
  });
  async function add(
    owner = owners[0],
    date = "2024-01-01",
    text = `Garden private ${owner.userId}`,
    record = "recOne",
  ) {
    return t.run(async (ctx) => {
      const c = (await ctx.db.get(owner.corpusId))!;
      const contentHash = await digest(text),
        sourceKey = `${c.baseId}/Journal/${record}`;
      const id = await ctx.db.insert("journalEntries", {
        userId: owner.userId,
        corpusId: c._id,
        sourceKey,
        recordId: record,
        date,
        text,
        contentHash,
        url: `https://example.test/${owner.userId}/${record}`,
        active: true,
        lastSeenRun: owner.runId,
        updatedAt: Date.now(),
      });
      const embeddingId = await ctx.db.insert("journalEmbeddings", {
        userId: owner.userId,
        corpusId: c._id,
        entryId: id,
        profileId: c.profileId,
        contentHash,
        date,
        partition: partition(c),
        vector: vector(),
        embeddedAt: Date.now(),
      });
      await ctx.db.patch(c._id, {
        documents: c.documents + 1,
        embeddings: c.embeddings + 1,
      });
      return { id, sourceKey, embeddingId, contentHash };
    });
  }
  return { t, owners, add };
}

describe("private journal retrieval", () => {
  it("isolates every retrieval path and ignores foreign IDs and vectors", async () => {
    const { t, owners, add } = await fixture();
    const a = await add(),
      b = await add(owners[1]);
    const userId = owners[0].userId;
    const get = await t.query(internal.journal.get, {
      userId,
      input: { dates: ["2024-01-01"], ids: [a.sourceKey, b.sourceKey] },
    });
    expect(get.documents.map((d) => d.id)).toEqual([a.sourceKey]);
    expect(get.missing_ids).toEqual([b.sourceKey]);
    const page = await t.query(internal.journal.list, { userId, input: {} });
    expect(page.documents.map((d) => d.id)).toEqual([a.sourceKey]);
    for (const mode of ["literal", "terms", "phrase"]) {
      const r = await t.query(internal.journal.text, {
        userId,
        input: { query: "Garden", mode },
      });
      expect(r.results.map((h) => h.document.id)).toEqual([a.sourceKey]);
    }
    const lexical = await t.query(internal.journal.lexical, {
      userId,
      query: "Garden",
    });
    expect(lexical.map((h) => h.entryId)).toEqual([a.id]);
    expect(
      await t.query(internal.journal.vectorHits, {
        userId,
        ids: [b.embeddingId],
        revision: 0,
      }),
    ).toEqual([null]);
    expect(
      await t.query(internal.journal.hydrate, {
        userId,
        hits: [{ entryId: b.id, hash: b.contentHash, score: 1 }],
        revision: 0,
      }),
    ).toEqual([]);
    const status = await t.query(internal.journal.status, { userId });
    expect(status.documents).toBe(1);
    expect(status.pending_embeddings).toBe(0);
    for (const mode of ["semantic", "hybrid"]) {
      const result = (await t.action(internal.journalSearch.search, {
        userId,
        input: { query: "Garden", mode },
      })) as { results: Array<{ document: { id: string } }> };
      expect(result.results.map((r) => r.document.id)).toEqual([a.sourceKey]);
    }
    await expect(
      t.query(internal.journal.status, { userId: "not-enrolled" }),
    ).rejects.toThrow("Journal is not available");
  });
  it("uses date-constrained vectors, binds cursors, and rejects a changed corpus", async () => {
    const { t, owners, add } = await fixture();
    const a = await add();
    const second = await add(owners[0], "2025-01-01", "Garden 2025", "recTwo");
    await add(owners[1]);
    const userId = owners[0].userId;
    const result = (await t.action(internal.journalSearch.search, {
      userId,
      input: {
        query: "Garden",
        mode: "semantic",
        date_from: "2025-01-01",
        date_to: "2025-01-01",
      },
    })) as { results: Array<{ document: { id: string } }> };
    expect(result.results.map((r) => r.document.id)).toEqual([
      second.sourceKey,
    ]);
    const page = await t.query(internal.journal.list, {
      userId,
      input: { limit: 1 },
    });
    expect(page.documents[0].id).toBe(a.sourceKey);
    expect(page.next_cursor).toBeTruthy();
    await expect(
      t.query(internal.journal.list, {
        userId: owners[1].userId,
        input: { cursor: page.next_cursor },
      }),
    ).rejects.toThrow("Cursor is invalid");
    await expect(
      t.query(internal.journal.list, {
        userId,
        input: { cursor: page.next_cursor, date_from: "2025-01-01" },
      }),
    ).rejects.toThrow("Cursor is invalid");
    await t.run(async (ctx) =>
      ctx.db.patch(owners[0].corpusId, { revision: 1 }),
    );
    await expect(
      t.query(internal.journal.hydrate, {
        userId,
        hits: [{ entryId: a.id, hash: a.contentHash, score: 1 }],
        revision: 0,
      }),
    ).rejects.toThrow("Journal changed");
  });
  it("requires explicit read/sync scopes before running any executor and rejects owner arguments", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const executors: JournalExecutors = {
      search_journal: execute,
      search_journal_text: execute,
      get_journal_entry: execute,
      list_entries: execute,
      journal_status: execute,
      request_journal_sync: execute,
    };
    const handlers = createJournalToolHandlers(executors);
    const tasks = { scopes: new Set(["tasks:read", "tasks:write"]) };
    expect(journalToolDescriptors(tasks)).toHaveLength(0);
    const denied = await handlers.journal_status(1, "user-a", tasks, {});
    expect((await denied.json()).error).toBeDefined();
    expect(execute).not.toHaveBeenCalled();
    const read = { scopes: new Set(["journal:read"]) };
    expect(journalToolDescriptors(read)).toHaveLength(5);
    expect(
      (
        await (
          await handlers.journal_status(1, "user-a", read, { userId: "user-b" })
        ).json()
      ).error,
    ).toBeDefined();
    expect(
      (
        await (
          await handlers.request_journal_sync(1, "user-a", read, {})
        ).json()
      ).error,
    ).toBeDefined();
    expect(execute).not.toHaveBeenCalled();
    await handlers.get_journal_entry(1, "user-a", read, {
      dates: ["2024-01-01"],
    });
    expect(execute).toHaveBeenCalledWith({
      userId: "user-a",
      input: { dates: ["2024-01-01"], ids: [] },
    });
  });
});

describe("journal synchronization", () => {
  it("invalidates edited vectors, preserves unrelated owners and rejects stale workers", async () => {
    const { t, owners, add } = await fixture();
    const a = await add(),
      b = await add(owners[1]);
    const owner = owners[0];
    await t.mutation(internal.journalImport.ingestPage, {
      runId: owner.runId,
      batch: 0,
      records: [
        { recordId: "recOne", date: "2024-01-01", text: "Updated wording" },
      ],
      offset: "next",
    });
    const status = await t.query(internal.journal.status, {
      userId: owner.userId,
    });
    expect(status.documents).toBe(1);
    expect(status.pending_embeddings).toBe(1);
    expect(await t.run((ctx) => ctx.db.get(a.embeddingId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(b.embeddingId))).not.toBeNull();
    await expect(
      t.mutation(internal.journalImport.ingestPage, {
        runId: owner.runId,
        batch: 0,
        records: [],
      }),
    ).rejects.toThrow("Stale sync worker");
    expect(
      (
        await t.query(internal.journal.get, {
          userId: owner.userId,
          input: { ids: [a.sourceKey] },
        })
      ).documents[0].text,
    ).toBe("Updated wording");
  });
  it("reuses vectors for unchanged and date-only edits and never prunes a partial fetch", async () => {
    const { t, owners, add } = await fixture();
    const a = await add();
    const second = await add(owners[0], "2024-02-01", "untouched", "recTwo");
    const owner = owners[0];
    await t.mutation(internal.journalImport.ingestPage, {
      runId: owner.runId,
      batch: 0,
      records: [
        {
          recordId: "recOne",
          date: "2024-03-01",
          text: "Garden private user-a",
        },
      ],
      offset: "remaining",
    });
    expect((await t.run((ctx) => ctx.db.get(a.embeddingId)))?.date).toBe(
      "2024-03-01",
    );
    expect((await t.run((ctx) => ctx.db.get(second.id)))?.active).toBe(true);
    await expect(
      t.mutation(internal.journalImport.reconcilePage, {
        runId: owner.runId,
        batch: 1,
      }),
    ).rejects.toThrow("Invalid reconciliation phase");
  });
  it("commits matching embeddings only, and activates only complete coverage", async () => {
    const { t, owners } = await fixture();
    const owner = owners[0];
    await t.mutation(internal.journalImport.ingestPage, {
      runId: owner.runId,
      batch: 0,
      records: [
        { recordId: "recNew", date: "2024-01-01", text: "fresh journal" },
      ],
    });
    await t.mutation(internal.journalImport.reconcilePage, {
      runId: owner.runId,
      batch: 1,
    });
    const page = await t.query(internal.journalImport.embeddingPage, {
      runId: owner.runId,
      batch: 2,
    });
    const e = page.entries[0];
    await expect(
      t.mutation(internal.journalImport.saveEmbeddingPage, {
        runId: owner.runId,
        batch: 2,
        items: [{ id: e.id, hash: "stale", vector: vector() }],
        cursor: page.cursor,
      }),
    ).rejects.toThrow("Entry changed");
    await t.mutation(internal.journalImport.saveEmbeddingPage, {
      runId: owner.runId,
      batch: 2,
      items: [{ id: e.id, hash: e.hash, vector: vector() }],
      cursor: page.cursor,
    });
    const status = await t.query(internal.journal.status, {
      userId: owner.userId,
    });
    expect(status.pending_embeddings).toBe(0);
    expect(status.last_full_index).not.toBeNull();
    expect(status.recent_syncs[0].status).toBe("complete");
  });
});
