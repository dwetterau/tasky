import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";

const migrations = new Migrations<DataModel>(components.migrations);

/**
 * Migration: Rename task status "done" to "closed"
 * 
 * Run this migration once after deploying the schema change:
 *   npx convex run migrations:runAll
 * 
 * This is idempotent - safe to run multiple times.
 */
export const migrateTaskStatusDoneToClosed = migrations.define({
  table: "tasks",
  migrateOne: async (ctx, task) => {
    // Check if the task has the old "done" status
    if (task.status === "done") {
      await ctx.db.patch(task._id, {
        status: "closed",
      });
    }
  },
});

// General-purpose runner - can run any migration by name
// Usage: npx convex run migrations:run '{"fn": "migrations:migrateTaskStatusDoneToClosed"}'
export const run = migrations.runner();

// Run all migrations in series
// Usage: npx convex run migrations:runAll
export const runAll = migrations.runner([
  internal.migrations.migrateTaskStatusDoneToClosed,
]);
