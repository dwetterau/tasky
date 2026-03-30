import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";

const migrations = new Migrations<DataModel>(components.migrations);

export const backfillTaskTagLinksAndHasTags = migrations.define({
  table: "tasks",
  batchSize: 50,
  migrateOne: async (ctx, task) => {
    const normalizedTagIds = Array.from(new Set(task.tagIds));
    const validTags = await Promise.all(normalizedTagIds.map((tagId) => ctx.db.get(tagId)));
    const validUserTagIds = validTags
      .filter((tag): tag is NonNullable<typeof tag> => tag !== null && tag.userId === task.userId)
      .map((tag) => tag._id);

    const existingLinks = await ctx.db
      .query("taskTags")
      .withIndex("by_user_task", (q) => q.eq("userId", task.userId).eq("taskId", task._id))
      .collect();

    const validUserTagIdSet = new Set(validUserTagIds);
    const keptExistingTagIds = new Set<typeof validUserTagIds[number]>();
    for (const link of existingLinks) {
      if (!validUserTagIdSet.has(link.tagId) || keptExistingTagIds.has(link.tagId)) {
        await ctx.db.delete(link._id);
        continue;
      }
      keptExistingTagIds.add(link.tagId);
    }

    for (const tagId of validUserTagIds) {
      if (!keptExistingTagIds.has(tagId)) {
        await ctx.db.insert("taskTags", {
          userId: task.userId,
          taskId: task._id,
          tagId,
        });
      }
    }

    const patch: { tagIds?: typeof task.tagIds; hasTags?: boolean } = {};
    if (normalizedTagIds.length !== task.tagIds.length) {
      patch.tagIds = normalizedTagIds;
    }
    const hasTags = normalizedTagIds.length > 0;
    if (task.hasTags !== hasTags) {
      patch.hasTags = hasTags;
    }

    return Object.keys(patch).length > 0 ? patch : undefined;
  },
});

// General-purpose runner - can run any migration by name
// Usage: npx convex run migrations:run '{"fn": "migrations:backfillTaskTagLinksAndHasTags"}'
export const run = migrations.runner();

// Run all migrations in series
// Usage: npx convex run migrations:runAll
export const runAll = migrations.runner([
  internal.migrations.backfillTaskTagLinksAndHasTags,
]);
