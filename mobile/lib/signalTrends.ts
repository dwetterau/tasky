import type { SignalDashboardItem, SignalEntry } from "./signals";

export type SignalTrendPoint = {
  timestamp: number;
  value: number;
};

export type SignalTrendSeries = {
  id: string;
  title: string;
  unit: string;
  color: string;
  kind: "line" | "bar";
  points: SignalTrendPoint[];
  lowerIsBetter?: boolean;
};

type ActivityOperation = Extract<
  SignalEntry["operation"],
  { type: "activity.occurred" }
>;

type ActivityEntry = SignalEntry & {
  operation: ActivityOperation;
};

function isActivityEntry(entry: SignalEntry): entry is ActivityEntry {
  return entry.operation.type === "activity.occurred";
}

function sorted(points: SignalTrendPoint[]): SignalTrendPoint[] {
  return points.sort((left, right) => left.timestamp - right.timestamp);
}

function activityMetricPoints(
  entries: ActivityEntry[],
  getValue: (operation: ActivityOperation) => number | undefined,
): SignalTrendPoint[] {
  return sorted(
    entries.flatMap((entry) => {
      const value = getValue(entry.operation);
      return value === undefined
        ? []
        : [{ timestamp: entry.effectiveAt, value }];
    }),
  );
}

function completionCadence(entries: ActivityEntry[]): SignalTrendPoint[] {
  const counts = new Map<number, number>();
  for (const entry of entries) {
    const date = new Date(entry.effectiveAt);
    const day = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    ).getTime();
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return Array.from(counts, ([timestamp, value]) => ({ timestamp, value })).sort(
    (left, right) => left.timestamp - right.timestamp,
  );
}

function activityTrends(entries: SignalEntry[]): SignalTrendSeries[] {
  const activities = entries.filter(isActivityEntry);
  if (activities.length === 0) return [];

  const distance = activityMetricPoints(
    activities,
    (operation) => operation.measurements?.distance,
  );
  const pace = sorted(
    activities.flatMap((entry) => {
      const distanceValue = entry.operation.measurements?.distance;
      const durationSeconds = entry.operation.measurements?.durationSeconds;
      if (
        distanceValue === undefined ||
        durationSeconds === undefined ||
        distanceValue <= 0
      ) {
        return [];
      }
      return [
        {
          timestamp: entry.effectiveAt,
          value: durationSeconds / 60 / distanceValue,
        },
      ];
    }),
  );

  if (distance.length > 0 && pace.length > 0) {
    return [
      {
        id: "distance",
        title: "Distance",
        unit: "mi",
        color: "#4c9f45",
        kind: "line",
        points: distance,
      },
      {
        id: "pace",
        title: "Pace",
        unit: "min/mi",
        color: "#6366f1",
        kind: "line",
        points: pace,
        lowerIsBetter: true,
      },
    ];
  }

  const candidates: {
    id: string;
    title: string;
    unit: string;
    color: string;
    points: SignalTrendPoint[];
  }[] = [
    {
      id: "weight",
      title: "Weight",
      unit: "lb",
      color: "#4c9f45",
      points: activityMetricPoints(
        activities,
        (operation) => operation.measurements?.weight,
      ),
    },
    {
      id: "distance",
      title: "Distance",
      unit: "mi",
      color: "#4c9f45",
      points: distance,
    },
    {
      id: "duration",
      title: "Duration",
      unit: "min",
      color: "#6366f1",
      points: activityMetricPoints(activities, (operation) => {
        const seconds = operation.measurements?.durationSeconds;
        return seconds === undefined ? undefined : seconds / 60;
      }),
    },
    {
      id: "reps",
      title: "Repetitions",
      unit: "reps",
      color: "#f59e0b",
      points: activityMetricPoints(
        activities,
        (operation) => operation.measurements?.reps,
      ),
    },
    {
      id: "sets",
      title: "Sets",
      unit: "sets",
      color: "#8b5cf6",
      points: activityMetricPoints(
        activities,
        (operation) => operation.measurements?.sets,
      ),
    },
  ];
  const primary = candidates.find((candidate) => candidate.points.length > 0);
  if (primary) {
    return [{ ...primary, kind: "line" }];
  }

  return [
    {
      id: "completions",
      title: "Completions",
      unit: "per day",
      color: "#4c9f45",
      kind: "bar",
      points: completionCadence(activities),
    },
  ];
}

function inventoryTrends(
  signal: SignalDashboardItem,
  entries: SignalEntry[],
): SignalTrendSeries[] {
  if (signal.model.kind !== "inventory") return [];
  const points = sorted(
    entries.flatMap((entry) => {
      if (entry.operation.type === "inventory.adjusted") {
        return [
          {
            timestamp: entry.effectiveAt,
            value: entry.operation.resultingQuantity,
          },
        ];
      }
      if (entry.operation.type === "inventory.set") {
        return [
          {
            timestamp: entry.effectiveAt,
            value: entry.operation.quantity,
          },
        ];
      }
      return [];
    }),
  );
  return points.length === 0
    ? []
    : [
        {
          id: "quantity",
          title: "Quantity",
          unit: signal.model.unit,
          color: "#4c9f45",
          kind: "line",
          points,
        },
      ];
}

export function buildSignalTrendSeries(
  signal: SignalDashboardItem,
  entries: SignalEntry[],
): SignalTrendSeries[] {
  return signal.model.kind === "inventory"
    ? inventoryTrends(signal, entries)
    : activityTrends(entries);
}
