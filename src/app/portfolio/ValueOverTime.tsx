"use client";

import {
  useEffect,
  useId,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  attributeChanges,
  type HoldingAttribution,
} from "../../../convex/lib/portfolioAttribution";
import {
  buildTimeline,
  dateFromDayNumber,
  seriesValuesFor,
  type TimelineGap,
  type TimelineInputPoint,
  type TimelineMode,
  type TimelineSeries,
} from "@/lib/portfolioTimeline";
import { niceTicks, useElementSize } from "./ReturnBars";

const MARGIN = { top: 12, right: 56, bottom: 24, left: 52 };
const OTHER_ID = "\u0000other";
/** One colour per band; see the --series-N variables in globals.css. */
const SERIES_COLORS = 20;
const MIN_OWN_BANDS = 3;
const DEFAULT_OWN_BANDS = 9;
const PREFS_KEY = "tasky-portfolio-over-time";

type SortColumn = "name" | "value" | "price" | "shares";
type Sort = { column: SortColumn; descending: boolean };
type ChartPrefs = { ownBands: number; sort: Sort };

const DEFAULT_PREFS: ChartPrefs = {
  ownBands: DEFAULT_OWN_BANDS,
  sort: { column: "value", descending: true },
};
const SORT_COLUMNS: SortColumn[] = ["name", "value", "price", "shares"];

function clampOwnBands(value: number): number {
  return Math.min(SERIES_COLORS, Math.max(MIN_OWN_BANDS, Math.round(value)));
}

function readPrefs(): ChartPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    if (typeof stored !== "object" || stored === null) return DEFAULT_PREFS;
    const { ownBands, sort } = stored as {
      ownBands?: unknown;
      sort?: { column?: unknown; descending?: unknown };
    };
    const column = SORT_COLUMNS.find((candidate) => candidate === sort?.column);
    return {
      ownBands:
        typeof ownBands === "number" && Number.isFinite(ownBands)
          ? clampOwnBands(ownBands)
          : DEFAULT_PREFS.ownBands,
      sort: column
        ? { column, descending: sort?.descending !== false }
        : DEFAULT_PREFS.sort,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}
const MAX_LISTED_GAPS = 8;
const OTHER_PREVIEW_COUNT = 4;
const TOOLTIP_OTHER_MEMBERS = 3;
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_4rem_4.25rem_4.25rem_4.5rem] items-center gap-x-2";

const MODES: Array<{ value: TimelineMode; label: string; caption: string }> = [
  {
    value: "value",
    label: "Value",
    caption: "What each holding was worth on the day.",
  },
  {
    value: "price",
    label: "Price only",
    caption:
      "Today's share counts at each day's price, so every slope is a price move.",
  },
  {
    value: "shares",
    label: "Shares only",
    caption:
      "Each day's share counts at today's price, so every step is shares bought, sold or otherwise changed.",
  },
];

type Band = {
  id: string;
  label: string;
  color: string;
  members: TimelineSeries[];
  lower: number[];
  upper: number[];
};

type Hover =
  | { kind: "point"; index: number; x: number; bandId: string | null }
  | { kind: "gap"; gap: TimelineGap; x: number };

type Effects = {
  startValue: number;
  endValue: number;
  priceEffect: number;
  quantityEffect: number;
};

const NO_EFFECTS: Effects = {
  startValue: 0,
  endValue: 0,
  priceEffect: 0,
  quantityEffect: 0,
};

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
  const magnitude = Math.abs(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: magnitude >= 1_000_000 ? 2 : magnitude >= 1_000 ? 1 : 0,
  }).format(value);
}

/** Changes too small to matter read as a dash instead of "+$0". */
function formatEffect(value: number): string {
  if (Math.abs(value) < 0.5) return "—";
  return `${value > 0 ? "+" : "−"}${formatCompactCurrency(Math.abs(value))}`;
}

function formatPrice(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 10 ? 4 : 2,
  }).format(value);
}

function formatShares(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value < 1_000 ? 2 : 0,
  }).format(value);
}

function formatRelativeChange(start: number, end: number): string | null {
  if (start <= 0 || end <= 0) return null;
  const percent = (end / start - 1) * 100;
  if (Math.abs(percent) < 0.005) return "unchanged";
  return `${percent > 0 ? "+" : "−"}${Math.abs(percent).toFixed(Math.abs(percent) < 10 ? 2 : 1)}%`;
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

const SHORT_DATE: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
};

