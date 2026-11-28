"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  buildIntradaySeries,
  stackDiverging,
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

function colorFor(rank: number, ownBands = OWN_COLORS): string {
  return rank < ownBands ? `var(--series-${rank + 1})` : "var(--series-other)";
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
      "Dollars gained or lost since the previous close, stacked: gains above the line, losses below, and the net as a line.",
  },
];

const MIN_OWN_BANDS = 3;
const OTHER_KEY = "\u0000other";

function clampOwnBands(value: number): number {
  return Math.min(OWN_COLORS, Math.max(MIN_OWN_BANDS, Math.round(value)));
}

type SortColumn = "name" | "price" | "percent" | "change";
type Sort = { column: SortColumn; descending: boolean };
type Prefs = { mode: Mode; sort: Sort; ownBands: number };

const SORT_COLUMNS: SortColumn[] = ["name", "price", "percent", "change"];
const DEFAULT_PREFS: Prefs = {
  mode: "percent",
  sort: { column: "change", descending: true },
  ownBands: 12,
};

function readPrefs(): Prefs {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as {
      mode?: unknown;
      ownBands?: unknown;
      sort?: { column?: unknown; descending?: unknown };
    };
    const column = SORT_COLUMNS.find(
      (candidate) => candidate === stored.sort?.column,
    );
    return {
      mode: stored.mode === "dollars" ? "dollars" : "percent",
      ownBands:
        typeof stored.ownBands === "number" && Number.isFinite(stored.ownBands)
          ? clampOwnBands(stored.ownBands)
          : DEFAULT_PREFS.ownBands,
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
  /** A holding's ticker, or OTHER_KEY for the combined smaller holdings. */
  key: string;
  label: string;
  color: string;
  members: IntradaySeries[];
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
  const { mode, sort, ownBands } = prefs;
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
  // Colours go to holdings with a live price, largest first, so they are not
  // spent on ones that have no line to draw.
  const liveRanks = useMemo(
    () =>
      new Map(
        allSeries
          .filter((series) => series.live)
          .map((series, rank) => [series.key, rank]),
      ),
    [allSeries],
  );
  const live = isSessionLive(session);
  const { times } = session;

  const { lines, total } = useMemo(() => {
    const visible = allSeries
      .map((series) => ({ series, rank: liveRanks.get(series.key) ?? null }))
      .filter(({ series }) => !hidden.has(series.key));
    const baseline = visible.reduce(
      (sum, { series }) => sum + series.baseline,
      0,
    );
    const values = times.map((_, index) =>
      visible.reduce((sum, { series }) => sum + series.values[index]!, 0),
    );
    // Only holdings with a live price have a path worth drawing. Stacked,
    // the smaller ones would be slivers, so they share one band; as lines
    // they all stay, in grey past the chosen number of colours.
    const drawable = visible.filter(({ rank }) => rank !== null);
    const combine =
      mode === "dollars"
        ? drawable.filter(({ rank }) => rank! >= ownBands)
        : [];
    const own =
      combine.length > 1
        ? drawable.filter((entry) => !combine.includes(entry))
        : drawable;
    const lineFor = (
      key: string,
      label: string,
      color: string,
      members: IntradaySeries[],
    ): Line => {
      const memberBaseline = members.reduce(
        (sum, member) => sum + member.baseline,
        0,
      );
      return {
        key,
        label,
        color,
        members,
        points: times.map((_, index) => {
          const value = members.reduce(
            (sum, member) => sum + member.values[index]!,
            0,
          );
          return mode === "percent"
            ? percentChange(value, memberBaseline)
            : value - memberBaseline;
        }),
      };
    };
    return {
      lines: [
        ...own.map(({ series, rank }) =>
          lineFor(series.key, series.label, colorFor(rank!, ownBands), [
            series,
          ]),
        ),
        ...(combine.length > 1
          ? [
              lineFor(
                OTHER_KEY,
                `Other (${combine.length})`,
                "var(--series-other)",
                combine.map(({ series }) => series),
              ),
            ]
          : []),
      ],
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
  }, [allSeries, hidden, liveRanks, mode, ownBands, times]);

  // The drawn line a highlighted holding belongs to, which for the smaller
  // holdings is the shared "Other" line.
  const activeLineKey =
    lines.find(
      (line) =>
        line.key === activeKey ||
        line.members.some((member) => member.key === activeKey),
    )?.key ?? null;
  const otherKeys = new Set(
    lines
      .find((line) => line.key === OTHER_KEY)
      ?.members.map((member) => member.key),
  );
  // Pointing at the Other band, or at any holding inside it, marks them all.
  const otherActive = activeLineKey === OTHER_KEY;
  const setOwnBands = (next: number) =>
    setPrefs((current) => ({ ...current, ownBands: clampOwnBands(next) }));

  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);
  // In dollars each holding is a band: gains pile up above the previous
  // close and losses below it, so the outer edges are the day's total gain
  // and total loss.
  const stack = useMemo(() => {
    const stackedLines = stacked ? lines : [];
    const result = stackDiverging(
      times,
      stackedLines.map((line) => line.points),
    );
    return {
      times: result.times,
      bands: result.bands.map((band, index) => ({
        ...band,
        line: stackedLines[index]!,
      })),
    };
  }, [lines, stacked, times]);
  const bands = stack.bands;

  const allPoints = stacked
    ? [
        ...total.points,
        ...bands.flatMap((band) => [...band.lower, ...band.upper]),
      ]
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
      // The stack has extra times where a holding crosses zero.
      let at = 0;
      stack.times.forEach((candidate, index) => {
        if (Math.abs(candidate - time) < Math.abs(stack.times[at]! - time)) {
          at = index;
        }
      });
      closest =
        time >= times[0]! && time <= times.at(-1)!
          ? (bands.find(
              (band) => value >= band.lower[at]! && value < band.upper[at]!,
            )?.line.key ?? null)
          : null;
    } else if (time >= times[0]! - span && time <= times.at(-1)! + span) {
      for (const line of lines) {
        const value =
          line.points[left]! + (line.points[right]! - line.points[left]!) * mix;
        const distance = Math.abs(yFor(value) - pointerY);
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = line.key;
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
  // A label beside the latest point. When it would run off the right edge it
  // sits to the left of the point instead, outlined so it reads over the chart.
  const endLabel = (text: string, y: number, weight: number, key?: string) => {
    const tipX = xFor(times[lastIndex]!);
    const fits = tipX + 9 + text.length * 6.5 <= width - 2;
    return (
      <text
        key={key}
        x={fits ? tipX + 9 : tipX - 9}
        y={y}
        textAnchor={fits ? "start" : "end"}
        dominantBaseline="middle"
        fill="var(--foreground)"
        fontSize={11}
        fontWeight={weight}
        stroke="var(--card-bg)"
        strokeWidth={fits ? 0 : 3}
        paintOrder="stroke"
        strokeLinejoin="round"
      >
        {text}
      </text>
    );
  };
  const totalChange = total.latestValue - total.baseline;
  const totalPercent = percentChange(total.latestValue, total.baseline);
  const rows = allSeries
    .map((series) => ({
      series,
      color: otherKeys.has(series.key)
        ? "var(--series-other)"
        : colorFor(liveRanks.get(series.key) ?? 0, ownBands),
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
            (line, index) => index < TOOLTIP_ROWS || line.key === pointedKey,
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
          <p className="min-w-0 flex-1 truncate text-xs text-(--muted)">
            {MODES.find((option) => option.value === mode)!.caption}
          </p>
          <div
            className="flex shrink-0 items-center gap-1 text-xs text-(--muted)"
            title="How many of the largest holdings get their own colour. The rest are grey: separate lines in % change, one combined Other band in $ change."
          >
            <span style={{ order: 0 }}>Own colour</span>
            {(
              [
                ["Fewer holdings with their own colour", ownBands - 1, "−"],
                ["More holdings with their own colour", ownBands + 1, "+"],
              ] as const
            ).map(([label, next, glyph], index) => (
              <button
                key={label}
                type="button"
                onClick={() => setOwnBands(next)}
                disabled={clampOwnBands(next) === ownBands}
                aria-label={label}
                title={label}
                style={{ order: index === 0 ? 1 : 3 }}
                className="flex h-5 w-5 items-center justify-center rounded hover:bg-(--hover) hover:text-foreground disabled:opacity-35 disabled:hover:bg-transparent"
              >
                {glyph}
              </button>
            ))}
            <span
              className="w-5 text-center font-semibold text-foreground"
              style={{ order: 2 }}
            >
              {ownBands}
            </span>
          </div>
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
                  bands.map(({ line, lower, upper, runs }) => {
                    const lastAt = stack.times.length - 1;
                    const isActive = activeLineKey === line.key;
                    return (
                      <g
                        key={line.key}
                        opacity={activeLineKey !== null && !isActive ? 0.25 : 1}
                      >
                        {runs.map((run) => (
                          <path
                            key={run[0]!.time}
                            d={[
                              ...run.map(
                                (point, index) =>
                                  `${index === 0 ? "M" : "L"}${xFor(point.time).toFixed(1)},${yFor(point.upper).toFixed(1)}`,
                              ),
                              ...[...run]
                                .reverse()
                                .map(
                                  (point) =>
                                    `L${xFor(point.time).toFixed(1)},${yFor(point.lower).toFixed(1)}`,
                                ),
                              "Z",
                            ].join(" ")}
                            fill={line.color}
                            stroke="var(--card-bg)"
                            strokeWidth={1}
                            strokeLinejoin="round"
                          />
                        ))}
                        {isActive
                          ? endLabel(
                              `${line.label} ${formatPoint(line.points[lastIndex]!)}`,
                              (yFor(lower[lastAt]!) + yFor(upper[lastAt]!)) / 2,
                              600,
                            )
                          : null}
                      </g>
                    );
                  })
                ) : (
                  <>
                    {lines.map((line) => {
                      const dimmed =
                        activeLineKey !== null && activeLineKey !== line.key;
                      const emphasized = activeLineKey === line.key;
                      return (
                        <path
                          key={line.key}
                          d={pathFor(line.points)}
                          fill="none"
                          stroke={line.color}
                          strokeWidth={emphasized ? 2.5 : 1.25}
                          strokeLinejoin="round"
                          opacity={dimmed ? 0.15 : emphasized ? 1 : 0.8}
                        />
                      );
                    })}
                    {lines
                      .filter((line) => line.key === activeLineKey)
                      .map((line) =>
                        endLabel(
                          line.label,
                          yFor(line.points[lastIndex]!) +
                            (line.points[lastIndex]! >= total.points[lastIndex]!
                              ? -12
                              : 12),
                          600,
                          line.key,
                        ),
                      )}
                  </>
                )}
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
                  opacity={activeLineKey === null ? 1 : 0.35}
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
                {/* A highlighted holding labels itself in the same spot. */}
                {activeLineKey !== null
                  ? null
                  : endLabel(
                      `${stacked ? "Net" : "Total"} ${formatPoint(total.points[lastIndex]!)}`,
                      yFor(total.points[lastIndex]!),
                      700,
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
                    key={line.key}
                    className={`flex items-center gap-2 ${
                      line.key === pointedKey ? "font-bold" : ""
                    }`}
                  >
                    <span
                      className="h-0.5 w-3 shrink-0 rounded"
                      style={{ backgroundColor: line.color }}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {line.label}
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
          {rows.map(({ series, color, change, percent }) => {
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
                  pointedKey === series.key ||
                  (otherActive && otherKeys.has(series.key))
                    ? "bg-(--hover) shadow-[inset_3px_0_0_var(--foreground)]"
                    : ""
                }`}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="h-0.5 w-3 shrink-0 rounded"
                    style={{
                      backgroundColor: series.live ? color : "transparent",
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
