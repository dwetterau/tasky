import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Task status and priority literals
// Note: "done" is included temporarily for safe migration (will be removed after all data migrated to "closed")
export const taskStatusValues = ["not_started", "in_progress", "blocked", "closed", "done"] as const;
export const taskPriorityValues = ["triage", "low", "medium", "high"] as const;

// TypeScript types derived from the arrays
export type TaskStatus = (typeof taskStatusValues)[number];
export type TaskPriority = (typeof taskPriorityValues)[number];

export const taskStatus = v.union(
  v.literal("not_started"),
  v.literal("in_progress"),
  v.literal("blocked"),
  v.literal("closed"),
  v.literal("done")
);

export const taskPriority = v.union(
  v.literal("triage"),
  v.literal("low"),
  v.literal("medium"),
  v.literal("high")
);

// Note: better-auth manages its own tables (users, sessions, accounts, verifications)
// through the component. Our app tables use string userId to reference better-auth users.
export default defineSchema({
  captures: defineTable({
    userId: v.string(),
    text: v.string(),
    completed: v.boolean(),
    statusUpdatedAt: v.optional(v.number()), // Unix timestamp (ms) of last status change, for analytics
  })
    .index("by_user", ["userId"])
    .index("by_user_completed", ["userId", "completed"]),

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

  tasks: defineTable({
    userId: v.string(),
    content: v.string(), // Task description (Markdown)
    tagIds: v.array(v.id("tags")),
    status: taskStatus,
    priority: taskPriority,
    dueDate: v.optional(v.string()), // ISO date string (YYYY-MM-DD)
    createdFromCaptureId: v.optional(v.id("captures")), // Track source capture
    completedAt: v.optional(v.number()), // Unix timestamp (ms) when task was completed
    statusUpdatedAt: v.optional(v.number()), // Unix timestamp (ms) of last status change
  })
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"])
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
