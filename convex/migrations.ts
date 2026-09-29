import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";
import { legacyCalendarSchedule } from "./lib/recurrence";

const migrations = new Migrations<DataModel>(components.migrations);

export const backfillTaskStatusUpdatedAt = migrations.define({
  table: "tasks",
  batchSize: 50,
  migrateOne: (ctx, task) => {
    const nextStatusUpdatedAt = task.completedAt ?? task._creationTime;
    if (task.statusUpdatedAt === undefined) {
      return { statusUpdatedAt: nextStatusUpdatedAt };
    }
  },
});

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

export const backfillScorecardMemberType = migrations.define({
  table: "scorecards",
  batchSize: 50,
  migrateOne: (_ctx, scorecard) => {
    let changed = false;
    const members = scorecard.members.map((member) => {
      if (member.type === "signal" || member.type === "scorecard") {
        return member;
      }
      const legacy = member as {
        signalId: import("./_generated/dataModel").Id<"signals">;
        role: "required" | "optional";
      };
      changed = true;
      return {
        type: "signal" as const,
        signalId: legacy.signalId,
        role: legacy.role,
      };
    });
    return changed ? { members } : undefined;
  },
});

export const backfillUserTimezoneFromHomepage = migrations.define({
  table: "homepageEnrollments",
  batchSize: 50,
  migrateOne: async (ctx, enrollment) => {
    const existing = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", enrollment.userId))
      .unique();
    if (!existing) {
      await ctx.db.insert("userSettings", {
        userId: enrollment.userId,
        timezone: enrollment.timezone,
        updatedAt: enrollment._creationTime,
      });
    }
  },
});

export const backfillScorecardSchedules = migrations.define({
  table: "scorecards",
  batchSize: 50,
  migrateOne: async (ctx, scorecard) => {
    if (scorecard.schedule !== undefined) {
      return;
    }
    const periods = new Set<"day" | "week" | "month">();
    const visiting = new Set<string>();
    const collectPeriods = async (
      card: typeof scorecard,
    ): Promise<boolean> => {
      if (visiting.has(String(card._id))) {
        return false;
      }
      visiting.add(String(card._id));
      for (const member of card.members) {
        if (member.type === "scorecard") {
          const child = await ctx.db.get("scorecards", member.scorecardId);
          if (!child || !(await collectPeriods(child))) {
            return false;
          }
          continue;
        }
        const signal = await ctx.db.get("signals", member.signalId);
        if (!signal || signal.model.kind !== "activity") {
          return false;
        }
        const target = signal.model.target;
        if (target?.type !== "period") {
          return false;
        }
        periods.add(target.period);
      }
      visiting.delete(String(card._id));
      return true;
    };
    if (!(await collectPeriods(scorecard)) || periods.size !== 1) {
      return;
    }
    const [period] = periods;
    return period ? { schedule: legacyCalendarSchedule(period) } : undefined;
  },
});

export const backfillActivitySchedules = migrations.define({
  table: "signals",
  batchSize: 50,
  migrateOne: (_ctx, signal) => {
    if (
      signal.model.kind !== "activity" ||
      signal.model.target?.type !== "period"
    ) {
      return;
    }
    return {
      model: {
        ...signal.model,
        target: {
          type: "schedule" as const,
          schedule: legacyCalendarSchedule(signal.model.target.period),
          targetCount: signal.model.target.targetCount,
        },
      },
    };
  },
});

// General-purpose runner - can run any migration by name
// Usage: npx convex run migrations:run '{"fn": "migrations:backfillTaskTagLinksAndHasTags"}'
export const run = migrations.runner();

// Run all migrations in series
// Usage: npx convex run migrations:runAll
export const runAll = migrations.runner([
  internal.migrations.backfillTaskStatusUpdatedAt,
  internal.migrations.backfillTaskTagLinksAndHasTags,
  internal.migrations.backfillScorecardMemberType,
  internal.migrations.backfillUserTimezoneFromHomepage,
  internal.migrations.backfillScorecardSchedules,
  internal.migrations.backfillActivitySchedules,
]);
