import { defineTable } from "convex/server";
import { v } from "convex/values";

export const journalTables = {
  journalSettings: defineTable({
    userId: v.string(),
    baseId: v.string(),
    table: v.string(),
    tokenEnv: v.string(),
    enabled: v.boolean(),
    readable: v.boolean(),
    profileId: v.id("journalEmbeddingProfiles"),
    revision: v.number(),
    documents: v.number(),
    embeddings: v.number(),
    lastFullFetch: v.optional(v.number()),
    lastFullIndex: v.optional(v.number()),
    currentRun: v.optional(v.id("journalSyncRuns")),
    leaseUntil: v.optional(v.number()),
    lastRequestedAt: v.optional(v.number()),
    searchWindow: v.optional(v.number()),
    searchCount: v.optional(v.number()),
    lastSourceVersion: v.optional(v.string()),
    lastSourceModifiedAt: v.optional(v.string()),
    lastSourceCheck: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_enabled", ["enabled"])
    .index("by_source", ["baseId", "table"]),
  journalEmbeddingProfiles: defineTable({
    userId: v.string(),
    provider: v.literal("convex-ai-gateway"),
    model: v.string(),
    dimensions: v.number(),
    format: v.string(),
    documentPrefix: v.string(),
    queryPrefix: v.string(),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),
  journalEntries: defineTable({
    userId: v.string(),
    sourceKey: v.string(),
    recordId: v.string(),
    date: v.string(),
    text: v.string(),
    contentHash: v.string(),
    url: v.string(),
    active: v.boolean(),
    lastSeenRun: v.id("journalSyncRuns"),
    missingSinceRun: v.optional(v.id("journalSyncRuns")),
    embeddingError: v.optional(v.string()),
    needsEmbedding: v.optional(v.boolean()),
    updatedAt: v.number(),
  })
    .index("by_user_source", ["userId", "sourceKey"])
    .index("by_user", ["userId"])
    .index("by_user_active_date", ["userId", "active", "date"])
    .index("by_user_needs_embedding", ["userId", "needsEmbedding"])
    .searchIndex("search_text_user", {
      searchField: "text",
      filterFields: ["userId", "active"],
    }),
  journalEmbeddings: defineTable({
    userId: v.string(),
    entryId: v.id("journalEntries"),
    profileId: v.id("journalEmbeddingProfiles"),
    contentHash: v.string(),
    date: v.string(),
    vector: v.array(v.float64()),
    embeddedAt: v.number(),
  })
    .index("by_user_date", ["userId", "date"])
    .index("by_entry", ["entryId"])
    .vectorIndex("by_vector", {
      vectorField: "vector",
      dimensions: 1536,
      filterFields: ["userId"],
    }),
  journalSyncRuns: defineTable({
    userId: v.string(),
    mode: v.union(v.literal("airtable"), v.literal("import")),
    status: v.union(
      v.literal("fetching"),
      v.literal("reconciling"),
      v.literal("embedding"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    seen: v.number(),
    embedded: v.number(),
    error: v.optional(v.string()),
    offset: v.optional(v.string()),
    cursor: v.optional(v.string()),
    attempt: v.number(),
    batch: v.number(),
    fullFetchAt: v.optional(v.number()),
    sourceVersion: v.optional(v.string()),
    sourceModifiedAt: v.optional(v.string()),
  }).index("by_user", ["userId"]),
};
