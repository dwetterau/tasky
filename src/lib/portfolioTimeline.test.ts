import { describe, expect, it } from "vitest";
import { buildTimeline, type TimelineInputPoint } from "./portfolioTimeline";

function point(
  date: string,
  values: Record<string, number>,
): TimelineInputPoint {
  return {
    date,
    holdings: Object.entries(values).map(([ticker, value]) => ({
      ticker,
      name: `${ticker} Inc`,
      value,
    })),
  };
}

describe("portfolio timeline", () => {
  it("bridges weekends but reports missing weekdays as gaps", () => {
    const timeline = buildTimeline(
      [
        point("2026-03-05", { AAA: 10 }), // Thursday
        point("2026-03-06", { AAA: 11 }), // Friday
        point("2026-03-09", { AAA: 12 }), // Monday
        point("2026-03-12", { AAA: 13 }), // Thursday
      ],
      { today: "2026-03-12" },
    );

    expect(timeline.segments).toEqual([
      [0, 2],
      [3, 3],
    ]);
    expect(timeline.gaps).toEqual([
      expect.objectContaining({
        kind: "between",
        firstMissing: "2026-03-10",
        lastMissing: "2026-03-11",
        missingWeekdays: 2,
      }),
    ]);
    expect(timeline.historyStart).toBe("2026-03-05");
  });

  it("reports a trailing gap up to, but not including, today", () => {
    const points = [point("2026-03-05", { AAA: 10 })];
    expect(buildTimeline(points, { today: "2026-03-06" }).gaps).toEqual([]);
    expect(buildTimeline(points, { today: "2026-03-10" }).gaps).toEqual([
      expect.objectContaining({
        kind: "trailing",
        firstMissing: "2026-03-06",
        lastMissing: "2026-03-09",
        missingWeekdays: 2,
      }),
    ]);
  });

  it("clips to the window and flags a gap that straddles its start", () => {
    const timeline = buildTimeline(
      [
        point("2026-03-02", { AAA: 10 }),
        point("2026-03-11", { AAA: 12 }),
        point("2026-03-12", { AAA: 13 }),
      ],
      { windowStart: "2026-03-09", today: "2026-03-12" },
    );

    expect(timeline.dates).toEqual(["2026-03-11", "2026-03-12"]);
    expect(timeline.historyStart).toBeNull();
    expect(timeline.gaps).toEqual([
      expect.objectContaining({
        kind: "leading",
        firstMissing: "2026-03-09",
        lastMissing: "2026-03-10",
        missingWeekdays: 2,
      }),
    ]);
    expect(timeline.domain[0]).toBeLessThan(timeline.days[0]!);
  });

  it("keeps colour slots stable across windows and folds the tail into Other", () => {
    const points = [
      point("2026-03-05", { OLD: 500, A: 1, B: 2, C: 3 }),
      point("2026-03-06", { A: 30, B: 20, C: 10, "": 5 }),
    ];
    const full = buildTimeline(points, { today: "2026-03-06", maxSlots: 3 });
    const clipped = buildTimeline(points, {
      windowStart: "2026-03-06",
      today: "2026-03-06",
      maxSlots: 3,
    });

    expect(full.series.map((entry) => [entry.label, entry.slot])).toEqual([
      ["A", 0],
      ["B", 1],
      ["C", null],
      ["Cash", null],
      ["OLD", null],
    ]);
    expect(clipped.series.map((entry) => entry.slot)).toEqual(
      full.series.map((entry) => entry.slot),
    );
    expect(full.series[4]!.values).toEqual([500, 0]);
  });
});
