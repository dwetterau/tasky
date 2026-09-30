import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { taskyApi } from "./tasky";

export const SIGNAL_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const SIGNAL_QUERY_REFRESH_MS = 5 * 60 * 1000;

export type SignalDashboardItem = FunctionReturnType<
  typeof taskyApi.signals.listDashboard
>[number];

export type SignalEntry = FunctionReturnType<
  typeof taskyApi.signals.history
>["page"][number];

export type ScorecardItem = FunctionReturnType<
  typeof taskyApi.scorecards.list
>[number];

export type SignalTagGroup = {
  key: string;
  label: string;
  tag: SignalDashboardItem["tags"][number] | null;
  signals: SignalDashboardItem[];
};

type SignalGroupingTag = {
  _id: SignalDashboardItem["tagIds"][number];
  name: string;
  parentId: SignalDashboardItem["tagIds"][number] | null;
};

function signalTagPath(
  tag: SignalDashboardItem["tags"][number],
  tagsById: ReadonlyMap<string, SignalGroupingTag>,
): string {
  const names = [tag.name];
  const seen = new Set<string>([String(tag.id)]);
  let parentId = tagsById.get(String(tag.id))?.parentId ?? null;

  while (parentId !== null) {
    const key = String(parentId);
    if (seen.has(key)) break;
    seen.add(key);
    const parent = tagsById.get(key);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }

  return names.join(" › ");
}

export function groupSignalsByFirstTag(
  signals: SignalDashboardItem[],
  availableTags: SignalGroupingTag[],
): SignalTagGroup[] {
  const groups = new Map<string, SignalTagGroup>();
  const tagsById = new Map(
    availableTags.map((tag) => [String(tag._id), tag] as const),
  );

  for (const signal of signals) {
    const tag = signal.tags[0] ?? null;
    const key = tag ? `tag:${String(tag.id)}` : "untagged";
    const existing = groups.get(key);
    if (existing) {
      existing.signals.push(signal);
    } else {
      groups.set(key, {
        key,
        label: tag ? signalTagPath(tag, tagsById) : "Untagged",
        tag,
        signals: [signal],
      });
    }
  }

  return [...groups.values()].sort((left, right) => {
    if (left.tag === null) return 1;
    if (right.tag === null) return -1;
    return left.label.localeCompare(right.label, undefined, {
      sensitivity: "base",
    });
  });
}

type ActivitySignalModel = Extract<
  SignalDashboardItem["model"],
  { kind: "activity" }
>;

type ActivityEntryOperation = Extract<
  SignalEntry["operation"],
  { type: "activity.occurred" }
>;

export type ActivityMeasurementField = NonNullable<
  ActivitySignalModel["measurementFields"]
>[number];

export type ActivityMeasurements = NonNullable<
  ActivityEntryOperation["measurements"]
>;

export type ActivityMeasurementDraft = Record<ActivityMeasurementField, string>;

export const ACTIVITY_MEASUREMENT_OPTIONS: Array<{
  field: ActivityMeasurementField;
  label: string;
  inputLabel: string;
  placeholder: string;
}> = [
  {
    field: "weight",
    label: "Weight",
    inputLabel: "Weight (lb)",
    placeholder: "135",
  },
  {
    field: "reps",
    label: "Repetitions",
    inputLabel: "Repetitions",
    placeholder: "8",
  },
  {
    field: "sets",
    label: "Sets",
    inputLabel: "Sets",
    placeholder: "3",
  },
  {
    field: "durationSeconds",
    label: "Duration",
    inputLabel: "Duration (minutes)",
    placeholder: "30",
  },
  {
    field: "distance",
    label: "Distance",
    inputLabel: "Distance (mi)",
    placeholder: "3.1",
  },
];

export function emptyActivityMeasurementDraft(): ActivityMeasurementDraft {
  return {
    weight: "",
    reps: "",
    sets: "",
    durationSeconds: "",
    distance: "",
  };
}

export function activityMeasurementDraftFromEntry(
  measurements: ActivityMeasurements | undefined,
): ActivityMeasurementDraft {
  return {
    weight: measurements?.weight?.toString() ?? "",
    reps: measurements?.reps?.toString() ?? "",
    sets: measurements?.sets?.toString() ?? "",
    durationSeconds:
      measurements?.durationSeconds === undefined
        ? ""
        : String(measurements.durationSeconds / 60),
    distance: measurements?.distance?.toString() ?? "",
  };
}

export function parseActivityMeasurements(
  fields: ActivityMeasurementField[],
  draft: ActivityMeasurementDraft,
): ActivityMeasurements | undefined {
  if (fields.length === 0) {
    return undefined;
  }
  const measurements: ActivityMeasurements = {};
  for (const field of fields) {
    const rawValue = draft[field].trim();
    const option = ACTIVITY_MEASUREMENT_OPTIONS.find(
      (candidate) => candidate.field === field,
    );
    if (!rawValue) {
      throw new Error(`${option?.label ?? field} is required`);
    }
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`${option?.label ?? field} must be zero or greater`);
    }
    if ((field === "reps" || field === "sets") && !Number.isInteger(parsed)) {
      throw new Error(`${option?.label ?? field} must be a whole number`);
    }
    measurements[field] = field === "durationSeconds" ? parsed * 60 : parsed;
  }
  return measurements;
}

