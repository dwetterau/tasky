import { expect, test } from "@jest/globals";
import type { SignalDashboardItem, SignalEntry } from "../signals";
import { buildSignalTrendSeries } from "../signalTrends";

const activitySignal = {
  model: { kind: "activity" },
} as SignalDashboardItem;

function activityEntry(
  effectiveAt: number,
  measurements?: {
    weight?: number;
    reps?: number;
    sets?: number;
    durationSeconds?: number;
    distance?: number;
  },
): SignalEntry {
  return {
    effectiveAt,
    operation: {
      type: "activity.occurred",
      measurements,
    },
  } as SignalEntry;
}

test("builds distance and pace series in chronological order", () => {
  const series = buildSignalTrendSeries(
    activitySignal,
    [
      activityEntry(200, { distance: 2, durationSeconds: 1_200 }),
      activityEntry(100, { distance: 1, durationSeconds: 660 }),
    ],
    300,
  );

  expect(series.map(({ id }) => id)).toEqual(["distance", "pace"]);
  expect(series[0]?.points).toEqual([
    { timestamp: 100, value: 1 },
    { timestamp: 200, value: 2 },
  ]);
  expect(series[1]?.points.map(({ value }) => value)).toEqual([11, 10]);
});

test("uses the first available measurement for non-distance activities", () => {
  const series = buildSignalTrendSeries(
    activitySignal,
    [
      activityEntry(100, { reps: 8, sets: 3 }),
      activityEntry(200, { reps: 10, sets: 3 }),
    ],
    300,
  );

  expect(series).toHaveLength(1);
  expect(series[0]).toMatchObject({
    id: "reps",
    unit: "reps",
    points: [
      { timestamp: 100, value: 8 },
      { timestamp: 200, value: 10 },
    ],
  });
});

test("groups unmeasured activity completions by local day", () => {
  const firstDay = new Date(2026, 0, 2, 8).getTime();
  const sameDay = new Date(2026, 0, 2, 18).getTime();
  const nextDay = new Date(2026, 0, 3, 9).getTime();
  const series = buildSignalTrendSeries(
    activitySignal,
    [
      activityEntry(nextDay),
      activityEntry(sameDay),
      activityEntry(firstDay),
    ],
    nextDay,
  );

  expect(series[0]).toMatchObject({
    id: "completions",
    kind: "bar",
  });
  expect(series[0]?.points.map(({ value }) => value)).toEqual([2, 1]);
});

test("uses resulting inventory quantities and sorts them chronologically", () => {
  const inventorySignal = {
    model: {
      kind: "inventory",
      unit: "items",
      confirmedAt: 200,
      confirmedQuantity: 8,
    },
  } as SignalDashboardItem;
  const entries = [
    {
      effectiveAt: 200,
      operation: {
        type: "inventory.adjusted",
        amount: -2,
        resultingQuantity: 8,
      },
    },
    {
      effectiveAt: 100,
      operation: {
        type: "inventory.set",
        quantity: 10,
        previousQuantity: 4,
      },
    },
  ] as SignalEntry[];

  expect(
    buildSignalTrendSeries(inventorySignal, entries, 200)[0],
  ).toMatchObject({
    id: "quantity",
    unit: "items",
    points: [
      { timestamp: 100, value: 10 },
      { timestamp: 200, value: 8 },
    ],
  });
});

test("derives scheduled inventory changes from the confirmed quantity", () => {
  const day = 24 * 60 * 60 * 1000;
  const inventorySignal = {
    model: {
      kind: "inventory",
      unit: "pills",
      confirmedAt: 0,
      confirmedQuantity: 10,
      flow: { amount: -1, everyDays: 1 },
      nextFlowAt: day,
    },
  } as SignalDashboardItem;

  expect(
    buildSignalTrendSeries(inventorySignal, [], 3 * day)[0]?.points,
  ).toEqual([
    { timestamp: 0, value: 10 },
    { timestamp: day, value: 9 },
    { timestamp: 2 * day, value: 8 },
    { timestamp: 3 * day, value: 7 },
  ]);
});
