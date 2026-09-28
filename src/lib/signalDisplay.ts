"use client";

import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";

export const SIGNAL_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type SignalDashboardItem = FunctionReturnType<
  typeof api.signals.listDashboard
>[number];

export type ScorecardItem = FunctionReturnType<
  typeof api.scorecards.list
>[number];

export type SignalPeriodBounds = {
  day: { startAt: number; endAt: number };
  week: { startAt: number; endAt: number };
  month: { startAt: number; endAt: number };
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
    day: { startAt: dayStart.getTime(), endAt: dayEnd.getTime() },
    week: { startAt: weekStart.getTime(), endAt: weekEnd.getTime() },
    month: { startAt: monthStart.getTime(), endAt: monthEnd.getTime() },
  };
}

export function useSignalClock(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  return now;
}

export function formatSignalQuantity(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/\.?0+$/, "");
}

function formatElapsed(milliseconds: number, now: number): string {
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
  return new Date(now - safe).toLocaleDateString();
}

function formatFuture(timestamp: number, now: number): string {
  const remaining = timestamp - now;
  if (remaining <= 0) return "due now";
  const hours = Math.ceil(remaining / (60 * 60 * 1000));
  if (hours < 24) return `due in ${hours}h`;
  return `due in ${Math.ceil(hours / 24)}d`;
}

export function signalPrimaryText(
  signal: SignalDashboardItem,
  now: number,
): string {
  if (signal.model.kind === "activity") {
    const progress = signal.evaluation.periodProgress;
    if (signal.model.target?.type === "period" && progress) {
      const periodLabel =
        progress.period === "day"
          ? "today"
          : progress.period === "month"
            ? "this month"
            : "this week";
      return `${progress.completedCount}/${progress.targetCount} ${periodLabel}`;
    }
    return signal.model.lastOccurredAt === undefined
      ? "Never recorded"
      : formatElapsed(now - signal.model.lastOccurredAt, now);
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
  const progress = signal.evaluation.periodProgress;
  if (
    signal.model.kind === "activity" &&
    signal.model.target?.type === "period" &&
    progress
  ) {
    if (signal.evaluation.isComplete) return "done";
    const hours = Math.max(
      1,
      Math.ceil((progress.endAt - now) / (60 * 60 * 1000)),
    );
    return hours < 24
      ? `ends in ${hours}h`
      : `ends in ${Math.ceil(hours / 24)}d`;
  }
  if (signal.evaluation.actionAt !== undefined) {
    return formatFuture(signal.evaluation.actionAt, now);
  }
  if (signal.model.kind === "inventory") {
    return `Last confirmed ${new Date(
      signal.model.confirmedAt,
    ).toLocaleDateString()}`;
  }
  return signal.evaluation.reason;
}

export function lastLoggedAt(
  signal: SignalDashboardItem,
): number | undefined {
  return signal.model.kind === "activity"
    ? signal.model.lastOccurredAt
    : signal.model.confirmedAt;
}

export function loggedTodaySignals(
  signals: SignalDashboardItem[],
  day: SignalPeriodBounds["day"],
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
      const timeDifference =
        (lastLoggedAt(right) ?? 0) - (lastLoggedAt(left) ?? 0);
      return timeDifference || left.name.localeCompare(right.name);
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
  return signals.filter((signal) => !assignedIds.has(signal.id));
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
  if (scorecard.targetCount !== undefined) {
    return `${scorecard.evaluation.count} of ${scorecard.targetCount}`;
  }
  if (scorecard.optionalQuota > 0) {
    const sessions = scorecard.evaluation.count;
    const remainder =
      scorecard.evaluation.optionalDoneCount % scorecard.optionalQuota;
    const inBundle =
      remainder === 0 && sessions > 0 ? scorecard.optionalQuota : remainder;
    return `${sessions} this week · ${inBundle}/${scorecard.optionalQuota}`;
  }
  if (scorecard.evaluation.isComplete) return "Done";

  const required = scorecard.members.filter(
    (member) => member.role === "required",
  );
  const done = required.filter(
    (member) => member.evaluation.isComplete,
  ).length;
  return required.length > 0 ? `${done} of ${required.length}` : "Not done";
}