function formatMissingRange(gap: TimelineGap): string {
  return gap.firstMissing === gap.lastMissing
    ? formatDate(gap.firstMissing, SHORT_DATE)
    : `${formatDate(gap.firstMissing, SHORT_DATE)} – ${formatDate(gap.lastMissing, SHORT_DATE)}`;
}

function pluralizeWeekdays(count: number): string {
  return `${count} weekday${count === 1 ? "" : "s"}`;
}

function priceTone(value: number): string {
  if (Math.abs(value) < 0.5) return "text-(--muted)";
  return value > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-600 dark:text-red-400";
}

function sharesTone(value: number): string {
  return Math.abs(value) < 0.5 ? "text-(--muted)" : "text-foreground";
}

function sumEffects(effects: Effects[]): Effects {
  return effects.reduce(
    (total, effect) => ({
      startValue: total.startValue + effect.startValue,
      endValue: total.endValue + effect.endValue,
      priceEffect: total.priceEffect + effect.priceEffect,
      quantityEffect: total.quantityEffect + effect.quantityEffect,
    }),
    NO_EFFECTS,
  );
}

/**
 * Two diverging bars on a shared zero line: the price move above, the share
 * change below, each as a fraction of the larger of the start and end value.
 * Lengths follow the square root of that fraction so that an ordinary few
 * percent stays visible next to a position that was halved.
 */
function SplitBar({ effects }: { effects: Effects }) {
  const scale = Math.max(effects.startValue, effects.endValue, 1);
  const half = 36;
  const bar = (value: number, y: number, fill: string, opacity = 1) => {
    const length = Math.sqrt(Math.min(1, Math.abs(value) / scale)) * half;
    if (length < 0.5) return null;
    return (
      <rect
        x={value < 0 ? half - length : half}
        y={y}
        width={length}
        height={5}
        rx={1}
        fill={fill}
        opacity={opacity}
      />
    );
  };
  return (
    <svg width={half * 2} height={16} aria-hidden className="shrink-0">
      <line
        x1={half}
        x2={half}
        y1={0}
        y2={16}
        stroke="var(--muted)"
        opacity={0.5}
        strokeWidth={1}
      />
      {bar(
        effects.priceEffect,
        2,
        effects.priceEffect < 0 ? "var(--loss)" : "var(--gain)",
      )}
      {bar(effects.quantityEffect, 9, "var(--foreground)", 0.6)}
    </svg>
  );
}

function Swatch({ color, filled }: { color: string; filled: boolean }) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-[3px] border"
      style={{
        borderColor: color,
        backgroundColor: filled ? color : "transparent",
      }}
    />
  );
}

