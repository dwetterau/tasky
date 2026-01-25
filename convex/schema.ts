import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Note: better-auth manages its own tables (users, sessions, accounts, verifications)
// through the component. Our app tables use string userId to reference better-auth users.
export default defineSchema({
  captures: defineTable({
    userId: v.string(),
    text: v.string(),
    completed: v.boolean(),
  }).index("by_user", ["userId"]),

  notes: defineTable({
    userId: v.string(),
    content: v.string(), // Markdown content
    tagIds: v.array(v.id("tags")),
    createdFromCaptureId: v.optional(v.id("captures")), // Track source capture
  })
    .index("by_user", ["userId"])
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["userId"],
    }),

  tags: defineTable({
    userId: v.string(),
    name: v.string(),
    parentId: v.union(v.id("tags"), v.null()),
    color: v.optional(v.string()),
    // All descendant tag IDs (recursive children)
    childrenRecursive: v.optional(v.array(v.id("tags"))),
  })
    .index("by_user", ["userId"])
    .index("by_parent", ["userId", "parentId"])
    .index("by_user_name", ["userId", "name"]),
});