function formatDuration(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  return [
    hours > 0 ? `${hours}h` : undefined,
    minutes > 0 ? `${minutes}m` : undefined,
    seconds > 0 || rounded === 0 ? `${seconds}s` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" ");
}

export function formatActivityMeasurements(
  measurements: ActivityMeasurements | undefined,
): string | undefined {
  if (!measurements) {
    return undefined;
  }
  const parts = [
    measurements.weight === undefined
      ? undefined
      : `${formatSignalQuantity(measurements.weight)} lb`,
    measurements.reps === undefined ? undefined : `${measurements.reps} reps`,
    measurements.sets === undefined ? undefined : `${measurements.sets} sets`,
    measurements.durationSeconds === undefined
      ? undefined
      : formatDuration(measurements.durationSeconds),
    measurements.distance === undefined
      ? undefined
      : `${formatSignalQuantity(measurements.distance)} mi`,
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(" · ");
}

export type SignalPeriodBounds = {
  day: {
    startAt: number;
    endAt: number;
  };
  week: {
    startAt: number;
    endAt: number;
  };
  month: {
    startAt: number;
    endAt: number;
  };
};

export function getSignalPeriodBounds(now: number): SignalPeriodBounds {
  const date = new Date(now);
  const dayStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const dayEnd = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
  );
  const daysSinceMonday = (date.getDay() + 6) % 7;
  const weekStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() - daysSinceMonday,
  );
  const weekEnd = new Date(
    weekStart.getFullYear(),
    weekStart.getMonth(),
    weekStart.getDate() + 7,
  );
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return {
    day: {
      startAt: dayStart.getTime(),
      endAt: dayEnd.getTime(),
    },
    week: {
      startAt: weekStart.getTime(),
      endAt: weekEnd.getTime(),
    },
    month: {
      startAt: monthStart.getTime(),
      endAt: monthEnd.getTime(),
    },
  };
}

export function getSignalQueryTime(now: number): number {
  return Math.floor(now / SIGNAL_QUERY_REFRESH_MS) * SIGNAL_QUERY_REFRESH_MS;
}

export function useSignalClock(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const update = () => setNow(Date.now());
    const interval = setInterval(update, 60_000);
    const appStateSubscription = AppState.addEventListener(
      "change",
      (nextState) => {
        if (nextState === "active") {
          update();
        }
      },
    );
    return () => {
      clearInterval(interval);
      appStateSubscription.remove();
    };
  }, []);

  return now;
}

export function createSignalIdempotencyKey(prefix: string): string {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function formatSignalQuantity(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/\.?0+$/, "");
}

export function formatElapsed(milliseconds: number): string {
  const safe = Math.max(0, milliseconds);
  const minutes = Math.floor(safe / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 12) return `${weeks}w ago`;
  return new Date(Date.now() - safe).toLocaleDateString();
}

export function formatFuture(timestamp: number, now: number): string {
  const remaining = timestamp - now;
  if (remaining <= 0) return "due now";
  const hours = Math.ceil(remaining / (60 * 60 * 1000));
  if (hours < 24) return `due in ${hours}h`;
  const days = Math.ceil(hours / 24);
  return `due in ${days}d`;
}

const ATTENTION_RANK: Record<
  SignalDashboardItem["evaluation"]["attention"],
  number
> = {
  due: 0,
  soon: 1,
  unknown: 2,
  ok: 3,
};

export function compareSignalActionability(
  left: SignalDashboardItem,
  right: SignalDashboardItem,
): number {
  const rankDelta = left.actionability.rank - right.actionability.rank;
  if (rankDelta !== 0) {
    return rankDelta;
  }
  const actionAtDelta =
    (left.actionability.actionAt ?? Number.POSITIVE_INFINITY) -
    (right.actionability.actionAt ?? Number.POSITIVE_INFINITY);
  if (actionAtDelta !== 0) {
    return actionAtDelta;
  }
  const attentionDelta =
    ATTENTION_RANK[left.evaluation.attention] -
    ATTENTION_RANK[right.evaluation.attention];
  return attentionDelta || left.name.localeCompare(right.name);
}

export function lastLoggedAt(signal: SignalDashboardItem): number | undefined {
  return signal.model.kind === "activity"
    ? signal.model.lastOccurredAt
    : signal.model.confirmedAt;
}

export function loggedTodaySignals(
  signals: SignalDashboardItem[],
  day: { startAt: number; endAt: number },
): SignalDashboardItem[] {
  return signals
    .filter((signal) => {
      const loggedAt = lastLoggedAt(signal);
      return (
        loggedAt !== undefined &&
        loggedAt >= day.startAt &&
        loggedAt < day.endAt
      );
    })
    .sort((left, right) => {
      const loggedDelta =
        (lastLoggedAt(right) ?? 0) - (lastLoggedAt(left) ?? 0);
      return loggedDelta !== 0
        ? loggedDelta
        : left.name.localeCompare(right.name);
    });
}

