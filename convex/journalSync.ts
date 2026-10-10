import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { embedTexts } from "./journalEmbeddings";

const SOURCE_MODIFIED_FIELD = "Entry modified time";

type SourceCheckpoint = {
  version: string;
  modifiedAt?: string;
};

function sourceUrl(baseId: string, table: string): URL {
  return new URL(
    `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(table)}`,
  );
}

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export function sourceCheckpointForRecord(record?: {
  createdTime: string;
  fields: Record<string, unknown>;
}): SourceCheckpoint {
  if (!record) return { version: "empty" };
  const modifiedAt = record.fields[SOURCE_MODIFIED_FIELD];
  if (!validTimestamp(record.createdTime) || !validTimestamp(modifiedAt))
    throw new Error("Invalid source checkpoint");
  const latest =
    modifiedAt > record.createdTime ? modifiedAt : record.createdTime;
  return {
    version: latest,
    modifiedAt: latest,
  };
}

async function fetchSourceCheckpoint(
  baseId: string,
  table: string,
  token: string,
): Promise<SourceCheckpoint> {
  const url = sourceUrl(baseId, table);
  url.searchParams.set("maxRecords", "1");
  url.searchParams.set("pageSize", "1");
  url.searchParams.append("fields[]", SOURCE_MODIFIED_FIELD);
  url.searchParams.set("sort[0][field]", SOURCE_MODIFIED_FIELD);
  url.searchParams.set("sort[0][direction]", "desc");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(45_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
  const payload = (await response.json()) as {
    records?: Array<{
      id?: unknown;
      createdTime?: unknown;
      fields?: unknown;
    }>;
  };
  if (!Array.isArray(payload.records) || payload.records.length > 1)
    throw new Error("Invalid source checkpoint response");
  const record = payload.records[0];
  if (!record) return sourceCheckpointForRecord();
  if (
    typeof record.id !== "string" ||
    typeof record.createdTime !== "string" ||
    !record.fields ||
    typeof record.fields !== "object" ||
    Array.isArray(record.fields)
  )
    throw new Error("Invalid source checkpoint record");
  return sourceCheckpointForRecord({
    createdTime: record.createdTime,
    fields: record.fields as Record<string, unknown>,
  });
}

export const step = internalAction({
  args: { runId: v.id("journalSyncRuns"), batch: v.number() },
  handler: async (ctx, args): Promise<void> => {
    let state;
    try {
      state = await ctx.runQuery(internal.journalImport.state, args);
    } catch {
      return;
    }
    const { run, settings } = state;
    try {
      if (run.status === "fetching") {
        const token = process.env[settings.tokenEnv];
        if (!token) throw new Error("Source credential is unavailable");
        if (run.sourceVersion === undefined) {
          const checkpoint = await fetchSourceCheckpoint(
            settings.baseId,
            settings.table,
            token,
          );
          const canInitializeCheckpoint =
            settings.lastSourceVersion === undefined &&
            settings.lastFullFetch !== undefined &&
            settings.documents === settings.embeddings &&
            (checkpoint.modifiedAt === undefined ||
              Date.parse(checkpoint.modifiedAt) <= settings.lastFullFetch);
          if (
            settings.lastSourceVersion === checkpoint.version ||
            canInitializeCheckpoint
          ) {
            await ctx.runMutation(internal.journalImport.completeUnchanged, {
              ...args,
              sourceVersion: checkpoint.version,
              sourceModifiedAt: checkpoint.modifiedAt,
            });
          } else {
            await ctx.runMutation(internal.journalImport.beginSourceFetch, {
              ...args,
              sourceVersion: checkpoint.version,
              sourceModifiedAt: checkpoint.modifiedAt,
            });
          }
          return;
        }
        const url = sourceUrl(settings.baseId, settings.table);
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
