import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  calendarProgress,
  calendarWindow,
  legacyCalendarSchedule,
  validateTimezone,
} from "./recurrence";
import type { ActivityPeriodProgress } from "./signalStatus";

type DatabaseCtx = QueryCtx | MutationCtx;
const MAX_ENTRIES_PER_WINDOW = 1000;

export async function resolveUserTimezone(
  ctx: DatabaseCtx,
  userId: string,
): Promise<string> {
  const settings = await ctx.db
    .query("userSettings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const enrollment =
    settings === null
      ? await ctx.db
          .query("homepageEnrollments")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .unique()
      : null;
  const timezone = settings?.timezone ?? enrollment?.timezone ?? "UTC";
  try {
    validateTimezone(timezone);
    return timezone;
  } catch {
    return "UTC";
  }
}

export async function getActivityPeriodProgress(
  ctx: DatabaseCtx,
  signal: Doc<"signals">,
  now: number,
  timezone: string,
): Promise<ActivityPeriodProgress | undefined> {
  if (signal.model.kind !== "activity") {
    return undefined;
  }
  const target = signal.model.target;
  if (target?.type !== "period" && target?.type !== "schedule") {
    return undefined;
  }
  const schedule =
    target.type === "period"
      ? legacyCalendarSchedule(target.period)
      : target.schedule;
  const window = calendarWindow(schedule, target.targetCount, now, timezone);
  const entries = await ctx.db
    .query("signalEntries")
    .withIndex("by_signal_effective_at", (q) =>
      q
        .eq("signalId", signal._id)
        .gte("effectiveAt", window.startAt)
        .lt("effectiveAt", window.endAt),
    )
    .take(MAX_ENTRIES_PER_WINDOW + 1);
  if (entries.length > MAX_ENTRIES_PER_WINDOW) {
    throw new Error(
      `A schedule window cannot contain more than ${MAX_ENTRIES_PER_WINDOW} entries`,
    );
  }
  const completedCount = entries.filter(
    (entry) =>
      entry.userId === signal.userId &&
      entry.operation.type === "activity.occurred",
  ).length;
  return calendarProgress(
    window,
    completedCount,
    target.targetCount,
    now,
  );
}
