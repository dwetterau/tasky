import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { taskyApi } from "./tasky";

export const SIGNAL_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type SignalDashboardItem = FunctionReturnType<
  typeof taskyApi.signals.listDashboard
>[number];

export type SignalEntry = FunctionReturnType<
  typeof taskyApi.signals.history
>["page"][number];

export type ScorecardItem = FunctionReturnType<
  typeof taskyApi.scorecards.list
>[number];

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

export function useSignalClock(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
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

export function signalPrimaryText(
  signal: SignalDashboardItem,
  now: number,
): string {
  if (signal.model.kind === "activity") {
    if (
      signal.model.target?.type === "period" &&
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
    signal.model.target?.type === "period" &&
    signal.evaluation.periodProgress
  ) {
    if (signal.evaluation.isComplete) return "done";
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
