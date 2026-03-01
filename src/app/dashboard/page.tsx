"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Navigation } from "../../components/Navigation";
import { SearchTagSelector } from "../../components/TagSelector";
import { useAuthSession } from "@/lib/useAuthSession";
import { SignIn } from "@/components/SignIn";
import { useState, useMemo, useEffect } from "react";
import { usePageTagFilter } from "@/lib/usePageTagFilter";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type TimeRange = "7d" | "30d" | "90d" | "all";

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "all", label: "All time" },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const DASHBOARD_TIME_RANGE_KEY = "tasky-dashboard-time-range";

function getStoredTimeRange(): TimeRange {
  if (typeof window === "undefined") return "30d";
  const stored = localStorage.getItem(DASHBOARD_TIME_RANGE_KEY);
  if (stored && TIME_RANGES.some((range) => range.value === stored)) {
    return stored as TimeRange;
  }
  return "30d";
}

function getTimeRangeBounds(range: TimeRange): { startTime: number; endTime: number } {
  const endTime = Date.now();
  switch (range) {
    case "7d":
      return { startTime: endTime - 7 * DAY_MS, endTime };
    case "30d":
      return { startTime: endTime - 30 * DAY_MS, endTime };
    case "90d":
      return { startTime: endTime - 90 * DAY_MS, endTime };
    case "all":
      return { startTime: 0, endTime };
  }
}

function getEntityType(actionType: string): string {
  return actionType.split(".")[0];
}

function getDayKey(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getWeekKey(timestamp: number): string {
  const d = new Date(timestamp);
  const weekStart = new Date(d);
  weekStart.setDate(d.getDate() - d.getDay());
  return `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, "0")}-${String(weekStart.getDate()).padStart(2, "0")}`;
}

function generateTimeBuckets(
  startTime: number,
  endTime: number,
  granularity: "day" | "week"
): string[] {
  const buckets: string[] = [];
  const getKey = granularity === "day" ? getDayKey : getWeekKey;
  let current = startTime;
  const seen = new Set<string>();

  while (current <= endTime) {
    const key = getKey(current);
    if (!seen.has(key)) {
      seen.add(key);
      buckets.push(key);
    }
    current += granularity === "day" ? DAY_MS : WEEK_MS;
  }

  // Ensure the end bucket is included
  const endKey = getKey(endTime);
  if (!seen.has(endKey)) {
    buckets.push(endKey);
  }

  return buckets;
}

function bucketLabel(key: string, granularity: "day" | "week"): string {
  const [, m, d] = key.split("-").map(Number);
  if (granularity === "week") {
    return `Week of ${m}/${d}`;
  }
  return `${m}/${d}`;
}

const CHART_COLORS = {
  capture: "#f59e0b",
  task: "#6366f1",
  note: "#10b981",
  // Capture lifecycle
  "capture.created": "#f59e0b",
  "capture.completed": "#10b981",
  "capture.filed_as_task": "#6366f1",
  "capture.filed_as_note": "#8b5cf6",
  // Task flow
  opened: "#6366f1",
  closed: "#10b981",
  // Notes
  created: "#10b981",
  edited: "#6366f1",
  deleted: "#ef4444",
};

const TAG_FALLBACK_COLORS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
];

const CAPTURE_AGE_BUCKETS: { key: string; label: string; minDays: number; maxDays?: number }[] = [
  { key: "today", label: "0-1d", minDays: 0, maxDays: 0 }, // 0-24h only
  { key: "yesterday", label: "1-2d", minDays: 1, maxDays: 1 },
  { key: "recent", label: "2-3d", minDays: 2, maxDays: 3 },
  { key: "week", label: "4-7d", minDays: 4, maxDays: 7 },
  { key: "fortnight", label: "8-14d", minDays: 8, maxDays: 14 },
  { key: "stale", label: "15d+", minDays: 15 },
];

function fallbackColorFromId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return TAG_FALLBACK_COLORS[hash % TAG_FALLBACK_COLORS.length];
}

const STAT_COLORS = {
  neutral: "var(--foreground)",
  good: "#22c55e",
  bad: "#ef4444",
};

