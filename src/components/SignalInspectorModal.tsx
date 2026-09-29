"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { SignalTrendCharts } from "@/components/SignalTrendCharts";
import {
  formatSignalQuantity,
  getSignalPeriodBounds,
  getSignalQueryTime,
  SIGNAL_SOON_WINDOW_MS,
  signalPrimaryText,
  signalSecondaryText,
  type SignalDashboardItem,
  type SignalEntry,
} from "@/lib/signalDisplay";
import {
  useCachedConvexQuery,
  useRecentValue,
} from "@/lib/useCachedConvexQuery";

const MEASUREMENT_LABELS = {
  weight: "Weight",
  reps: "Reps",
  sets: "Sets",
  durationSeconds: "Duration",
  distance: "Distance",
} as const;

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  if (minutes === 0) return `${remainder}s`;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

function formatMeasurements(
  measurements: Extract<
    SignalEntry["operation"],
    { type: "activity.occurred" }
  >["measurements"],
): string | null {
  if (!measurements) return null;
  const parts = [
    measurements.weight === undefined
      ? null
      : `${formatSignalQuantity(measurements.weight)} lb`,
    measurements.reps === undefined ? null : `${measurements.reps} reps`,
    measurements.sets === undefined ? null : `${measurements.sets} sets`,
    measurements.durationSeconds === undefined
      ? null
      : formatDuration(measurements.durationSeconds),
    measurements.distance === undefined
      ? null
      : `${formatSignalQuantity(measurements.distance)} mi`,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function entrySummary(entry: SignalEntry): string {
  switch (entry.operation.type) {
    case "activity.occurred":
      return formatMeasurements(entry.operation.measurements) ?? "Completed";
    case "inventory.adjusted": {
      const prefix = entry.operation.amount > 0 ? "+" : "";
      return `${prefix}${formatSignalQuantity(
        entry.operation.amount,
      )} · ${formatSignalQuantity(entry.operation.resultingQuantity)} after`;
    }
    case "inventory.set":
      return `Set to ${formatSignalQuantity(
        entry.operation.quantity,
      )} · previously ${formatSignalQuantity(
        entry.operation.previousQuantity,
      )}`;
  }
}

function targetDescription(signal: SignalDashboardItem): string {
  if (signal.model.kind === "inventory") {
    const direction =
      signal.model.threshold.comparison === "atOrBelow"
        ? "at or below"
        : "at or above";
    return `${direction} ${formatSignalQuantity(
      signal.model.threshold.value,
    )} ${signal.model.unit}`;
  }
  if (!signal.model.target) return "No completion target";
  if (signal.model.target.type === "period") {
    return `${signal.model.target.targetCount} per ${signal.model.target.period}`;
  }
  const days = signal.model.target.dueAfterMs / (24 * 60 * 60 * 1000);
  return days >= 1
    ? `Every ${formatSignalQuantity(days)} day${days === 1 ? "" : "s"}`
    : `Every ${formatSignalQuantity(
        signal.model.target.dueAfterMs / (60 * 60 * 1000),
      )} hours`;
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-(--muted)">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-foreground">{value}</dd>
    </div>
  );
}

export function SignalInspectorModal({
  signal: initialSignal,
  now,
  cacheScope,
  onClose,
}: {
  signal: SignalDashboardItem;
  now: number;
  cacheScope: string;
  onClose: () => void;
}) {
  const mouseDownTargetRef = useRef<EventTarget | null>(null);
  const queryNow = getSignalQueryTime(now);
  const periodBounds = getSignalPeriodBounds(queryNow);
  const currentSignal = useCachedConvexQuery(
    api.signals.get,
    {
      signalId: initialSignal.id,
      now: queryNow,
      soonWindowMs: SIGNAL_SOON_WINDOW_MS,
      periodBounds,
    },
    `${cacheScope}:signal:${initialSignal.id}`,
  );
  const {
    results: liveEntries,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.signals.history,
    { signalId: initialSignal.id },
    { initialNumItems: 50 },
  );
  const recentEntries = useRecentValue(
    `${cacheScope}:signal-history:${initialSignal.id}`,
    status === "LoadingFirstPage" ? undefined : liveEntries,
  );
  const entries = recentEntries ?? [];
  const isLoadingHistory =
    status === "LoadingFirstPage" && recentEntries === undefined;
  const signal = currentSignal ?? initialSignal;

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const measurements =
    signal.model.kind === "activity"
      ? signal.model.measurementFields?.map(
          (field) => MEASUREMENT_LABELS[field],
        )
      : undefined;
  const flow =
    signal.model.kind === "inventory" && signal.model.flow
      ? `${signal.model.flow.amount > 0 ? "+" : ""}${formatSignalQuantity(
          signal.model.flow.amount,
        )} ${signal.model.unit} every ${formatSignalQuantity(
          signal.model.flow.everyDays,
        )} days`
      : null;

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center p-4 cursor-default"
      onMouseDown={(event) => {
        mouseDownTargetRef.current = event.target;
      }}
      onClick={(event) => {
        if (event.target === mouseDownTargetRef.current) onClose();
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="signal-inspector-title"
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-(--card-border) bg-(--card-bg) shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-(--card-border) px-6 py-5">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-(--muted)">
              {signal.model.kind === "activity" ? "Activity" : "Inventory"}
            </p>
            <h2
              id="signal-inspector-title"
              className="mt-1 truncate text-xl font-semibold"
            >
              {signal.name}
            </h2>
            <p className="mt-1 text-sm text-(--muted)">
              {signalPrimaryText(signal, now)}
              <span className="mx-1.5">·</span>
              {signalSecondaryText(signal, now)}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close signal details"
            className="rounded-lg p-2 text-(--muted) transition-colors hover:bg-(--card-border) hover:text-foreground"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        </header>

        <div className="overflow-y-auto">
          <section className="border-b border-(--card-border) px-6 py-5">
            <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Detail label="Target" value={targetDescription(signal)} />
              <Detail label="Status" value={signal.evaluation.reason} />
              {signal.model.kind === "inventory" ? (
                <>
                  <Detail
                    label="Confirmed"
                    value={`${formatSignalQuantity(
                      signal.model.confirmedQuantity,
                    )} ${signal.model.unit} on ${new Date(
                      signal.model.confirmedAt,
                    ).toLocaleString()}`}
                  />
                  {flow ? <Detail label="Automatic flow" value={flow} /> : null}
                </>
              ) : measurements && measurements.length > 0 ? (
                <Detail
                  label="Measurements"
                  value={measurements.join(", ")}
                />
              ) : null}
            </dl>

            {signal.tags.length > 0 || signal.scorecards.length > 0 ? (
              <div className="mt-5 flex flex-wrap gap-2">
                {signal.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{
                      backgroundColor: tag.color
                        ? `${tag.color}20`
                        : "var(--accent-subtle)",
                      color: tag.color || "var(--accent)",
                    }}
                  >
                    {tag.name}
                  </span>
                ))}
                {signal.scorecards.map((scorecard) => (
                  <Link
                    key={scorecard.id}
                    href={`/scorecards?expanded=${scorecard.id}`}
                    onClick={onClose}
                    className="inline-flex items-center gap-1 rounded-full bg-(--card-border) px-2 py-0.5 text-xs text-(--muted) transition-colors hover:text-foreground"
                  >
                    <span aria-hidden="true">◎</span>
                    {scorecard.name}
                  </Link>
                ))}
              </div>
            ) : null}
          </section>

          {entries.length > 0 ? (
            <SignalTrendCharts signal={signal} entries={entries} />
          ) : null}

          <section className="px-6 py-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Completion history</h3>
                <p className="mt-0.5 text-xs text-(--muted)">
                  Most recent first
                </p>
              </div>
              {entries.length > 0 ? (
                <span className="text-xs tabular-nums text-(--muted)">
                  {entries.length}
                  {status === "Exhausted" ? " total" : " loaded"}
                </span>
              ) : null}
            </div>

            {isLoadingHistory ? (
              <div className="flex items-center gap-2 py-8 text-sm text-(--muted)">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                Loading history...
              </div>
            ) : entries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-(--card-border) px-4 py-8 text-center text-sm text-(--muted)">
                No completions recorded yet.
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-(--card-border)">
                {entries.map((entry, index) => (
                  <div
                    key={entry.id}
                    className={`px-4 py-3 ${
                      index > 0 ? "border-t border-(--card-border)" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium">
                          {entrySummary(entry)}
                        </p>
                        {entry.operation.type === "activity.occurred" &&
                        entry.operation.note ? (
                          <p className="mt-1 text-sm text-(--muted)">
                            {entry.operation.note}
                          </p>
                        ) : null}
                      </div>
                      <time
                        dateTime={new Date(entry.effectiveAt).toISOString()}
                        className="shrink-0 text-right text-xs tabular-nums text-(--muted)"
                      >
                        {new Date(entry.effectiveAt).toLocaleDateString()}
                        <br />
                        {new Date(entry.effectiveAt).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    <p className="mt-2 text-xs capitalize text-(--muted)">
                      {entry.source}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {status === "CanLoadMore" || status === "LoadingMore" ? (
              <button
                onClick={() => loadMore(50)}
                disabled={status === "LoadingMore"}
                className="mt-4 w-full rounded-lg border border-(--card-border) px-4 py-2 text-sm font-medium text-(--muted) transition-colors hover:border-accent hover:text-foreground disabled:opacity-60"
              >
                {status === "LoadingMore" ? "Loading..." : "Load more"}
              </button>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
