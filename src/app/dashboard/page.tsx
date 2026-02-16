"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Navigation } from "../../components/Navigation";
import { SearchTagSelector, Tag } from "../../components/TagSelector";
import { useAuthSession } from "@/lib/useAuthSession";
import { SignIn } from "@/components/SignIn";
import { useState, useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatWeek(timestamp: number): string {
  const d = new Date(timestamp);
  const weekStart = new Date(d);
  weekStart.setDate(d.getDate() - d.getDay());
  return `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;
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
  const [y, m, d] = key.split("-").map(Number);
  if (granularity === "week") {
    return `Week of ${m}/${d}`;
  }
  return `${m}/${d}`;
}

type Event = {
  _id: string;
  timestamp: number;
  action: { type: string; from?: string; to?: string };
  tagIds?: string[];
};

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
};

function StatCard({
  title,
  stats,
}: {
  title: string;
  stats: { label: string; value: number; color?: string }[];
}) {
  return (
    <div className="bg-(--card-bg) border border-(--card-border) rounded-xl p-5">
      <h3 className="text-sm font-medium text-(--muted) mb-3">{title}</h3>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {stats.map((stat) => (
          <div key={stat.label}>
            <div
              className="text-2xl font-bold"
              style={{ color: stat.color }}
            >
              {stat.value}
            </div>
            <div className="text-xs text-(--muted)">{stat.label}</div>
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
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [tagId, setTagId] = useState<Id<"tags"> | null>(null);

  const tags = useQuery(api.tags.list);
  const allTags: Tag[] = useMemo(
    () => (tags ?? []).map((t) => ({ _id: t._id, name: t.name, color: t.color })),
    [tags]
  );
  const selectedTag = useMemo(
    () => allTags.find((t) => t._id === tagId) ?? null,
    [allTags, tagId]
  );

  const { startTime, endTime } = useMemo(
    () => getTimeRangeBounds(timeRange),
    [timeRange]
  );
  const events = useQuery(api.events.listByTimeRange, {
    startTime,
    endTime,
    tagId: tagId ?? undefined,
  });

  const granularity: "day" | "week" =
    timeRange === "90d" || timeRange === "all" ? "week" : "day";

  // Pre-compute aggregated data
  const { summaryStats, activityData, captureData, taskData, noteData } =
    useMemo(() => {
      const getKey = granularity === "day" ? getDayKey : getWeekKey;
      if (!events) {
        return {
          summaryStats: null,
          activityData: [],
          captureData: [],
          taskData: [],
          noteData: [],
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
      const notesCreated = events.filter(
        (e) => e.action.type === "note.created"
      ).length;
      const notesEdited = events.filter(
        (e) => e.action.type === "note.edited"
      ).length;

      const summaryStats = {
        capturesAdded,
        capturesCompleted,
        capturesFiled,
        tasksOpened,
        tasksClosed,
        notesCreated,
        notesEdited,
        totalEvents: events.length,
      };

      // Generate time buckets to ensure empty periods are shown
      const effectiveStart =
        timeRange === "all" && events.length > 0
          ? Math.min(...events.map((e) => e.timestamp))
          : startTime;
      const buckets = generateTimeBuckets(effectiveStart, endTime, granularity);

      // Chart 1: Activity Overview -- events by entity type per bucket
      const activityMap = new Map<
        string,
        { capture: number; task: number; note: number }
      >();
      for (const key of buckets) {
        activityMap.set(key, { capture: 0, task: 0, note: 0 });
      }
      for (const e of events) {
        const key = getKey(e.timestamp);
        const entityType = getEntityType(e.action.type);
        if (!activityMap.has(key)) {
          activityMap.set(key, { capture: 0, task: 0, note: 0 });
        }
        const bucket = activityMap.get(key)!;
        if (entityType === "capture") bucket.capture++;
        else if (entityType === "task") bucket.task++;
        else if (entityType === "note") bucket.note++;
      }
      const activityData = Array.from(activityMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, counts]) => ({
          name: bucketLabel(key, granularity),
          ...counts,
        }));

      // Chart 2: Capture lifecycle
      const captureMap = new Map<
        string,
        { created: number; completed: number; filedAsTask: number; filedAsNote: number }
      >();
      for (const key of buckets) {
        captureMap.set(key, {
          created: 0,
          completed: 0,
          filedAsTask: 0,
          filedAsNote: 0,
        });
      }
      for (const e of events) {
        if (getEntityType(e.action.type) !== "capture") continue;
        const key = getKey(e.timestamp);
        if (!captureMap.has(key)) {
          captureMap.set(key, {
            created: 0,
            completed: 0,
            filedAsTask: 0,
            filedAsNote: 0,
          });
        }
        const bucket = captureMap.get(key)!;
        switch (e.action.type) {
          case "capture.created":
            bucket.created++;
            break;
          case "capture.completed":
            bucket.completed++;
            break;
          case "capture.filed_as_task":
            bucket.filedAsTask++;
            break;
          case "capture.filed_as_note":
            bucket.filedAsNote++;
            break;
        }
      }
      const captureData = Array.from(captureMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, counts]) => ({
          name: bucketLabel(key, granularity),
          ...counts,
        }));

      // Chart 3: Task flow -- opened vs closed
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

      // Chart 4: Notes activity -- created vs edited
      const noteMap = new Map<string, { created: number; edited: number }>();
      for (const key of buckets) {
        noteMap.set(key, { created: 0, edited: 0 });
      }
      for (const e of events) {
        if (getEntityType(e.action.type) !== "note") continue;
        const key = getKey(e.timestamp);
        if (!noteMap.has(key)) {
          noteMap.set(key, { created: 0, edited: 0 });
        }
        const bucket = noteMap.get(key)!;
        if (e.action.type === "note.created") {
          bucket.created++;
        } else if (e.action.type === "note.edited") {
          bucket.edited++;
        }
      }
      const noteData = Array.from(noteMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, counts]) => ({
          name: bucketLabel(key, granularity),
          ...counts,
        }));

      return { summaryStats, activityData, captureData, taskData, noteData };
    }, [events, timeRange, startTime, endTime, granularity]);

  const isLoading = events === undefined;

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
              onTagChange={(value) => {
                if (value === null || value === "__no_tag__") {
                  setTagId(null);
                } else {
                  setTagId(value as Id<"tags">);
                }
              }}
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
            {summaryStats && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <StatCard
                  title="Captures"
                  stats={[
                    {
                      label: "Added",
                      value: summaryStats.capturesAdded,
                      color: CHART_COLORS["capture.created"],
                    },
                    {
                      label: "Completed",
                      value: summaryStats.capturesCompleted,
                      color: CHART_COLORS["capture.completed"],
                    },
                    {
                      label: "Filed",
                      value: summaryStats.capturesFiled,
                      color: CHART_COLORS["capture.filed_as_task"],
                    },
                  ]}
                />
                <StatCard
                  title="Tasks"
                  stats={[
                    {
                      label: "Opened",
                      value: summaryStats.tasksOpened,
                      color: CHART_COLORS.opened,
                    },
                    {
                      label: "Closed",
                      value: summaryStats.tasksClosed,
                      color: CHART_COLORS.closed,
                    },
                  ]}
                />
                <StatCard
                  title="Notes"
                  stats={[
                    {
                      label: "Created",
                      value: summaryStats.notesCreated,
                      color: CHART_COLORS.created,
                    },
                    {
                      label: "Edited",
                      value: summaryStats.notesEdited,
                      color: CHART_COLORS.edited,
                    },
                  ]}
                />
                <StatCard
                  title="Total Activity"
                  stats={[
                    { label: "Events", value: summaryStats.totalEvents },
                  ]}
                />
              </div>
            )}

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Chart 1: Activity Overview */}
              <ChartCard title="Activity Overview">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={activityData}>
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
                    <Bar
                      dataKey="capture"
                      name="Captures"
                      fill={CHART_COLORS.capture}
                      stackId="activity"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="task"
                      name="Tasks"
                      fill={CHART_COLORS.task}
                      stackId="activity"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="note"
                      name="Notes"
                      fill={CHART_COLORS.note}
                      stackId="activity"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Chart 2: Capture Lifecycle */}
              <ChartCard title="Capture Lifecycle">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={captureData}>
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
                    <Bar
                      dataKey="created"
                      name="Created"
                      fill={CHART_COLORS["capture.created"]}
                      stackId="capture"
                    />
                    <Bar
                      dataKey="completed"
                      name="Completed"
                      fill={CHART_COLORS["capture.completed"]}
                      stackId="capture"
                    />
                    <Bar
                      dataKey="filedAsTask"
                      name="Filed as Task"
                      fill={CHART_COLORS["capture.filed_as_task"]}
                      stackId="capture"
                    />
                    <Bar
                      dataKey="filedAsNote"
                      name="Filed as Note"
                      fill={CHART_COLORS["capture.filed_as_note"]}
                      stackId="capture"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Chart 3: Task Flow */}
              <ChartCard title="Task Flow">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={taskData}>
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
                    <Bar
                      dataKey="opened"
                      name="Opened"
                      fill={CHART_COLORS.opened}
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="closed"
                      name="Closed"
                      fill={CHART_COLORS.closed}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Chart 4: Notes Activity */}
              <ChartCard title="Notes Activity">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={noteData}>
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
                    <Bar
                      dataKey="created"
                      name="Created"
                      fill={CHART_COLORS.created}
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="edited"
                      name="Edited"
                      fill={CHART_COLORS.edited}
                      radius={[4, 4, 0, 0]}
                    />
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