export function ValueOverTime({
  points,
  windowStart,
  today,
  hidden,
  onHiddenChange,
}: {
  points: TimelineInputPoint[];
  windowStart: string | null;
  today: string;
  hidden: ReadonlySet<string>;
  onHiddenChange: (hidden: Set<string>) => void;
}) {
  const patternId = useId();
  const [containerRef, { width, height }] = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<Hover | null>(null);
  const [panelKey, setPanelKey] = useState<string | null>(null);
  const [mode, setMode] = useState<TimelineMode>("value");
  // Open by default: the list is how you see what "Other" is made of.
  const [otherOpen, setOtherOpen] = useState(true);
  const [drill, setDrill] = useState(0);
  // Remembered per browser, so the chart reopens the way it was left.
  const [prefs, setPrefs] = useState<ChartPrefs>(readPrefs);
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Storage can be unavailable (private mode); the setting then lasts
      // for this visit only.
    }
  }, [prefs]);
  const { ownBands, sort } = prefs;
  // One more slot than bands: the last one is the shared "Other" band.
  const maxSlots = ownBands + 1;

  // Every holding, largest first. Drilling into "Other" drops the leading
  // holdings that already have a band of their own at the level above.
  const ranked = useMemo(
    () =>
      buildTimeline(points, { windowStart, today, maxSlots }).series,
    [maxSlots, points, today, windowStart],
  );
  const maxDrill = Math.max(
    0,
    Math.ceil((ranked.length - maxSlots) / ownBands),
  );
  const level = Math.min(drill, maxDrill);

  const timeline = useMemo(() => {
    if (level === 0) {
      return buildTimeline(points, { windowStart, today, maxSlots });
    }
    const scope = new Set(
      ranked.slice(level * ownBands).map((series) => series.key),
    );
    return buildTimeline(
      points.map((point) => ({
        ...point,
        holdings: point.holdings.filter((holding) =>
          scope.has(holding.ticker.trim().toUpperCase()),
        ),
      })),
      { windowStart, today, maxSlots },
    );
  }, [level, maxSlots, ownBands, points, ranked, today, windowStart]);

  const effectsByKey = useMemo(() => {
    const inWindow = points
      .filter((point) => windowStart === null || point.date >= windowStart)
      .map((point) => ({
        date: point.date,
        holdings: point.holdings.map((holding) => ({
          ticker: holding.ticker,
          quantity: holding.quantity ?? 0,
          value: holding.value,
        })),
      }));
    return new Map<string, HoldingAttribution>(
      attributeChanges(inWindow).holdings.map((holding) => [
        holding.key,
        holding,
      ]),
    );
  }, [points, windowStart]);

  const effectsFor = (series: TimelineSeries[]): Effects =>
    sumEffects(
      series.map((member) => effectsByKey.get(member.key) ?? NO_EFFECTS),
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
        seriesValuesFor(member, mode).forEach((value, index) => {
          running[index]! += value;
        });
      }
      return { id, label, color, members, lower, upper: [...running] };
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
  }, [hidden, mode, timeline]);

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
        spansYears ? { month: "short", year: "2-digit" } : SHORT_DATE,
      ),
    }));
  }, [domainEnd, domainStart, plotWidth]);

  // Bands are always chosen and stacked by latest value. The sort only
  // reorders the rows of the table, within each of its two groups.
  const sortRows = (rows: TimelineSeries[]) => {
    const measure = (series: TimelineSeries) =>
      sort.column === "price"
        ? (effectsByKey.get(series.key)?.priceEffect ?? 0)
        : sort.column === "shares"
          ? (effectsByKey.get(series.key)?.quantityEffect ?? 0)
          : series.latestValue;
    return [...rows].sort((a, b) => {
      const order =
        sort.column === "name"
          ? a.label.localeCompare(b.label)
          : measure(a) - measure(b);
      return (sort.descending ? -order : order) || a.label.localeCompare(b.label);
    });
  };
  const ownSeries = timeline.series.filter((series) => series.slot !== null);
  const otherSeries = timeline.series.filter((series) => series.slot === null);
  const ownRows = sortRows(ownSeries);
  const otherRows = sortRows(otherSeries);
  const visibleSeries = timeline.series.filter(
    (series) => !hidden.has(series.key),
  );
  const hiddenCount = timeline.series.length - visibleSeries.length;
  const otherHiddenCount = otherSeries.filter((series) =>
    hidden.has(series.key),
  ).length;
  const missingWeekdays = timeline.gaps.reduce(
    (sum, gap) => sum + gap.missingWeekdays,
    0,
  );
  const lastIndex = timeline.days.length - 1;
  const shownEffects = effectsFor(visibleSeries);

  const panelBandId =
    panelKey === null
      ? null
      : panelKey === OTHER_ID
        ? OTHER_ID
        : (bands.find((band) =>
            band.members.some((member) => member.key === panelKey),
          )?.id ?? null);
  const hoverBand =
    hover?.kind === "point" && hover.bandId !== null
      ? (bands.find((band) => band.id === hover.bandId) ?? null)
      : null;

  // The strip under the chart follows the row or band being pointed at, and
  // otherwise describes the largest holding on screen.
  const detailSeries: TimelineSeries[] =
    panelKey === OTHER_ID
      ? otherSeries.filter((series) => !hidden.has(series.key))
      : panelKey !== null
        ? timeline.series.filter((series) => series.key === panelKey)
        : hoverBand
          ? hoverBand.members
          : visibleSeries.slice(0, 1);
  const detailSingle = detailSeries.length === 1 ? detailSeries[0]! : null;
  const detailAttribution = detailSingle
    ? (effectsByKey.get(detailSingle.key) ?? null)
    : null;
  const detailEffects = effectsFor(detailSeries);

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
    if (gap) {
      setHover({
        kind: "gap",
        gap,
        x: Math.min(xFor(gap.toDay), Math.max(xFor(gap.fromDay), xFor(day))),
      });
      return;
    }
    const value =
      (1 - (event.clientY - bounds.top - MARGIN.top) / plotHeight) * yMax;
    setHover({
      kind: "point",
      index: nearest,
      x: xFor(timeline.days[nearest]!),
      bandId:
        bands.find(
          (band) =>
            value >= band.lower[nearest]! && value < band.upper[nearest]!,
        )?.id ?? null,
    });
  };

  const toggle = (event: MouseEvent<HTMLButtonElement>, key: string) => {
    const allKeys = timeline.series.map((series) => series.key);
    if (event.shiftKey) {
      const isSolo = allKeys.every(
        (candidate) => hidden.has(candidate) === (candidate !== key),
      );
      const next = new Set(hidden);
      for (const candidate of allKeys) {
        if (isSolo || candidate === key) next.delete(candidate);
        else next.add(candidate);
      }
      onHiddenChange(next);
      return;
    }
    const next = new Set(hidden);
    if (!next.delete(key)) next.add(key);
    onHiddenChange(next);
  };

  const toggleOther = () => {
    const next = new Set(hidden);
    const hideAll = otherHiddenCount < otherSeries.length;
    for (const series of otherSeries) {
      if (hideAll) next.add(series.key);
      else next.delete(series.key);
    }
    onHiddenChange(next);
  };

  const showAll = () => {
    const next = new Set(hidden);
    for (const series of timeline.series) next.delete(series.key);
    onHiddenChange(next);
  };

  const effectCells = (effects: Effects, value: number, muted: boolean) => (
    <>
      <span className={`text-right ${muted ? "text-(--muted)" : ""}`}>
        {formatCompactCurrency(value)}
      </span>
      <span className={`text-right ${priceTone(effects.priceEffect)}`}>
        {formatEffect(effects.priceEffect)}
      </span>
      <span className={`text-right ${sharesTone(effects.quantityEffect)}`}>
        {formatEffect(effects.quantityEffect)}
      </span>
      <span className="flex justify-end">
        <SplitBar effects={effects} />
      </span>
    </>
  );

  const renderRow = (series: TimelineSeries, indented: boolean) => {
    const isHidden = hidden.has(series.key);
    const effects = effectsByKey.get(series.key) ?? NO_EFFECTS;
    return (
      <button
        key={series.key}
        type="button"
        aria-pressed={!isHidden}
        onClick={(event) => toggle(event, series.key)}
        onMouseEnter={() => setPanelKey(series.key)}
        onMouseLeave={() => setPanelKey(null)}
        onFocus={() => setPanelKey(series.key)}
        onBlur={() => setPanelKey(null)}
        title={`${series.name || series.label}\nClick to ${isHidden ? "show" : "hide"} · Shift-click to show only this`}
        className={`${ROW_GRID} w-full py-1 pr-3 text-left hover:bg-(--hover) ${
          indented ? "pl-8" : "pl-3"
        } ${isHidden ? "opacity-55" : ""}`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Swatch color={colorFor(series)} filled={!isHidden} />
          <span className={`font-semibold ${isHidden ? "line-through" : ""}`}>
            {series.label}
          </span>
          <span className="truncate text-(--muted)">{series.name}</span>
        </span>
        {effectCells(effects, series.latestValue, isHidden)}
      </button>
    );
  };

  const sortHeader = (column: SortColumn, label: string, hint: string) => {
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
        title={`${hint}\nClick to sort${active ? " the other way" : ""}`}
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

  const setOwnBands = (next: number) =>
    setPrefs((current) => ({ ...current, ownBands: clampOwnBands(next) }));
  const stepButton = (label: string, next: number, glyph: ReactNode) => (
    <button
      type="button"
      onClick={() => setOwnBands(next)}
      disabled={clampOwnBands(next) === ownBands}
      aria-label={label}
      title={label}
      className="flex h-5 w-5 items-center justify-center rounded text-(--muted) hover:bg-(--hover) hover:text-foreground disabled:opacity-35 disabled:hover:bg-transparent"
    >
      {glyph}
    </button>
  );

  const otherEffects = effectsFor(otherSeries);
  const otherValue = otherSeries.reduce(
    (sum, series) => sum + series.latestValue,
    0,
  );
  const otherPreview = otherSeries
    .slice(0, OTHER_PREVIEW_COUNT)
    .map((series) => series.label)
    .join(", ");
  const activeMode = MODES.find((option) => option.value === mode)!;
  const netChange = shownEffects.endValue - shownEffects.startValue;

  return (
    <div>
      <div className="flex flex-col gap-x-6 gap-y-2 border-b border-(--card-border) px-3 py-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
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
                onClick={() => setMode(option.value)}
                title={option.caption}
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
            {activeMode.caption}
          </p>
        </div>
        {timeline.days.length > 1 ? (
          <dl
            className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1 text-xs tabular-nums"
            title="Change across the charted range for the holdings shown. Price and Shares add up to the net change."
          >
            <div className="flex items-baseline gap-1.5">
              <dt className="text-(--muted)">
                {formatDate(timeline.dates[0]!, SHORT_DATE)} →{" "}
                {formatDate(timeline.dates[lastIndex]!, SHORT_DATE)}
              </dt>
              <dd className="font-semibold">
                {formatCompactCurrency(shownEffects.startValue)} →{" "}
                {formatCompactCurrency(shownEffects.endValue)}
                <span className={`ml-1 font-medium ${priceTone(netChange)}`}>
                  ({formatEffect(netChange)})
                </span>
              </dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-(--muted)">Price</dt>
              <dd
                className={`font-semibold ${priceTone(shownEffects.priceEffect)}`}
              >
                {formatEffect(shownEffects.priceEffect)}
              </dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-(--muted)">Shares</dt>
              <dd className="font-semibold">
                {formatEffect(shownEffects.quantityEffect)}
              </dd>
            </div>
          </dl>
        ) : null}
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_31rem]">
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
              aria-label={`Stacked holdings over time: ${activeMode.label}`}
            >
              <defs>
                <pattern
                  id={patternId}
                  width={8}
                  height={8}
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect
                    width={8}
                    height={8}
                    fill="var(--muted)"
                    opacity={0.08}
                  />
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
                  y={height - MARGIN.bottom + 16}
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
                    panelBandId !== null && panelBandId !== band.id ? 0.25 : 1
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
                  {yFor(band.lower[lastIndex]!) -
                    yFor(band.upper[lastIndex]!) >=
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
              className="pointer-events-none absolute top-3 z-10 w-60 rounded-md border border-(--card-border) bg-(--card-bg) p-2.5 text-xs shadow-lg"
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
                  {mode === "value" ? null : (
                    <p className="text-(--muted)">
                      {mode === "price"
                        ? "Today's shares at this day's prices"
                        : "This day's shares at today's prices"}
                    </p>
                  )}
                  <div className="mt-1.5 space-y-0.5">
                    {[...bands].reverse().map((band) => {
                      const value =
                        band.upper[hover.index]! - band.lower[hover.index]!;
                      const total = totals[hover.index]!;
                      const pointed = hover.bandId === band.id;
                      const members =
                        band.id === OTHER_ID && band.members.length > 1
                          ? band.members
                              .map((member) => ({
                                label: member.label,
                                value: seriesValuesFor(member, mode)[
                                  hover.index
                                ]!,
                              }))
                              .filter((member) => member.value > 0)
                              .sort((a, b) => b.value - a.value)
                          : [];
                      return (
                        <div key={band.id}>
                          <div
                            className={`flex items-center gap-2 ${pointed ? "font-semibold" : ""}`}
                          >
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                              style={{ backgroundColor: band.color }}
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {band.label}
                            </span>
                            <span className="tabular-nums">
                              {formatCurrency(value)}
                            </span>
                            <span className="w-8 text-right tabular-nums text-(--muted)">
                              {total > 0
                                ? `${((value / total) * 100).toFixed(0)}%`
                                : "—"}
                            </span>
                          </div>
                          {members
                            .slice(0, TOOLTIP_OTHER_MEMBERS)
                            .map((member) => (
                              <div
                                key={member.label}
                                className="flex items-center gap-2 pl-[18px] text-(--muted)"
                              >
                                <span className="min-w-0 flex-1 truncate">
                                  {member.label}
                                </span>
                                <span className="tabular-nums">
                                  {formatCurrency(member.value)}
                                </span>
                                <span className="w-8" />
                              </div>
                            ))}
                          {members.length > TOOLTIP_OTHER_MEMBERS ? (
                            <p className="pl-[18px] text-(--muted)">
                              and {members.length - TOOLTIP_OTHER_MEMBERS} more
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-1.5 flex justify-between border-t border-(--card-border) pt-1.5 font-semibold">
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

        <div className="flex max-h-96 flex-col border-t border-(--card-border) text-xs tabular-nums xl:h-[52vh] xl:max-h-none xl:min-h-[380px] xl:border-l xl:border-t-0">
          <div className="flex items-center gap-2 border-b border-(--card-border) px-3 py-1.5">
            {level === 0 ? (
              <span className="font-semibold">
                {timeline.series.length} holdings
              </span>
            ) : (
              <nav
                aria-label="Chart scope"
                className="flex min-w-0 items-center gap-1"
              >
                <button
                  type="button"
                  onClick={() => setDrill(0)}
                  className="font-medium text-accent hover:underline"
                >
                  All holdings
                </button>
                {Array.from({ length: level }, (_, index) => {
                  const depth = index + 1;
                  const count = ranked.length - depth * ownBands;
                  return (
                    <span key={depth} className="flex items-center gap-1">
                      <span className="text-(--muted)">›</span>
                      {depth === level ? (
                        <span className="font-semibold">Other ({count})</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDrill(depth)}
                          className="font-medium text-accent hover:underline"
                        >
                          Other ({count})
                        </button>
                      )}
                    </span>
                  );
                })}
              </nav>
            )}
            <div
              className="order-last ml-auto flex shrink-0 items-center gap-0.5"
              title="How many holdings get a band of their own before the rest are grouped as Other. Remembered on this browser."
            >
              <span className="mr-1 text-(--muted)">Bands</span>
              {stepButton("Fewer bands", ownBands - 1, "−")}
              <span className="w-5 text-center font-semibold">{ownBands}</span>
              {stepButton("More bands", ownBands + 1, "+")}
            </div>
            {hiddenCount > 0 ? (
              <>
                <span className="text-(--muted)">· {hiddenCount} hidden</span>
                <button
                  type="button"
                  onClick={showAll}
                  className="font-medium text-accent hover:underline"
                >
                  Show all
                </button>
              </>
            ) : null}
          </div>
          <div
            className={`${ROW_GRID} border-b border-(--card-border) py-1 pl-3 pr-3 text-[11px] uppercase tracking-wide text-(--muted)`}
          >
            {sortHeader("name", "Holding", "Sort by ticker")}
            {sortHeader("value", "Value", "Value in the latest snapshot")}
            {sortHeader(
              "price",
              "Price",
              "Change in value caused by the price moving",
            )}
            {sortHeader(
              "shares",
              "Shares",
              "Change in value caused by the share count changing: buys, sells, exercises, transfers",
            )}
            <span
              className="text-right"
              title="Top bar: price move. Bottom bar: share change. Each is drawn relative to the holding's own size, on a square-root scale so small moves stay visible."
            >
              Split
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {ownRows.map((series) => renderRow(series, false))}
            {otherSeries.length > 0 ? (
              <div
                className="border-t border-(--card-border)"
                onMouseEnter={() => setPanelKey(OTHER_ID)}
                onMouseLeave={() => setPanelKey(null)}
              >
                <div className={`${ROW_GRID} py-1 pl-3 pr-3`}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={toggleOther}
                      aria-pressed={otherHiddenCount < otherSeries.length}
                      title={
                        otherHiddenCount < otherSeries.length
                          ? "Hide everything in Other"
                          : "Show everything in Other"
                      }
                      className="flex"
                    >
                      <Swatch
                        color="var(--series-other)"
                        filled={otherHiddenCount < otherSeries.length}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => setOtherOpen((open) => !open)}
                      aria-expanded={otherOpen}
                      className="flex min-w-0 items-center gap-1.5 text-left"
                    >
                      <span className="font-semibold">Other</span>
                      <span className="text-(--muted)">
                        {otherSeries.length}
                      </span>
                      <svg
                        viewBox="0 0 12 12"
                        className={`h-3 w-3 shrink-0 text-(--muted) transition-transform ${otherOpen ? "rotate-90" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.75}
                        aria-hidden
                      >
                        <path
                          d="M4.5 2.5 8 6l-3.5 3.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </span>
                  {effectCells(otherEffects, otherValue, false)}
                </div>
                <div className="flex items-center gap-2 pb-1.5 pl-8 pr-3 text-(--muted)">
                  {otherOpen ? null : (
                    <span className="min-w-0 truncate">
                      {otherPreview}
                      {otherSeries.length > OTHER_PREVIEW_COUNT
                        ? ` +${otherSeries.length - OTHER_PREVIEW_COUNT}`
                        : ""}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setDrill(level + 1);
                      setOtherOpen(false);
                    }}
                    title="Redraw the chart with only these holdings, so the largest of them get bands of their own"
                    className="shrink-0 font-medium text-accent hover:underline"
                  >
                    Chart these on their own →
                  </button>
                </div>
                {otherOpen
                  ? otherRows.map((series) => renderRow(series, true))
                  : null}
              </div>
            ) : null}
          </div>
          <div
            className={`${ROW_GRID} border-t border-(--card-border) bg-background py-1.5 pl-3 pr-3 font-semibold`}
          >
            <span>{hiddenCount > 0 ? "Shown total" : "Total"}</span>
            {effectCells(shownEffects, shownEffects.endValue, false)}
          </div>
        </div>
      </div>

      {detailSeries.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-(--card-border) px-3 py-2.5 text-xs tabular-nums lg:grid-cols-[minmax(0,1.1fr)_repeat(4,minmax(0,1fr))]">
          <div className="min-w-0">
            <p className="text-(--muted)">
              {detailSingle ? "Holding" : "Group"}
            </p>
            <p className="truncate text-sm font-bold">
              {detailSingle
                ? detailSingle.label
                : `Other (${detailSeries.length})`}
            </p>
            <p className="truncate text-(--muted)">
              {detailSingle
                ? detailSingle.name
                : detailSeries
                    .slice(0, 6)
                    .map((series) => series.label)
                    .join(", ")}
            </p>
          </div>
          <div>
            <p className="text-(--muted)">Value</p>
            <p className="text-sm font-semibold">
              {formatCompactCurrency(detailEffects.startValue)} →{" "}
              {formatCompactCurrency(detailEffects.endValue)}
            </p>
            <p
              className={priceTone(
                detailEffects.endValue - detailEffects.startValue,
              )}
            >
              {formatEffect(detailEffects.endValue - detailEffects.startValue)}
            </p>
          </div>
          <div>
            <p className="text-(--muted)">Price per share</p>
            <p className="text-sm font-semibold">
              {detailAttribution &&
              (detailAttribution.startPrice !== null ||
                detailAttribution.endPrice !== null)
                ? `${formatPrice(detailAttribution.startPrice)} → ${formatPrice(detailAttribution.endPrice)}`
                : "—"}
            </p>
            <p className="text-(--muted)">
              {detailAttribution
                ? (formatRelativeChange(
                    detailAttribution.startPrice ?? 0,
                    detailAttribution.endPrice ?? 0,
                  ) ?? (detailSingle ? "No per-share price" : ""))
                : "Varies by holding"}
            </p>
          </div>
          <div>
            <p className="text-(--muted)">Shares</p>
            <p className="text-sm font-semibold">
              {detailAttribution &&
              (detailAttribution.startQuantity > 0 ||
                detailAttribution.endQuantity > 0)
                ? `${formatShares(detailAttribution.startQuantity)} → ${formatShares(detailAttribution.endQuantity)}`
                : "—"}
            </p>
            <p className="text-(--muted)">
              {detailAttribution
                ? (formatRelativeChange(
                    detailAttribution.startQuantity,
                    detailAttribution.endQuantity,
                  ) ??
                  (detailAttribution.startQuantity > 0
                    ? "Closed"
                    : detailAttribution.endQuantity > 0
                      ? "Opened"
                      : ""))
                : "Varies by holding"}
            </p>
          </div>
          <div>
            <p className="text-(--muted)">Change came from</p>
            <p className="text-sm font-semibold">
              <span className={priceTone(detailEffects.priceEffect)}>
                {formatEffect(detailEffects.priceEffect)}
              </span>{" "}
              <span className="font-normal text-(--muted)">price</span>
            </p>
            <p className="text-sm font-semibold">
              {formatEffect(detailEffects.quantityEffect)}{" "}
              <span className="font-normal text-(--muted)">shares</span>
            </p>
          </div>
        </div>
      ) : null}

      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-(--card-border) px-3 py-2 text-xs text-(--muted)"
        title="A day is only charted when every account in scope has a snapshot for it."
      >
        <svg
          width={12}
          height={12}
          aria-hidden
          className="shrink-0 rounded-[3px]"
        >
          <rect width={12} height={12} fill={`url(#${patternId})`} />
        </svg>
        {timeline.days.length === 0 ? (
          <span>Nothing to chart in this range.</span>
        ) : timeline.gaps.length === 0 ? (
          <span>Every weekday in this range has a complete snapshot.</span>
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