export function leftoverSignals(
  signals: SignalDashboardItem[],
  scorecards: ScorecardItem[],
): SignalDashboardItem[] {
  const assignedIds = new Set<string>();
  for (const scorecard of scorecards) {
    for (const member of scorecard.members) {
      if (member.type === "signal") {
        assignedIds.add(member.signalId);
      }
    }
  }
  return signals
    .filter((signal) => !assignedIds.has(signal.id))
    .slice()
    .sort(compareSignalActionability);
}

export function memberContributionCount(
  member: ScorecardItem["members"][number],
): number {
  if (member.evaluation.count !== undefined) {
    return member.evaluation.count;
  }
  if (member.evaluation.periodProgress) {
    return member.evaluation.periodProgress.completedCount;
  }
  return member.evaluation.isComplete ? 1 : 0;
}

export function scorecardHeadline(scorecard: ScorecardItem): string {
  const periodLabel =
    scorecard.evaluation.scheduleProgress?.period === "day"
      ? "today"
      : scorecard.evaluation.scheduleProgress?.period === "month"
        ? "this month"
        : scorecard.evaluation.scheduleProgress?.period === "week"
          ? "this week"
          : "current";
  if (scorecard.targetCount !== undefined) {
    return `${scorecard.evaluation.count} of ${scorecard.targetCount} · ${periodLabel}`;
  }
  if (scorecard.optionalQuota > 0) {
    const sessions = scorecard.evaluation.count;
    const remainder =
      scorecard.evaluation.optionalDoneCount % scorecard.optionalQuota;
    const inBundle =
      remainder === 0 && sessions > 0 ? scorecard.optionalQuota : remainder;
    return `${sessions} ${periodLabel} · ${inBundle}/${scorecard.optionalQuota}`;
  }
  if (scorecard.evaluation.isComplete) {
    return "Done";
  }
  const required = scorecard.members.filter(
    (member) => member.role === "required",
  );
  if (required.length > 0) {
    const done = required.filter((member) => member.evaluation.isComplete).length;
    return `${done} of ${required.length}`;
  }
  return "Not done";
}

export function scorecardMemberDot(
  member: ScorecardItem["members"][number],
): "ok" | "required" | "behind" | "idle" {
  if (member.evaluation.isComplete) {
    return "ok";
  }
  const contributed = memberContributionCount(member) > 0;
  if (member.role === "required") {
    return contributed ? "behind" : "required";
  }
  return contributed ? "behind" : "idle";
}

export function nestedScorecardDetail(
  member: ScorecardItem["members"][number],
): string {
  const count = memberContributionCount(member);
  if (count > 0) {
    return count === 1 ? "1 this week" : `${count} this week`;
  }
  return member.evaluation.isComplete ? "Done" : "None this week";
}

export function signalPrimaryText(
  signal: SignalDashboardItem,
  now: number,
): string {
  if (signal.model.kind === "activity") {
    if (
      (signal.model.target?.type === "period" ||
        signal.model.target?.type === "schedule") &&
      signal.evaluation.periodProgress
    ) {
      const progress = signal.evaluation.periodProgress;
      const periodLabel =
        progress.period === "day"
          ? "today"
          : progress.period === "month"
            ? "this month"
            : "this week";
      if (progress.targetCount <= 0) {
        return progress.completedCount > 0
          ? `logged ${periodLabel}`
          : `none ${periodLabel}`;
      }
      return `${progress.completedCount}/${progress.targetCount} ${periodLabel}`;
    }
    return signal.model.lastOccurredAt === undefined
      ? "Never recorded"
      : formatElapsed(now - signal.model.lastOccurredAt);
  }
  const quantity =
    signal.evaluation.projectedQuantity ?? signal.model.confirmedQuantity;
  return `${formatSignalQuantity(quantity)} ${signal.model.unit}${
    signal.evaluation.isProjected ? " projected" : ""
  }`;
}

export function signalSecondaryText(
  signal: SignalDashboardItem,
  now: number,
): string {
  if (
    signal.model.kind === "activity" &&
    (signal.model.target?.type === "period" ||
      signal.model.target?.type === "schedule") &&
    signal.evaluation.periodProgress
  ) {
    if (signal.evaluation.isComplete) return "done";
    if (signal.evaluation.actionAt !== undefined) {
      return formatFuture(signal.evaluation.actionAt, now);
    }
    const periodEnd = signal.evaluation.periodProgress.endAt;
    const hours = Math.max(1, Math.ceil((periodEnd - now) / (60 * 60 * 1000)));
    return hours < 24
      ? `ends in ${hours}h`
      : `ends in ${Math.ceil(hours / 24)}d`;
  }
  if (signal.evaluation.actionAt !== undefined) {
    return formatFuture(signal.evaluation.actionAt, now);
  }
  if (signal.model.kind === "inventory") {
    return `Last confirmed ${new Date(signal.model.confirmedAt).toLocaleDateString()}`;
  }
  return signal.evaluation.reason;
}