function StatCard({
  title,
  stats,
}: {
  title: string;
  stats: { label: string; value: number | string; color?: "neutral" | "good" | "bad" }[];
}) {
  return (
    <div className="bg-(--card-bg) border border-(--card-border) rounded-xl p-5">
      <h3 className="text-sm font-medium text-(--muted) mb-3">{title}</h3>
      <div className="flex flex-col gap-2">
        {stats.map((stat) => (
          <div key={stat.label} className="flex items-baseline justify-between gap-4">
            <span className="text-xs text-(--muted)">{stat.label}</span>
            <span
              className="text-xl font-bold tabular-nums"
              style={{ color: stat.color ? STAT_COLORS[stat.color] : STAT_COLORS.neutral }}
            >
              {stat.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-(--card-bg) border border-(--card-border) rounded-xl p-5">
      <h3 className="text-sm font-medium text-(--muted) mb-4">{title}</h3>
      <div className="h-64">{children}</div>
    </div>
  );
}

const TOOLTIP_STYLE = {
  backgroundColor: "var(--card-bg)",
  border: "1px solid var(--card-border)",
  borderRadius: "8px",
  boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
  fontSize: "12px",
};

function DashboardContent() {
  const [timeRange, setTimeRange] = useState<TimeRange>(() => getStoredTimeRange());
  const { allTags, selectedTag, selectedTagId, handleTagChange } = usePageTagFilter();

  useEffect(() => {
    localStorage.setItem(DASHBOARD_TIME_RANGE_KEY, timeRange);
  }, [timeRange]);

  const { startTime, endTime } = useMemo(
    () => getTimeRangeBounds(timeRange),
    [timeRange]
  );
  const events = useQuery(api.events.listByTimeRange, {
    startTime,
    endTime,
    tagId: selectedTagId ?? undefined,
  });
  const openCaptures = useQuery(api.captures.listOpenForDashboard, {});

  const granularity: "day" | "week" =
    timeRange === "90d" || timeRange === "all" ? "week" : "day";

  // Pre-compute aggregated data
  const { summaryStats, openCaptureStats, taskFlowData, taskByTagData, captureAgeData, taskTagSeries, noteByTagData } =
    useMemo(() => {
      const getKey = granularity === "day" ? getDayKey : getWeekKey;
      if (!events) {
        const openCount = openCaptures?.length ?? 0;
        const avgAgeDays =
          openCount > 0 && openCaptures
            ? openCaptures.reduce(
                (sum, c) => sum + (endTime - c._creationTime) / DAY_MS,
                0
              ) / openCount
            : null;
        return {
          summaryStats: null,
          openCaptureStats: { count: openCount, avgAgeDays },
          taskFlowData: [],
          taskByTagData: [],
          captureAgeData: CAPTURE_AGE_BUCKETS.map((bucket) => ({
            name: bucket.label,
            count: 0,
          })),
          taskTagSeries: [] as { key: string; name: string; color: string }[],
          noteByTagData: [] as { name: string; count: number; fill: string }[],
        };
      }

      // Summary stats
      const capturesAdded = events.filter(
        (e) => e.action.type === "capture.created"
      ).length;
      const capturesCompleted = events.filter(
        (e) => e.action.type === "capture.completed"
      ).length;
      const capturesFiled = events.filter(
        (e) =>
          e.action.type === "capture.filed_as_task" ||
          e.action.type === "capture.filed_as_note"
      ).length;
      const tasksOpened = events.filter(
        (e) => e.action.type === "task.created"
      ).length;
      const tasksClosed = events.filter(
        (e) =>
          e.action.type === "task.status_changed" &&
          "to" in e.action &&
          e.action.to === "closed"
      ).length;
      const summaryStats = {
        capturesAdded,
        capturesCompleted,
        capturesFiled,
        tasksOpened,
        tasksClosed,
        totalEvents: events.length,
      };

      // Generate time buckets to ensure empty periods are shown
      const effectiveStart =
        timeRange === "all" && events.length > 0
          ? Math.min(...events.map((e) => e.timestamp))
          : startTime;
      const buckets = generateTimeBuckets(effectiveStart, endTime, granularity);

      // Chart 1: Task flow -- opened vs closed
      const taskMap = new Map<string, { opened: number; closed: number }>();
      for (const key of buckets) {
        taskMap.set(key, { opened: 0, closed: 0 });
      }
      for (const e of events) {
        if (getEntityType(e.action.type) !== "task") continue;
        const key = getKey(e.timestamp);
        if (!taskMap.has(key)) {
          taskMap.set(key, { opened: 0, closed: 0 });
        }
        const bucket = taskMap.get(key)!;
        if (e.action.type === "task.created") {
          bucket.opened++;
        } else if (
          e.action.type === "task.status_changed" &&
          "to" in e.action &&
          e.action.to === "closed"
        ) {
          bucket.closed++;
        }
      }
      const taskData = Array.from(taskMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, counts]) => ({
          name: bucketLabel(key, granularity),
          ...counts,
        }));

      // Chart 2: Task activity by tag -- opened + closed
      const taskTagCounter = new Map<string, number>();
      for (const e of events) {
        if (getEntityType(e.action.type) !== "task") continue;
        const isTrackedTaskEvent =
          e.action.type === "task.created" ||
          (e.action.type === "task.status_changed" &&
            "to" in e.action &&
            e.action.to === "closed");
        if (!isTrackedTaskEvent) continue;

        const eventTagIds = e.tagIds && e.tagIds.length > 0 ? e.tagIds : (["__untagged__"] as string[]);
        for (const tagId of eventTagIds) {
          taskTagCounter.set(tagId, (taskTagCounter.get(tagId) ?? 0) + 1);
        }
      }

      const taskTagKeys = Array.from(taskTagCounter.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([tagId]) => tagId);
      if (!taskTagKeys.includes("__untagged__") && taskTagCounter.has("__untagged__")) {
        taskTagKeys.push("__untagged__");
      }

      const taskByTagMap = new Map<string, Record<string, number>>();
      for (const key of buckets) {
        const row: Record<string, number> = {};
        for (const tagKey of taskTagKeys) {
          row[tagKey] = 0;
        }
        taskByTagMap.set(key, row);
      }
      for (const e of events) {
        if (getEntityType(e.action.type) !== "task") continue;
        const isTrackedTaskEvent =
          e.action.type === "task.created" ||
          (e.action.type === "task.status_changed" &&
            "to" in e.action &&
            e.action.to === "closed");
        if (!isTrackedTaskEvent) continue;

        const key = getKey(e.timestamp);
        if (!taskByTagMap.has(key)) {
          const row: Record<string, number> = {};
          for (const tagKey of taskTagKeys) {
            row[tagKey] = 0;
          }
          taskByTagMap.set(key, row);
        }

        const candidateTagId =
          e.tagIds?.find((tagId) => taskTagKeys.includes(tagId)) ??
          (taskTagKeys.includes("__untagged__") ? "__untagged__" : null);
        if (!candidateTagId) {
          continue;
        }

        const bucket = taskByTagMap.get(key)!;
        bucket[candidateTagId] = (bucket[candidateTagId] ?? 0) + 1;
      }
      const taskByTagData = Array.from(taskByTagMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, counts]) => ({
          name: bucketLabel(key, granularity),
          ...counts,
        }));

      const taskTagSeries = taskTagKeys.map((tagKey) => {
        if (tagKey === "__untagged__") {
          return { key: tagKey, name: "Untagged", color: "#94a3b8" };
        }
        const tag = allTags.find((t) => t._id === tagKey);
        return {
          key: tagKey,
          name: tag?.name ?? "Unknown Tag",
          color: tag?.color ?? fallbackColorFromId(tagKey),
        };
      });

      // Chart 3: Open capture age distribution
      const captureAgeData = CAPTURE_AGE_BUCKETS.map((bucket) => ({
        name: bucket.label,
        count: 0,
      }));

      for (const capture of openCaptures ?? []) {
        const ageDays = Math.floor((endTime - capture._creationTime) / DAY_MS);
        const bucketIndex = CAPTURE_AGE_BUCKETS.findIndex((bucket) => {
          if (bucket.maxDays === undefined) {
            return ageDays >= bucket.minDays;
          }
          return ageDays >= bucket.minDays && ageDays <= bucket.maxDays;
        });
        if (bucketIndex >= 0) {
          captureAgeData[bucketIndex].count++;
        }
      }

      // Chart 4: Notes by tag (horizontal bars, sorted desc)
      const noteTagCounter = new Map<string, number>();
      for (const e of events) {
        if (getEntityType(e.action.type) !== "note") continue;
        const primaryTag = e.tagIds?.[0] ?? "__untagged__";
        noteTagCounter.set(primaryTag, (noteTagCounter.get(primaryTag) ?? 0) + 1);
      }
      const noteTagKeys = Array.from(noteTagCounter.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([tagId]) => tagId);
      const noteByTagData = noteTagKeys.map((tagKey) => {
        const count = noteTagCounter.get(tagKey)!;
        const name = tagKey === "__untagged__" ? "Untagged" : (allTags.find((t) => t._id === tagKey)?.name ?? "Unknown");
        const fill = tagKey === "__untagged__" ? "#94a3b8" : (allTags.find((t) => t._id === tagKey)?.color ?? fallbackColorFromId(tagKey));
        return { name, count, fill };
      });

      // Open capture stats (for first card)
      const openCount = openCaptures?.length ?? 0;
      const avgAgeDays =
        openCount > 0 && openCaptures
          ? openCaptures.reduce(
              (sum, c) => sum + (endTime - c._creationTime) / DAY_MS,
              0
            ) / openCount
          : null;

      return {
        summaryStats,
        openCaptureStats: { count: openCount, avgAgeDays },
        taskFlowData: taskData,
        taskByTagData,
        captureAgeData,
        taskTagSeries,
        noteByTagData,
      };
    }, [events, timeRange, startTime, endTime, granularity, allTags, openCaptures]);

  const isLoading = events === undefined || openCaptures === undefined;

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="pt-20 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <div className="flex items-center gap-3">
            {/* Time range selector */}
            <div className="flex items-center bg-(--card-bg) border border-(--card-border) rounded-lg overflow-hidden">
              {TIME_RANGES.map((range) => (
                <button
                  key={range.value}
                  onClick={() => setTimeRange(range.value)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    timeRange === range.value
                      ? "bg-(--accent)/15 text-accent"
                      : "text-(--muted) hover:text-foreground hover:bg-(--card-border)"
                  }`}
                >
                  {range.label}
                </button>
              ))}
            </div>
            {/* Tag filter */}
            <SearchTagSelector
              selectedTag={selectedTag}
              onTagChange={handleTagChange}
              allTags={allTags}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-32">
            <div className="flex items-center gap-3 text-(--muted)">
              <svg
                className="w-5 h-5 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span>Loading dashboard...</span>
            </div>
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-(--muted)">
            <svg
              className="w-16 h-16 mb-4 opacity-50"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            <p className="text-lg font-medium mb-1">No activity yet</p>
            <p className="text-sm">
              Events will appear here as you create captures, tasks, and notes.
            </p>
          </div>
        ) : (
          <>
            {/* Summary Stat Cards */}
            {(summaryStats || openCaptureStats) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                <StatCard
                  title="Open Captures"
                  stats={[
                    {
                      label: "Count",
                      value: openCaptureStats.count,
                      color: openCaptureStats.count === 0 ? "good" : "bad",
                    },
                    ...(openCaptureStats.avgAgeDays != null
                      ? [
                          {
                            label: "Avg age",
                            value: `${openCaptureStats.avgAgeDays.toFixed(1)}d`,
                            color: "neutral" as const,
                          },
                        ]
                      : []),
                  ]}
                />
                {summaryStats && (
                  <>
                    <StatCard
                      title="Tasks"
                      stats={[
                        { label: "Opened", value: summaryStats.tasksOpened, color: "neutral" as const },
                        { label: "Closed", value: summaryStats.tasksClosed, color: "good" as const },
                      ]}
                    />
                    <StatCard
                      title="Total Activity"
                      stats={[
                        { label: "Events", value: summaryStats.totalEvents, color: "neutral" as const },
                      ]}
                    />
                  </>
                )}
              </div>
            )}

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Chart 1: Task Flow */}
              <ChartCard title="Task Flow">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={taskFlowData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--card-border)"
                    />
                    <XAxis
                      dataKey="name"
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: "var(--card-border)" }}
                    />
                    <YAxis
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: "var(--card-border)" }}
                      allowDecimals={false}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="opened"
                      name="Opened"
                      stroke={CHART_COLORS.opened}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="closed"
                      name="Closed"
                      stroke={CHART_COLORS.closed}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Chart 2: Task Activity by Tag */}
              <ChartCard title="Task Activity by Tag">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={taskByTagData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--card-border)"
                    />
                    <XAxis
                      dataKey="name"
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: "var(--card-border)" }}
                    />
                    <YAxis
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: "var(--card-border)" }}
                      allowDecimals={false}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend />
                    {taskTagSeries.map((series) => (
                      <Bar
                        key={series.key}
                        dataKey={series.key}
                        name={series.name}
                        fill={series.color}
                        stackId="task-by-tag"
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Chart 3: Open Capture Age */}
              <ChartCard title="Open Capture Age">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={captureAgeData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--card-border)"
                    />
                    <XAxis
                      dataKey="name"
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: "var(--card-border)" }}
                    />
                    <YAxis
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: "var(--card-border)" }}
                      allowDecimals={false}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar
                      dataKey="count"
                      name="Open captures"
                      fill={CHART_COLORS["capture.created"]}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Chart 4: Notes by Tag */}
              <ChartCard title="Notes by Tag">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={noteByTagData} layout="vertical">
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--card-border)"
                    />
                    <XAxis
                      type="number"
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: "var(--card-border)" }}
                      allowDecimals={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: "var(--card-border)" }}
                      width={70}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar
                      dataKey="count"
                      name="Notes"
                      radius={[0, 4, 4, 0]}
                    >
                      {noteByTagData.map((entry) => (
                        <Cell key={entry.name} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default function DashboardPage() {
  const { session, isPending } = useAuthSession();

  if (isPending) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3 text-(--muted)">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        </div>
      </div>
    );
  }

  return session ? <DashboardContent /> : <SignIn />;
}
