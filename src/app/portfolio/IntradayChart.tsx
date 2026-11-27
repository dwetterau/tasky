"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  buildIntradaySeries,
  isSessionLive,
  type IntradaySeries,
  type LiveHoldingInput,
  type LiveSession,
} from "@/lib/portfolioLive";
import { niceTicks, useElementSize } from "./ReturnBars";

const MARGIN = { top: 16, right: 76, bottom: 24, left: 52 };
// One per colour defined in globals.css; holdings past that share the grey.
const OWN_COLORS = 20;
const LINE_HOVER_PX = 12;
const PREFS_KEY = "tasky-portfolio-intraday";
const TOOLTIP_ROWS = 8;
const HOUR_MS = 3_600_000;
const NEW_YORK = "America/New_York";

function colorFor(rank: number): string {
  return rank < OWN_COLORS
    ? `var(--series-${rank + 1})`
    : "var(--series-other)";
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatSignedCurrency(value: number): string {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
  }).format(Math.abs(value));
  return `${value >= 0 ? "+" : "-"}${formatted}`;
}

function formatPrice(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatTime(time: number, withSeconds = false): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    timeZone: NEW_YORK,
  }).format(new Date(time));
}

function toneClass(value: number): string {
  if (Math.abs(value) < 0.005) return "text-(--muted)";
  return value > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-600 dark:text-red-400";
}

function percentChange(value: number, baseline: number): number {
  return baseline > 0 ? (value / baseline - 1) * 100 : 0;
}

type Mode = "percent" | "dollars";

const MODES: Array<{ value: Mode; label: string; caption: string }> = [
  {
    value: "percent",
    label: "% change",
    caption: "Percent change since the previous close.",
  },
  {
    value: "dollars",
    label: "$ change",
    caption:
      "Dollars gained or lost since the previous close, stacked: gains above the line, losses below.",
  },
];

type SortColumn = "name" | "price" | "percent" | "change";
type Sort = { column: SortColumn; descending: boolean };
type Prefs = { mode: Mode; sort: Sort };

const SORT_COLUMNS: SortColumn[] = ["name", "price", "percent", "change"];
const DEFAULT_PREFS: Prefs = {
  mode: "percent",
  sort: { column: "change", descending: true },
};

