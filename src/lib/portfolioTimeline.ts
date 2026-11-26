const DAY_MS = 86_400_000;

export type TimelineInputPoint = {
  date: string;
  holdings: Array<{ ticker: string; name: string; value: number }>;
};

export type TimelineSeries = {
  /** Upper-cased ticker; the empty string is cash. */
  key: string;
  label: string;
  name: string;
  latestValue: number;
  /**
   * Fixed colour slot, assigned from the whole history so that neither the
   * visible range nor hiding other series repaints a holding. `null` means the
   * holding is drawn as part of the shared "Other" band.
   */
  slot: number | null;
  /** One value per in-window snapshot date. */
  values: number[];
};

export type TimelineGap = {
  kind: "leading" | "between" | "trailing";
  /** Horizontal extent of the gap, as day numbers. */
  fromDay: number;
  toDay: number;
  firstMissing: string;
  lastMissing: string;
  missingWeekdays: number;
};

export type Timeline = {
  dates: string[];
  days: number[];
  series: TimelineSeries[];
  gaps: TimelineGap[];
  /** Inclusive index runs of snapshots with no missing weekday between them. */
  segments: Array<[number, number]>;
  domain: [number, number];
  /** Date of the first snapshot ever recorded, when it falls inside the window. */
  historyStart: string | null;
};

export function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00.000Z`) / DAY_MS);
}

export function dateFromDayNumber(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function isWeekday(day: number): boolean {
  // Day 0 (1970-01-01) was a Thursday.
  const weekday = (((day + 4) % 7) + 7) % 7;
  return weekday !== 0 && weekday !== 6;
}

/** Weekdays strictly between two day numbers. */
function weekdaysBetween(fromExclusive: number, toExclusive: number) {
  let count = 0;
  let first: number | null = null;
  let last: number | null = null;
  for (let day = fromExclusive + 1; day < toExclusive; day += 1) {
    if (!isWeekday(day)) continue;
    count += 1;
    first ??= day;
    last = day;
  }
  return first === null || last === null ? null : { count, first, last };
}

function makeGap(
  kind: TimelineGap["kind"],
  fromDay: number,
  toDay: number,
  searchFromExclusive = fromDay,
): TimelineGap | null {
  const missing = weekdaysBetween(searchFromExclusive, toDay);
  if (!missing) return null;
  return {
    kind,
    fromDay,
    toDay,
    firstMissing: dateFromDayNumber(missing.first),
    lastMissing: dateFromDayNumber(missing.last),
    missingWeekdays: missing.count,
  };
}

/**
 * Shapes snapshot history for a stacked value-over-time chart.
 *
 * Snapshots are only expected on weekdays, so a weekend between two snapshots
 * is not a gap; any missing weekday is.
 */
export function buildTimeline(
  points: TimelineInputPoint[],
  options: { windowStart?: string | null; today: string; maxSlots?: number },
): Timeline {
  const maxSlots = options.maxSlots ?? 8;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const valuesByPoint = sorted.map((point) => {
    const values = new Map<string, number>();
    for (const holding of point.holdings) {
      const key = holding.ticker.trim().toUpperCase();
      values.set(key, (values.get(key) ?? 0) + Math.max(0, holding.value));
    }
    return values;
  });

  const meta = new Map<string, { name: string; peak: number }>();
  sorted.forEach((point, index) => {
    for (const holding of point.holdings) {
      const key = holding.ticker.trim().toUpperCase();
      const entry = meta.get(key) ?? { name: "", peak: 0 };
      // Later snapshots win so a renamed holding shows its current name.
      entry.name = holding.name || entry.name;
      entry.peak = Math.max(entry.peak, valuesByPoint[index]!.get(key) ?? 0);
      meta.set(key, entry);
    }
  });
  const latest = valuesByPoint.at(-1) ?? new Map<string, number>();
  const ranked = [...meta.entries()]
    .filter(([, entry]) => entry.peak > 0)
    .sort(
      ([keyA, a], [keyB, b]) =>
        (latest.get(keyB) ?? 0) - (latest.get(keyA) ?? 0) ||
        b.peak - a.peak ||
        keyA.localeCompare(keyB),
    );
  const ownSlots = ranked.length <= maxSlots ? ranked.length : maxSlots - 1;

  const windowStart = options.windowStart ?? null;
  const firstIndex = windowStart
    ? sorted.findIndex((point) => point.date >= windowStart)
    : 0;
  const inWindow = firstIndex < 0 ? [] : sorted.slice(firstIndex);
  const windowValues = firstIndex < 0 ? [] : valuesByPoint.slice(firstIndex);
  const dates = inWindow.map((point) => point.date);
  const days = dates.map(dayNumber);

  const series: TimelineSeries[] = ranked.map(([key, entry], index) => ({
    key,
    label: key || "Cash",
    name: entry.name,
    latestValue: latest.get(key) ?? 0,
    slot: index < ownSlots ? index : null,
    values: windowValues.map((values) => values.get(key) ?? 0),
  }));

  if (days.length === 0) {
    return {
      dates,
      days,
      series,
      gaps: [],
      segments: [],
      domain: [0, 1],
      historyStart: null,
    };
  }

  const gaps: TimelineGap[] = [];
  if (firstIndex > 0 && windowStart) {
    const startDay = dayNumber(windowStart);
    const gap = makeGap("leading", startDay, days[0]!, startDay - 1);
    if (gap) gaps.push(gap);
  }
  const segments: Array<[number, number]> = [];
  let segmentStart = 0;
  for (let index = 1; index < days.length; index += 1) {
    const gap = makeGap("between", days[index - 1]!, days[index]!);
    if (!gap) continue;
    gaps.push(gap);
    segments.push([segmentStart, index - 1]);
    segmentStart = index;
  }
  segments.push([segmentStart, days.length - 1]);
  const trailing = makeGap("trailing", days.at(-1)!, dayNumber(options.today));
  if (trailing) gaps.push(trailing);

  const domainStart = gaps[0]?.kind === "leading" ? gaps[0].fromDay : days[0]!;
  const domainEnd = trailing ? trailing.toDay : days.at(-1)!;
  return {
    dates,
    days,
    series,
    gaps,
    segments,
    domain:
      domainStart === domainEnd
        ? [domainStart - 1, domainEnd + 1]
        : [domainStart, domainEnd],
    historyStart: firstIndex === 0 ? dates[0]! : null,
  };
}
