"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatSignalQuantity,
  type SignalDashboardItem,
  type SignalEntry,
} from "@/lib/signalDisplay";

type TrendPoint = {
  timestamp: number;
  value: number;
};

type TrendSeries = {
  id: string;
  title: string;
  unit: string;
  color: string;
  kind: "line" | "bar";
  points: TrendPoint[];
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

function sorted(points: TrendPoint[]): TrendPoint[] {
  return points.sort((left, right) => left.timestamp - right.timestamp);
}

function activityMetricPoints(
  entries: ActivityEntry[],
  getValue: (operation: ActivityOperation) => number | undefined,
): TrendPoint[] {
  return sorted(
    entries.flatMap((entry) => {
      const value = getValue(entry.operation);
      return value === undefined
        ? []
        : [{ timestamp: entry.effectiveAt, value }];
    }),
  );
}

function completionCadence(entries: ActivityEntry[]): TrendPoint[] {
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

function activityTrends(entries: SignalEntry[]): TrendSeries[] {
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

  const candidates: Array<{
    id: string;
    title: string;
    unit: string;
    color: string;
    points: TrendPoint[];
  }> = [
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
): TrendSeries[] {
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

function formatAxisDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

function formatTooltipDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(timestamp);
}

function TrendChart({ series }: { series: TrendSeries }) {
  const latest = series.points.at(-1);
  const firstTimestamp = series.points[0]?.timestamp ?? 0;
  const lastTimestamp = latest?.timestamp ?? firstTimestamp;
  const halfDay = 12 * 60 * 60 * 1000;
  const domain: [number, number] =
    firstTimestamp === lastTimestamp
      ? [firstTimestamp - halfDay, lastTimestamp + halfDay]
      : [firstTimestamp, lastTimestamp];
  const tooltipStyle = {
    backgroundColor: "var(--card-bg)",
    border: "1px solid var(--card-border)",
    borderRadius: "8px",
    color: "var(--foreground)",
    fontSize: "12px",
  };
  const common = (
    <>
      <CartesianGrid
        strokeDasharray="3 3"
        stroke="var(--card-border)"
        vertical={false}
      />
      <XAxis
        dataKey="timestamp"
        type="number"
        scale="time"
        domain={domain}
        tickFormatter={formatAxisDate}
        tickLine={false}
        axisLine={{ stroke: "var(--card-border)" }}
        fontSize={11}
        minTickGap={28}
      />
      <YAxis
        tickLine={false}
        axisLine={false}
        fontSize={11}
        width={42}
        tickFormatter={formatSignalQuantity}
        domain={["auto", "auto"]}
      />
      <Tooltip
        contentStyle={tooltipStyle}
        labelFormatter={(label) => formatTooltipDate(Number(label))}
        formatter={(value) => [
          `${formatSignalQuantity(Number(value))} ${series.unit}`,
          series.title,
        ]}
      />
    </>
  );

  return (
    <div className="rounded-xl border border-(--card-border) bg-background p-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold">{series.title}</h4>
          <p className="mt-0.5 text-xs text-(--muted)">
            {series.lowerIsBetter ? "Lower is faster" : `Measured in ${series.unit}`}
          </p>
        </div>
        {latest ? (
          <span className="text-sm font-semibold tabular-nums">
            {formatSignalQuantity(latest.value)}{" "}
            <span className="font-normal text-(--muted)">{series.unit}</span>
          </span>
        ) : null}
      </div>
      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {series.kind === "bar" ? (
            <BarChart data={series.points} margin={{ left: -8, right: 8 }}>
              {common}
              <Bar
                dataKey="value"
                fill={series.color}
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
              />
            </BarChart>
          ) : (
            <LineChart data={series.points} margin={{ left: -8, right: 8 }}>
              {common}
              <Line
                type="monotone"
                dataKey="value"
                stroke={series.color}
                strokeWidth={2.5}
                dot={
                  series.points.length <= 12
                    ? { r: 3, fill: series.color, strokeWidth: 0 }
                    : false
                }
                activeDot={{ r: 5 }}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function SignalTrendCharts({
  signal,
  entries,
}: {
  signal: SignalDashboardItem;
  entries: SignalEntry[];
}) {
  const series =
    signal.model.kind === "inventory"
      ? inventoryTrends(signal, entries)
      : activityTrends(entries);
  if (series.length === 0) return null;

  return (
    <section className="border-b border-(--card-border) px-6 py-5">
      <div className="mb-4">
        <h3 className="font-semibold">Trends</h3>
        <p className="mt-0.5 text-xs text-(--muted)">
          {`Based on the ${entries.length} most recently loaded ${
            entries.length === 1 ? "entry" : "entries"
          }`}
        </p>
      </div>
      <div
        className={`grid grid-cols-1 gap-4 ${
          series.length > 1 ? "lg:grid-cols-2" : ""
        }`}
      >
        {series.map((item) => (
          <TrendChart key={item.id} series={item} />
        ))}
      </div>
    </section>
  );
}