function readPrefs(): Prefs {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as {
      mode?: unknown;
      sort?: { column?: unknown; descending?: unknown };
    };
    const column = SORT_COLUMNS.find(
      (candidate) => candidate === stored.sort?.column,
    );
    return {
      mode: stored.mode === "dollars" ? "dollars" : "percent",
      sort: column
        ? { column, descending: stored.sort?.descending !== false }
        : DEFAULT_PREFS.sort,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function formatCompactSignedCurrency(value: number): string {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Math.abs(value));
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${formatted}`;
}

type Line = {
  series: IntradaySeries;
  rank: number;
  color: string;
  points: number[];
};

export function IntradayChart({
  holdings,
  session,
  hidden,
  onHiddenChange,
}: {
  holdings: LiveHoldingInput[];
  session: LiveSession;
  hidden: ReadonlySet<string>;
  onHiddenChange: (hidden: Set<string>) => void;
}) {
  const [containerRef, { width, height }] = useElementSize<HTMLDivElement>();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  // The line under the pointer, as opposed to the table row under it.
  const [pointedKey, setPointedKey] = useState<string | null>(null);
  // Remembered per browser, so the chart reopens the way it was left.
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Storage can be unavailable; the settings then last for this visit.
    }
  }, [prefs]);
  const { mode, sort } = prefs;
  const stacked = mode === "dollars";
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const activeKey = pointedKey ?? highlightKey;
  const selectMode = (next: Mode) =>
    setPrefs((current) => ({ ...current, mode: next }));
  const formatPoint = mode === "percent" ? formatPercent : formatSignedCurrency;

  // Bring the pointed line's row into view without scrolling the page.
  useEffect(() => {
    const list = listRef.current;
    const row = pointedKey === null ? null : rowRefs.current.get(pointedKey);
    if (!list || !row) return;
    const top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + row.offsetHeight - list.clientHeight;
    }
  }, [pointedKey]);

  const allSeries = useMemo(
    () => buildIntradaySeries(holdings, session),
    [holdings, session],
  );
  const live = isSessionLive(session);
  const { times } = session;

  const { lines, total } = useMemo(() => {
    const ranked = allSeries.map((series, rank) => ({ series, rank }));
    const visible = ranked.filter(({ series }) => !hidden.has(series.key));
    const baseline = visible.reduce(
      (sum, { series }) => sum + series.baseline,
      0,
    );
    const values = times.map((_, index) =>
      visible.reduce((sum, { series }) => sum + series.values[index]!, 0),
    );
    return {
      // Only holdings with a live price have a path worth drawing.
      lines: visible
        .filter(({ series }) => series.live)
        .map(
          ({ series, rank }): Line => ({
            series,
            rank,
            color: colorFor(rank),
            points: series.values.map((value) =>
              mode === "percent"
                ? percentChange(value, series.baseline)
                : value - series.baseline,
            ),
          }),
        ),
      total: {
        baseline,
        values,
        latestValue: visible.reduce(
          (sum, { series }) => sum + series.latestValue,
          0,
        ),
        points: values.map((value) =>
          mode === "percent"
            ? percentChange(value, baseline)
            : value - baseline,
        ),
      },
    };
  }, [allSeries, hidden, mode, times]);

  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);
  // In dollars each holding is a band: gains pile up above the previous
  // close and losses below it, so the outer edges are the day's total gain
  // and total loss.
  const bands = useMemo(() => {
    if (!stacked) return [];
    const gains = times.map(() => 0);
    const losses = times.map(() => 0);
    return lines.map((line) => {
      const lower: number[] = [];
      const upper: number[] = [];
      line.points.forEach((point, index) => {
        const side = point >= 0 ? gains : losses;
        const from = side[index]!;
        side[index] = from + point;
        lower.push(Math.min(from, side[index]!));
        upper.push(Math.max(from, side[index]!));
      });
      return { line, lower, upper };
    });
  }, [lines, stacked, times]);

  const allPoints = stacked
    ? bands.flatMap((band) => [...band.lower, ...band.upper])
    : [...total.points, ...lines.flatMap((line) => line.points)];
  const rawMin = Math.min(0, ...allPoints);
  const rawMax = Math.max(0, ...allPoints);
  const padding = Math.max(
    mode === "percent" ? 0.05 : 1,
    (rawMax - rawMin) * 0.08,
  );
  const yMin = rawMin - padding;
  const yMax = rawMax + padding;
  // The axis spans regular hours while they are running, so the line grows
  // toward the close; pre-market and after-hours activity widen it, and once
  // the market has closed it ends at the last activity.
  const domainStart = Math.min(session.sessionOpen, times[0] ?? Infinity);
  const domainEnd =
    session.asOf <= session.sessionClose
      ? session.sessionClose
      : Math.max(session.sessionClose, times.at(-1) ?? 0);
  const xFor = (time: number) =>
    MARGIN.left +
    ((time - domainStart) / (domainEnd - domainStart)) * plotWidth;
  const yFor = (percent: number) =>
    MARGIN.top + ((yMax - percent) / (yMax - yMin)) * plotHeight;
  const pathFor = (points: number[]) =>
    points
      .map(
        (percent, index) =>
          `${index === 0 ? "M" : "L"}${xFor(times[index]!).toFixed(1)},${yFor(percent).toFixed(1)}`,
      )
      .join(" ");

  const hourTicks = useMemo(() => {
    const hours = (domainEnd - domainStart) / HOUR_MS;
    const step = hours > 0 && plotWidth / hours < 64 ? 2 * HOUR_MS : HOUR_MS;
    const ticks: number[] = [];
    for (
      let tick = Math.ceil(domainStart / step) * step;
      tick <= domainEnd;
      tick += step
    ) {
      ticks.push(tick);
    }
    return ticks;
  }, [domainEnd, domainStart, plotWidth]);
  const sessionMarkers = [
    { time: session.sessionOpen, label: "Open", extendsLeft: true },
    { time: session.sessionClose, label: "Close", extendsLeft: false },
  ].filter(({ time, extendsLeft }) =>
    // Only worth marking where the chart runs past it into extended hours.
    extendsLeft ? time > domainStart : time < domainEnd,
  );

  const handleMove = (event: MouseEvent<SVGSVGElement>) => {
    if (times.length === 0 || plotWidth <= 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const time =
      domainStart +
      ((event.clientX - bounds.left - MARGIN.left) / plotWidth) *
        (domainEnd - domainStart);
    let nearest = 0;
    times.forEach((candidate, index) => {
      if (Math.abs(candidate - time) < Math.abs(times[nearest]! - time)) {
        nearest = index;
      }
    });
    setHoverIndex(nearest);

    // Find the line passing closest under the pointer, reading each line's
    // height at the pointer's own time rather than at the nearest point.
    const after = times.findIndex((candidate) => candidate >= time);
    const right = after < 0 ? times.length - 1 : after;
    const left = Math.max(0, right - 1);
    const span = times[right]! - times[left]!;
    const mix =
      span > 0 ? Math.min(1, Math.max(0, (time - times[left]!) / span)) : 0;
    const pointerY = event.clientY - bounds.top;
    let closest: string | null = null;
    let closestDistance = LINE_HOVER_PX;
    if (stacked) {
      const value =
        yMax - ((pointerY - MARGIN.top) / plotHeight) * (yMax - yMin);
      closest =
        time >= times[0]! && time <= times.at(-1)!
          ? (bands.find(
              (band) =>
                value >= band.lower[nearest]! && value < band.upper[nearest]!,
            )?.line.series.key ?? null)
          : null;
    } else if (time >= times[0]! - span && time <= times.at(-1)! + span) {
      for (const line of lines) {
        const value =
          line.points[left]! + (line.points[right]! - line.points[left]!) * mix;
        const distance = Math.abs(yFor(value) - pointerY);
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = line.series.key;
        }
      }
    }
    setPointedKey(closest);
  };

  const toggle = (event: MouseEvent<HTMLButtonElement>, key: string) => {
    const allKeys = allSeries.map((series) => series.key);
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

  const lastIndex = times.length - 1;
  const totalChange = total.latestValue - total.baseline;
  const totalPercent = percentChange(total.latestValue, total.baseline);
  const rows = allSeries
    .map((series, rank) => ({
      series,
      rank,
      change: series.latestValue - series.baseline,
      percent: percentChange(series.latestValue, series.baseline),
    }))
    .sort((a, b) => {
      const order =
        sort.column === "name"
          ? a.series.label.localeCompare(b.series.label)
          : sort.column === "price"
            ? (a.series.latestPrice ?? 0) - (b.series.latestPrice ?? 0)
            : sort.column === "percent"
              ? a.percent - b.percent
              : a.change - b.change;
      return (
        // Holdings without a live price have no day move; keeping them last
        // stops them splitting the gainers from the losers.
        Number(b.series.live) - Number(a.series.live) ||
        (sort.descending ? -order : order) ||
        a.series.key.localeCompare(b.series.key)
      );
    });
  const sortHeader = (column: SortColumn, label: string) => {
    const active = sort.column === column;
    return (
      <button
        type="button"
        onClick={() =>
          setPrefs((current) => ({
            ...current,
            sort: {
              column,
              // Names start A to Z; amounts start largest first.
              descending: active ? !sort.descending : column !== "name",
            },
          }))
        }
        aria-pressed={active}
        title={`Click to sort${active ? " the other way" : ""}`}
        className={`flex items-center gap-0.5 uppercase tracking-wide hover:text-foreground ${
          column === "name" ? "" : "justify-end"
        } ${active ? "font-semibold text-foreground" : ""}`}
      >
        {label}
        <span aria-hidden className="w-2 text-[9px]">
          {active ? (sort.descending ? "▼" : "▲") : ""}
        </span>
      </button>
    );
  };
  const hiddenCount = allSeries.filter((series) =>
    hidden.has(series.key),
  ).length;
  const hoverX = hoverIndex === null ? null : xFor(times[hoverIndex]!);
  const tooltipLines =
    hoverIndex === null
      ? []
      : [...lines]
          .sort(
            (a, b) =>
              Math.abs(b.points[hoverIndex]!) - Math.abs(a.points[hoverIndex]!),
          )
          .filter(
            (line, index) =>
              index < TOOLTIP_ROWS || line.series.key === pointedKey,
          )
          .sort((a, b) => b.points[hoverIndex]! - a.points[hoverIndex]!);

  return (
    <div className="flex flex-col lg:flex-row">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3 border-b border-(--card-border) px-3 py-1.5">
          <div
            className="inline-flex shrink-0 rounded-md border border-(--card-border) bg-background p-0.5"
            role="tablist"
            aria-label="What the chart measures"
          >
            {MODES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={mode === option.value}
                onClick={() => selectMode(option.value)}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  mode === option.value
                    ? "bg-(--accent)/15 text-accent"
                    : "text-(--muted) hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="min-w-0 truncate text-xs text-(--muted)">
            {MODES.find((option) => option.value === mode)!.caption}
          </p>
        </div>
        <div
          ref={containerRef}
          className="relative h-[52vh] min-h-[380px] w-full"
          onMouseLeave={() => {
            setHoverIndex(null);
            setPointedKey(null);
          }}
        >
          {times.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-(--muted)">
              The market opens at {formatTime(session.sessionOpen)} ET. Prices
              on the right are the latest available.
            </div>
          ) : width > 0 && height > 0 ? (
            <svg
              width={width}
              height={height}
              onMouseMove={handleMove}
              role="img"
              aria-label="Change since the previous close, for the portfolio and each holding, through the trading day"
            >
              {niceTicks(yMin, yMax, 6).map((tick) => (
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
                    {mode === "percent"
                      ? `${tick > 0 ? "+" : ""}${Number(tick.toFixed(2))}%`
                      : formatCompactSignedCurrency(tick)}
                  </text>
                </g>
              ))}
              {sessionMarkers.map(({ time, label, extendsLeft }) => {
                const x = xFor(time);
                const edge = extendsLeft
                  ? MARGIN.left
                  : MARGIN.left + plotWidth;
                return (
                  <g key={label} pointerEvents="none">
                    <rect
                      x={Math.min(x, edge)}
                      y={MARGIN.top}
                      width={Math.abs(edge - x)}
                      height={plotHeight}
                      fill="var(--muted)"
                      opacity={0.07}
                    />
                    <line
                      x1={x}
                      x2={x}
                      y1={MARGIN.top - 4}
                      y2={MARGIN.top + plotHeight}
                      stroke="var(--muted)"
                      strokeWidth={1}
                    />
                    <text
                      x={x + (extendsLeft ? 5 : -5)}
                      y={MARGIN.top + 6}
                      textAnchor={extendsLeft ? "start" : "end"}
                      fill="var(--muted)"
                      fontSize={10}
                      fontWeight={600}
                    >
                      {`${label} ${formatTime(time)}`}
                    </text>
                  </g>
                );
              })}
              {hourTicks.map((tick) => (
                <text
                  key={tick}
                  x={xFor(tick)}
                  y={height - MARGIN.bottom + 16}
                  textAnchor="middle"
                  fill="var(--muted)"
                  fontSize={11}
                >
                  {formatTime(tick)}
                </text>
              ))}
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + plotWidth}
                y1={yFor(0)}
                y2={yFor(0)}
                stroke="var(--muted)"
                strokeWidth={1}
                strokeDasharray="4 3"
              />
              <text
                x={MARGIN.left + plotWidth}
                y={yFor(0) - 5}
                textAnchor="end"
                fill="var(--muted)"
                fontSize={10}
              >
                Previous close
              </text>

              <g pointerEvents="none">
                {stacked ? (
                  bands.map(({ line, lower, upper }) => {
                    const indexes = times.map((_, index) => index);
                    const path = [
                      ...indexes.map(
                        (index) =>
                          `${index === 0 ? "M" : "L"}${xFor(times[index]!).toFixed(1)},${yFor(upper[index]!).toFixed(1)}`,
                      ),
                      ...indexes
                        .reverse()
                        .map(
                          (index) =>
                            `L${xFor(times[index]!).toFixed(1)},${yFor(lower[index]!).toFixed(1)}`,
                        ),
                      "Z",
                    ].join(" ");
                    const isActive = activeKey === line.series.key;
                    return (
                      <g
                        key={line.series.key}
                        opacity={activeKey !== null && !isActive ? 0.25 : 1}
                      >
                        <path
                          d={path}
                          fill={line.color}
                          stroke="var(--card-bg)"
                          strokeWidth={1}
                          strokeLinejoin="round"
                        />
                        {isActive ? (
                          <text
                            x={xFor(times[lastIndex]!) + 9}
                            y={
                              (yFor(lower[lastIndex]!) +
                                yFor(upper[lastIndex]!)) /
                              2
                            }
                            dominantBaseline="middle"
                            fill="var(--foreground)"
                            fontSize={11}
                            fontWeight={600}
                          >
                            {`${line.series.label} ${formatPoint(line.points[lastIndex]!)}`}
                          </text>
                        ) : null}
                      </g>
                    );
                  })
                ) : (
                  <>
                    {lines.map((line) => {
                      const dimmed =
                        activeKey !== null && activeKey !== line.series.key;
                      const emphasized = activeKey === line.series.key;
                      return (
                        <path
                          key={line.series.key}
                          d={pathFor(line.points)}
                          fill="none"
                          stroke={line.color}
                          strokeWidth={emphasized ? 2.5 : 1.25}
                          strokeLinejoin="round"
                          opacity={dimmed ? 0.15 : emphasized ? 1 : 0.8}
                        />
                      );
                    })}
                    <path
                      d={pathFor(total.points)}
                      fill="none"
                      stroke="var(--card-bg)"
                      strokeWidth={6}
                      strokeLinejoin="round"
                    />
                    <path
                      d={pathFor(total.points)}
                      fill="none"
                      stroke="var(--foreground)"
                      strokeWidth={2.5}
                      strokeLinejoin="round"
                      opacity={activeKey === null ? 1 : 0.35}
                    />
                    {live ? (
                      <circle
                        cx={xFor(times[lastIndex]!)}
                        cy={yFor(total.points[lastIndex]!)}
                        r={9}
                        fill="var(--foreground)"
                        opacity={0.18}
                        className="animate-ping"
                        style={{
                          transformBox: "fill-box",
                          transformOrigin: "center",
                        }}
                      />
                    ) : null}
                    <circle
                      cx={xFor(times[lastIndex]!)}
                      cy={yFor(total.points[lastIndex]!)}
                      r={4}
                      fill="var(--foreground)"
                      stroke="var(--card-bg)"
                      strokeWidth={2}
                    />
                    <text
                      x={xFor(times[lastIndex]!) + 9}
                      y={yFor(total.points[lastIndex]!)}
                      dominantBaseline="middle"
                      fill="var(--foreground)"
                      fontSize={11}
                      fontWeight={700}
                    >
                      {`Total ${formatPoint(total.points[lastIndex]!)}`}
                    </text>
                    {lines
                      .filter((line) => line.series.key === activeKey)
                      .map((line) => (
                        <text
                          key={line.series.key}
                          x={xFor(times[lastIndex]!) + 9}
                          y={
                            yFor(line.points[lastIndex]!) +
                            (line.points[lastIndex]! >= total.points[lastIndex]!
                              ? -12
                              : 12)
                          }
                          dominantBaseline="middle"
                          fill="var(--foreground)"
                          fontSize={11}
                          fontWeight={600}
                        >
                          {line.series.label}
                        </text>
                      ))}
                  </>
                )}
                {hoverX !== null ? (
                  <line
                    x1={hoverX}
                    x2={hoverX}
                    y1={MARGIN.top}
                    y2={MARGIN.top + plotHeight}
                    stroke="var(--foreground)"
                    strokeWidth={1}
                    opacity={0.5}
                  />
                ) : null}
              </g>
            </svg>
          ) : null}

          {hoverIndex !== null && hoverX !== null ? (
            <div
              className="pointer-events-none absolute top-3 z-10 w-56 rounded-lg border border-(--card-border) bg-(--card-bg) p-3 text-xs shadow-lg"
              style={
                hoverX > width / 2
                  ? { right: width - hoverX + 12 }
                  : { left: hoverX + 12 }
              }
            >
              <p className="font-semibold">
                {formatTime(times[hoverIndex]!)} ET
              </p>
              <div className="mt-1.5 flex items-baseline justify-between gap-2 border-b border-(--card-border) pb-1.5">
                <span className="font-semibold">
                  {hiddenCount > 0 ? "Shown total" : "Total"}
                </span>
                <span className="tabular-nums">
                  {formatCurrency(total.values[hoverIndex]!)}{" "}
                  <span className={toneClass(total.points[hoverIndex]!)}>
                    {formatPoint(total.points[hoverIndex]!)}
                  </span>
                </span>
              </div>
              <div className="mt-1.5 space-y-1">
                {tooltipLines.map((line) => (
                  <div
                    key={line.series.key}
                    className={`flex items-center gap-2 ${
                      line.series.key === pointedKey ? "font-bold" : ""
                    }`}
                  >
                    <span
                      className="h-0.5 w-3 shrink-0 rounded"
                      style={{ backgroundColor: line.color }}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {line.series.label}
                    </span>
                    <span className="tabular-nums">
                      {formatPoint(line.points[hoverIndex]!)}
                    </span>
                  </div>
                ))}
                {lines.length > tooltipLines.length ? (
                  <p className="text-(--muted)">
                    Biggest moves of {lines.length} holdings
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <p className="border-t border-(--card-border) px-3 py-2 text-xs text-(--muted)">
          {live
            ? `${
                session.asOf < session.sessionOpen
                  ? "Live · pre-market"
                  : session.asOf > session.sessionClose
                    ? "Live · after hours"
                    : "Live"
              } · latest trade ${formatTime(session.lastTradeAt, true)} ET, refreshed every 5 seconds.`
            : `Market closed · showing the ${new Intl.DateTimeFormat("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              }).format(
                new Date(`${session.sessionDate}T12:00:00Z`),
              )} session.`}{" "}
          Last fetched {formatTime(session.asOf, true)} ET.
        </p>
      </div>

      <div className="shrink-0 border-t border-(--card-border) lg:w-[22rem] lg:border-l lg:border-t-0">
        <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_4rem_4.75rem] items-baseline gap-x-2 border-b border-(--card-border) px-3 py-2 text-xs">
          <span className="font-semibold">
            {hiddenCount > 0 ? "Shown total" : "Total"}
            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => onHiddenChange(new Set())}
                className="ml-2 font-medium text-accent"
              >
                Show all
              </button>
            ) : null}
          </span>
          <span className="text-right font-semibold tabular-nums">
            {formatCurrency(total.latestValue)}
          </span>
          <span
            className={`text-right font-semibold tabular-nums ${toneClass(totalPercent)}`}
          >
            {formatPercent(totalPercent)}
          </span>
          <span
            className={`text-right font-semibold tabular-nums ${toneClass(totalChange)}`}
          >
            {formatSignedCurrency(totalChange)}
          </span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_4rem_4.75rem] gap-x-2 px-3 pt-2 text-[11px] uppercase tracking-wide text-(--muted)">
          {sortHeader("name", "Holding")}
          {sortHeader("price", "Price")}
          {sortHeader("percent", "Day")}
          {sortHeader("change", "Day $")}
        </div>
        <div
          ref={listRef}
          className="max-h-[calc(52vh-3rem)] min-h-[320px] overflow-y-auto py-1"
          onMouseLeave={() => setHighlightKey(null)}
        >
          {rows.map(({ series, rank, change, percent }) => {
            const isHidden = hidden.has(series.key);
            return (
              <button
                key={series.key}
                ref={(element) => {
                  if (element) rowRefs.current.set(series.key, element);
                  else rowRefs.current.delete(series.key);
                }}
                type="button"
                aria-pressed={!isHidden}
                onClick={(event) => toggle(event, series.key)}
                onMouseEnter={() => setHighlightKey(series.key)}
                onFocus={() => setHighlightKey(series.key)}
                onBlur={() => setHighlightKey(null)}
                title={`${series.name || series.label}\nClick to ${isHidden ? "show" : "hide"}; Shift-click to show only this`}
                className={`grid w-full grid-cols-[minmax(0,1fr)_4.5rem_4rem_4.75rem] items-center gap-x-2 px-3 py-1 text-left text-xs hover:bg-(--hover) ${
                  isHidden ? "opacity-45" : ""
                } ${
                  pointedKey === series.key
                    ? "bg-(--hover) shadow-[inset_3px_0_0_var(--foreground)]"
                    : ""
                }`}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="h-0.5 w-3 shrink-0 rounded"
                    style={{
                      backgroundColor: series.live
                        ? colorFor(rank)
                        : "transparent",
                      outline: series.live
                        ? undefined
                        : "1px dashed var(--muted)",
                    }}
                  />
                  <span
                    className={`truncate font-semibold ${isHidden ? "line-through" : ""}`}
                  >
                    {series.label}
                  </span>
                </span>
                <span className="text-right tabular-nums text-(--muted)">
                  {formatPrice(series.live ? series.latestPrice : null)}
                </span>
                {series.live ? (
                  <>
                    <span
                      className={`text-right tabular-nums ${toneClass(percent)}`}
                    >
                      {formatPercent(percent)}
                    </span>
                    <span
                      className={`text-right tabular-nums ${toneClass(change)}`}
                    >
                      {formatSignedCurrency(change)}
                    </span>
                  </>
                ) : (
                  <span className="col-span-2 text-right text-(--muted)">
                    {series.key === "" ? "—" : "no live price"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
