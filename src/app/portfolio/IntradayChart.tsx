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
const MODE_KEY = "tasky-portfolio-intraday-mode";
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
      "Dollars gained or lost since the previous close: shares held × price move.",
  },
];

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "dollars" ? "dollars" : "percent";
  } catch {
    return "percent";
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
  const [mode, setMode] = useState<Mode>(readMode);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const activeKey = pointedKey ?? highlightKey;
  const selectMode = (next: Mode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Storage can be unavailable; the choice then lasts for this visit.
    }
  };
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
  const allPoints = [...total.points, ...lines.flatMap((line) => line.points)];
  const rawMin = Math.min(0, ...allPoints);
  const rawMax = Math.max(0, ...allPoints);
  const padding = Math.max(
    mode === "percent" ? 0.05 : 1,
    (rawMax - rawMin) * 0.08,
  );
  const yMin = rawMin - padding;
  const yMax = rawMax + padding;
  const xFor = (time: number) =>
    MARGIN.left +
    ((time - session.sessionOpen) /
      (session.sessionClose - session.sessionOpen)) *
      plotWidth;
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
    const ticks = [session.sessionOpen];
    for (
      let tick = Math.ceil(session.sessionOpen / HOUR_MS) * HOUR_MS;
      tick <= session.sessionClose;
      tick += HOUR_MS
    ) {
      // Skip the first full hour: its label would collide with the open's.
      if (tick - session.sessionOpen >= HOUR_MS) ticks.push(tick);
    }
    return ticks;
  }, [session.sessionClose, session.sessionOpen]);

  const handleMove = (event: MouseEvent<SVGSVGElement>) => {
    if (times.length === 0 || plotWidth <= 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const time =
      session.sessionOpen +
      ((event.clientX - bounds.left - MARGIN.left) / plotWidth) *
        (session.sessionClose - session.sessionOpen);
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
    if (time >= times[0]! - span && time <= times.at(-1)! + span) {
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
    .sort(
      (a, b) =>
        // Holdings without a live price have no day move; keeping them last
        // stops them splitting the gainers from the losers.
        Number(b.series.live) - Number(a.series.live) ||
        b.change - a.change ||
        a.series.key.localeCompare(b.series.key),
    );
  const unpriced = allSeries.filter(
    (series) => !series.live && series.key !== "",
  );
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
              {hourTicks.map((tick, index) => (
                <text
                  key={tick}
                  x={xFor(tick)}
                  y={height - MARGIN.bottom + 16}
                  textAnchor={index === 0 ? "start" : "middle"}
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
            ? `Live · prices as of ${formatTime(session.lastTradeAt, true)} ET, refreshed every 5 seconds.`
            : `Market closed · showing the ${new Intl.DateTimeFormat("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              }).format(
                new Date(`${session.sessionDate}T12:00:00Z`),
              )} session.`}{" "}
          Prices are from the IEX exchange and can differ slightly from the
          consolidated tape.
          {unpriced.length > 0
            ? ` No live price for ${unpriced
                .map((series) => series.label)
                .join(", ")}; held at the last snapshot value.`
            : ""}
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
          <span>Holding</span>
          <span className="text-right">Price</span>
          <span className="text-right">Day</span>
          <span
            className="text-right"
            title="Sorted by dollar change today, biggest gain first"
          >
            Day $ ↓
          </span>
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
