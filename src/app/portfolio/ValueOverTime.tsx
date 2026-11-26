"use client";

import { useId, useMemo, useState, type MouseEvent } from "react";
import {
  buildTimeline,
  dateFromDayNumber,
  type TimelineGap,
  type TimelineInputPoint,
  type TimelineSeries,
} from "@/lib/portfolioTimeline";
import { niceTicks, useElementSize } from "./ReturnBars";

const MARGIN = { top: 16, right: 64, bottom: 28, left: 56 };
const OTHER_ID = "\u0000other";
const MAX_LISTED_GAPS = 8;

type Band = {
  id: string;
  label: string;
  color: string;
  members: string[];
  lower: number[];
  upper: number[];
};

type Hover =
  | { kind: "point"; index: number; x: number }
  | { kind: "gap"; gap: TimelineGap; x: number };

function colorFor(series: TimelineSeries): string {
  return series.slot === null
    ? "var(--series-other)"
    : `var(--series-${series.slot + 1})`;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCompactCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: value >= 1_000 ? 1 : 0,
  }).format(value);
}

function formatDate(
  date: string,
  options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  },
): string {
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00.000Z`));
}

function formatMissingRange(gap: TimelineGap): string {
  const short: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return gap.firstMissing === gap.lastMissing
    ? formatDate(gap.firstMissing, short)
    : `${formatDate(gap.firstMissing, short)} – ${formatDate(gap.lastMissing, short)}`;
}

function pluralizeWeekdays(count: number): string {
  return `${count} weekday${count === 1 ? "" : "s"}`;
}

export function ValueOverTime({
  points,
  windowStart,
  today,
  hidden,
  onHiddenChange,
  onHoverTicker,
}: {
  points: TimelineInputPoint[];
  windowStart: string | null;
  today: string;
  hidden: ReadonlySet<string>;
  onHiddenChange: (hidden: Set<string>) => void;
  onHoverTicker?: (ticker: string | null) => void;
}) {
  const patternId = useId();
  const [containerRef, { width, height }] = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<Hover | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);

  const timeline = useMemo(
    () => buildTimeline(points, { windowStart, today }),
    [points, today, windowStart],
  );

  const { bands, totals } = useMemo(() => {
    const visible = timeline.series.filter((series) => !hidden.has(series.key));
    const running = timeline.dates.map(() => 0);
    const stack = (
      id: string,
      label: string,
      color: string,
      members: TimelineSeries[],
    ): Band => {
      const lower = [...running];
      for (const member of members) {
        member.values.forEach((value, index) => {
          running[index]! += value;
        });
      }
      return {
        id,
        label,
        color,
        members: members.map((member) => member.key),
        lower,
        upper: [...running],
      };
    };
    const nextBands = visible
      .filter((series) => series.slot !== null)
      .map((series) =>
        stack(series.key, series.label, colorFor(series), [series]),
      );
    const rest = visible.filter((series) => series.slot === null);
    if (rest.length > 0) {
      nextBands.push(
        stack(
          OTHER_ID,
          rest.length === 1 ? rest[0]!.label : `Other (${rest.length})`,
          "var(--series-other)",
          rest,
        ),
      );
    }
    return { bands: nextBands, totals: running };
  }, [hidden, timeline]);

  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);
  const [domainStart, domainEnd] = timeline.domain;
  const yMax = Math.max(1, ...totals) * 1.05;
  const xFor = (day: number) =>
    MARGIN.left + ((day - domainStart) / (domainEnd - domainStart)) * plotWidth;
  const yFor = (value: number) => MARGIN.top + (1 - value / yMax) * plotHeight;

  const xTicks = useMemo(() => {
    const count = Math.min(8, Math.max(2, Math.floor(plotWidth / 110)));
    const spansYears =
      dateFromDayNumber(domainStart).slice(0, 4) !==
      dateFromDayNumber(domainEnd).slice(0, 4);
    const days = new Set<number>();
    for (let index = 0; index < count; index += 1) {
      days.add(
        Math.round(
          domainStart + ((domainEnd - domainStart) * index) / (count - 1),
        ),
      );
    }
    return [...days].map((day) => ({
      day,
      label: formatDate(
        dateFromDayNumber(day),
        spansYears
          ? { month: "short", year: "2-digit" }
          : { month: "short", day: "numeric" },
      ),
    }));
  }, [domainEnd, domainStart, plotWidth]);

  const highlightedBand =
    highlightKey === null
      ? null
      : (bands.find((band) => band.members.includes(highlightKey))?.id ?? null);

  const handleMove = (event: MouseEvent<SVGSVGElement>) => {
    if (timeline.days.length === 0 || plotWidth <= 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const day =
      domainStart +
      ((event.clientX - bounds.left - MARGIN.left) / plotWidth) *
        (domainEnd - domainStart);
    let nearest = 0;
    timeline.days.forEach((candidate, index) => {
      if (Math.abs(candidate - day) < Math.abs(timeline.days[nearest]! - day)) {
        nearest = index;
      }
    });
    const gap =
      Math.abs(timeline.days[nearest]! - day) > 0.5
        ? timeline.gaps.find(
            (candidate) => day > candidate.fromDay && day < candidate.toDay,
          )
        : undefined;
    setHover(
      gap
        ? {
            kind: "gap",
            gap,
            x: Math.min(
              xFor(gap.toDay),
              Math.max(xFor(gap.fromDay), xFor(day)),
            ),
          }
        : { kind: "point", index: nearest, x: xFor(timeline.days[nearest]!) },
    );
  };

  const setHighlight = (key: string | null) => {
    setHighlightKey(key);
    onHoverTicker?.(key);
  };

  const toggle = (event: MouseEvent<HTMLButtonElement>, key: string) => {
    const allKeys = timeline.series.map((series) => series.key);
    if (event.shiftKey) {
      const isSolo = allKeys.every(
        (candidate) => hidden.has(candidate) === (candidate !== key),
      );
      onHiddenChange(
        isSolo
          ? new Set()
          : new Set(allKeys.filter((candidate) => candidate !== key)),
      );
      return;
    }
    const next = new Set(hidden);
    if (!next.delete(key)) next.add(key);
    onHiddenChange(next);
  };

  const hiddenCount = timeline.series.filter((series) =>
    hidden.has(series.key),
  ).length;
  const ownSeries = timeline.series.filter((series) => series.slot !== null);
  const otherSeries = timeline.series.filter((series) => series.slot === null);
  const missingWeekdays = timeline.gaps.reduce(
    (sum, gap) => sum + gap.missingWeekdays,
    0,
  );
  const lastIndex = timeline.days.length - 1;

  const renderChip = (series: TimelineSeries) => {
    const isHidden = hidden.has(series.key);
    return (
      <button
        key={series.key}
        type="button"
        aria-pressed={!isHidden}
        onClick={(event) => toggle(event, series.key)}
        onMouseEnter={() => setHighlight(series.key)}
        onMouseLeave={() => setHighlight(null)}
        onFocus={() => setHighlight(series.key)}
        onBlur={() => setHighlight(null)}
        title={`${series.name || series.label} · latest ${formatCurrency(series.latestValue)}\nClick to ${isHidden ? "show" : "hide"}; Shift-click to show only this`}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
          isHidden
            ? "border-dashed border-(--card-border) text-(--muted)"
            : "border-(--card-border) bg-background text-foreground"
        } hover:border-(--muted)`}
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-[3px] border"
          style={{
            borderColor: colorFor(series),
            backgroundColor: isHidden ? "transparent" : colorFor(series),
          }}
        />
        <span className={`font-semibold ${isHidden ? "line-through" : ""}`}>
          {series.label}
        </span>
        <span className="tabular-nums text-(--muted)">
          {formatCompactCurrency(series.latestValue)}
        </span>
      </button>
    );
  };

  return (
    <div>
      <div className="border-b border-(--card-border) px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-(--muted)">
          <span>
            {hiddenCount === 0
              ? `Showing all ${timeline.series.length} holdings`
              : `Showing ${timeline.series.length - hiddenCount} of ${timeline.series.length} holdings`}
          </span>
          <button
            type="button"
            onClick={() => onHiddenChange(new Set())}
            disabled={hiddenCount === 0}
            className="font-medium text-accent disabled:cursor-default disabled:text-(--muted) disabled:opacity-60"
          >
            Show all
          </button>
          <button
            type="button"
            onClick={() =>
              onHiddenChange(
                new Set(timeline.series.map((series) => series.key)),
              )
            }
            disabled={hiddenCount === timeline.series.length}
            className="font-medium text-accent disabled:cursor-default disabled:text-(--muted) disabled:opacity-60"
          >
            Hide all
          </button>
          <span className="hidden sm:inline">
            Click a holding to hide or show it · Shift-click to show only it
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {ownSeries.map(renderChip)}
          {otherSeries.length > 0 ? (
            <>
              <span className="ml-1 text-xs text-(--muted)">
                Stacked together as Other:
              </span>
              {otherSeries.map(renderChip)}
            </>
          ) : null}
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative h-[52vh] min-h-[380px] w-full"
        onMouseLeave={() => setHover(null)}
      >
        {timeline.days.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-(--muted)">
            {points.length === 0
              ? "No complete snapshots have been recorded yet."
              : `No complete snapshots in this range. The latest one is from ${formatDate(
                  [...points]
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .at(-1)!.date,
                )}.`}
          </div>
        ) : width > 0 && height > 0 ? (
          <svg
            width={width}
            height={height}
            onMouseMove={handleMove}
            role="img"
            aria-label="Stacked value of each holding over time"
          >
            <defs>
              <pattern
                id={patternId}
                width={8}
                height={8}
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width={8} height={8} fill="var(--muted)" opacity={0.08} />
                <line
                  x1={0}
                  x2={0}
                  y1={0}
                  y2={8}
                  stroke="var(--muted)"
                  strokeWidth={2}
                  opacity={0.35}
                />
              </pattern>
            </defs>

            {niceTicks(0, yMax, 5).map((tick) => (
              <g key={tick}>
                <line
                  x1={MARGIN.left}
                  x2={MARGIN.left + plotWidth}
                  y1={yFor(tick)}
                  y2={yFor(tick)}
                  stroke="var(--card-border)"
                  strokeWidth={1}
                />
                <text
                  x={MARGIN.left - 8}
                  y={yFor(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fill="var(--muted)"
                  fontSize={11}
                >
                  {formatCompactCurrency(tick)}
                </text>
              </g>
            ))}
            {xTicks.map(({ day, label }) => (
              <text
                key={day}
                x={xFor(day)}
                y={height - MARGIN.bottom + 18}
                textAnchor="middle"
                fill="var(--muted)"
                fontSize={11}
              >
                {label}
              </text>
            ))}

            {timeline.gaps.map((gap) => {
              const x = xFor(gap.fromDay);
              const gapWidth = xFor(gap.toDay) - x;
              const before = timeline.days.indexOf(gap.fromDay);
              const after = timeline.days.indexOf(gap.toDay);
              return (
                <g key={`${gap.kind}-${gap.fromDay}`} pointerEvents="none">
                  <rect
                    x={x}
                    y={MARGIN.top}
                    width={gapWidth}
                    height={plotHeight}
                    fill={`url(#${patternId})`}
                  />
                  {gap.kind === "between" && before >= 0 && after >= 0 ? (
                    <line
                      x1={x}
                      x2={x + gapWidth}
                      y1={yFor(totals[before]!)}
                      y2={yFor(totals[after]!)}
                      stroke="var(--muted)"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                    />
                  ) : null}
                  {gapWidth >= 52 ? (
                    <text
                      x={x + gapWidth / 2}
                      y={MARGIN.top + 14}
                      textAnchor="middle"
                      fill="var(--muted)"
                      fontSize={11}
                      fontWeight={600}
                    >
                      No data
                    </text>
                  ) : null}
                </g>
              );
            })}

            {bands.map((band) => (
              <g
                key={band.id}
                opacity={
                  highlightedBand !== null && highlightedBand !== band.id
                    ? 0.3
                    : 1
                }
                pointerEvents="none"
              >
                {timeline.segments.map(([start, end]) => {
                  if (start === end) {
                    // A snapshot with gaps on both sides has no neighbour to
                    // connect to, so it is drawn as a sliver.
                    const top = yFor(band.upper[start]!);
                    const bottom = yFor(band.lower[start]!);
                    return (
                      <rect
                        key={start}
                        x={xFor(timeline.days[start]!) - 2}
                        y={top}
                        width={4}
                        height={Math.max(0, bottom - top)}
                        fill={band.color}
                      />
                    );
                  }
                  const indexes = Array.from(
                    { length: end - start + 1 },
                    (_, offset) => start + offset,
                  );
                  const path = [
                    ...indexes.map(
                      (index, position) =>
                        `${position === 0 ? "M" : "L"}${xFor(timeline.days[index]!)},${yFor(band.upper[index]!)}`,
                    ),
                    ...indexes
                      .reverse()
                      .map(
                        (index) =>
                          `L${xFor(timeline.days[index]!)},${yFor(band.lower[index]!)}`,
                      ),
                    "Z",
                  ].join(" ");
                  return (
                    <path
                      key={start}
                      d={path}
                      fill={band.color}
                      stroke="var(--card-bg)"
                      strokeWidth={1}
                      strokeLinejoin="round"
                    />
                  );
                })}
                {yFor(band.lower[lastIndex]!) - yFor(band.upper[lastIndex]!) >=
                13 ? (
                  <text
                    x={xFor(timeline.days[lastIndex]!) + 6}
                    y={
                      (yFor(band.lower[lastIndex]!) +
                        yFor(band.upper[lastIndex]!)) /
                      2
                    }
                    dominantBaseline="middle"
                    fill="var(--foreground)"
                    fontSize={11}
                    fontWeight={600}
                  >
                    {band.id === OTHER_ID && band.members.length > 1
                      ? "Other"
                      : band.label}
                  </text>
                ) : null}
              </g>
            ))}

            <line
              x1={MARGIN.left}
              x2={MARGIN.left + plotWidth}
              y1={yFor(0)}
              y2={yFor(0)}
              stroke="var(--muted)"
              strokeWidth={1}
            />
            {hover ? (
              <line
                x1={hover.x}
                x2={hover.x}
                y1={MARGIN.top}
                y2={MARGIN.top + plotHeight}
                stroke="var(--foreground)"
                strokeWidth={1}
                strokeDasharray={hover.kind === "gap" ? "3 3" : undefined}
                pointerEvents="none"
              />
            ) : null}
          </svg>
        ) : null}

        {bands.length === 0 && timeline.days.length > 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-(--muted)">
            Every holding is hidden.
          </div>
        ) : null}

        {hover ? (
          <div
            className="pointer-events-none absolute top-3 z-10 w-60 rounded-lg border border-(--card-border) bg-(--card-bg) p-3 text-xs shadow-lg"
            style={
              hover.x > width / 2
                ? { right: width - hover.x + 12 }
                : { left: hover.x + 12 }
            }
          >
            {hover.kind === "gap" ? (
              <>
                <p className="font-semibold">No complete snapshot</p>
                <p className="mt-1 text-(--muted)">
                  {formatMissingRange(hover.gap)} ·{" "}
                  {pluralizeWeekdays(hover.gap.missingWeekdays)} missing
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold">
                  {formatDate(timeline.dates[hover.index]!)}
                </p>
                <div className="mt-2 space-y-1">
                  {[...bands].reverse().map((band) => {
                    const value =
                      band.upper[hover.index]! - band.lower[hover.index]!;
                    const total = totals[hover.index]!;
                    return (
                      <div key={band.id} className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                          style={{ backgroundColor: band.color }}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {band.label}
                        </span>
                        <span className="font-medium tabular-nums">
                          {formatCurrency(value)}
                        </span>
                        <span className="w-9 text-right tabular-nums text-(--muted)">
                          {total > 0
                            ? `${((value / total) * 100).toFixed(0)}%`
                            : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex justify-between border-t border-(--card-border) pt-2 font-semibold">
                  <span>{hiddenCount > 0 ? "Shown total" : "Total"}</span>
                  <span className="tabular-nums">
                    {formatCurrency(totals[hover.index]!)}
                  </span>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>

      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-(--card-border) px-4 py-3 text-xs text-(--muted)"
        title="A day is only charted when every account in scope has a snapshot for it."
      >
        <svg
          width={14}
          height={14}
          aria-hidden
          className="shrink-0 rounded-[3px]"
        >
          <rect width={14} height={14} fill={`url(#${patternId})`} />
        </svg>
        {timeline.days.length === 0 ? (
          <span>Nothing to chart in this range.</span>
        ) : timeline.gaps.length === 0 ? (
          <span>
            No missing data: every weekday in this range has a complete
            snapshot.
          </span>
        ) : (
          <>
            <span className="font-semibold text-foreground">
              {pluralizeWeekdays(missingWeekdays)} without a complete snapshot:
            </span>
            {timeline.gaps.slice(-MAX_LISTED_GAPS).map((gap) => (
              <span
                key={`${gap.kind}-${gap.fromDay}`}
                className="rounded border border-(--card-border) px-1.5 py-0.5 tabular-nums"
              >
                {formatMissingRange(gap)}
              </span>
            ))}
            {timeline.gaps.length > MAX_LISTED_GAPS ? (
              <span>and {timeline.gaps.length - MAX_LISTED_GAPS} earlier</span>
            ) : null}
          </>
        )}
        {timeline.historyStart &&
        (windowStart === null || timeline.historyStart > windowStart) ? (
          <span>
            · Snapshot history begins{" "}
            {formatDate(timeline.historyStart, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
            .
          </span>
        ) : null}
      </div>
    </div>
  );
}
