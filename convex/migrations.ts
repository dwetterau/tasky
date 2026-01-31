import { internalMutation } from "./_generated/server";

/**
 * Migration: Rename task status "done" to "closed"
 * 
 * Run this migration once after deploying the schema change:
 *   npx convex run migrations:migrateTaskStatusDoneToClosed
 * 
 * This is idempotent - safe to run multiple times.
 */
export const migrateTaskStatusDoneToClosed = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Query all tasks - we need to check each one for the old "done" status
    // Since the schema now expects "closed", we use a raw query approach
    const tasks = await ctx.db.query("tasks").collect();
    
    let migratedCount = 0;
    
    for (const task of tasks) {
      // Check if the task has the old "done" status
      // We need to cast since TypeScript now expects "closed"
      if ((task.status as string) === "done") {
        await ctx.db.patch(task._id, {
          status: "closed",
        });
        migratedCount++;
      }
    }
    
    return {
      totalTasks: tasks.length,
      migratedCount,
      message: `Migrated ${migratedCount} tasks from "done" to "closed" status`,
    };
  },
});
