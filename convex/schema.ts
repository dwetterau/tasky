import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,
  todos: defineTable({
    userId: v.id("users"),
    text: v.string(),
    completed: v.boolean(),
  }).index("by_user", ["userId"]),

  tags: defineTable({
    userId: v.id("users"),
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
