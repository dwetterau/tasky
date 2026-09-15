import {
  exportSchema,
  feedSchema,
  type TaskyExport,
  type Feed,
  type ModuleSnapshot,
} from "@tasky/home-feed";
import { ingestTasky } from "../src/modules/tasky";
import { renderEdition } from "../src/rendering/page";
export function fixtureExport(
  userId = "user-a",
  revision = 1,
  now = Date.now(),
): TaskyExport {
  return exportSchema.parse({
    schemaVersion: 1,
    exportId: `${userId}-${revision}`,
    userId,
    timezone: "America/New_York",
    sourceRevision: revision,
    exportedAt: now,
    payload: {
      localDate: "2026-09-15",
      tasks: [
        {
          id: "task-1",
          title:
            userId === "user-a"
              ? "Make space for the work that matters this week"
              : "User B private task",
          priority: "high",
          status: "in_progress",
          dueDate: "2026-09-15",
          due: "today",
          labels: ["Personal", "Planning"],
        },
        {
          id: "task-2",
          title: "Finish the first version of the personal homepage",
          priority: "high",
          status: "agent_running",
          due: "none",
          labels: ["Tasky"],
        },
        {
          id: "task-3",
          title: "Book a table for Friday evening",
          priority: "medium",
          status: "not_started",
          dueDate: "2026-09-18",
          due: "upcoming",
          labels: ["Life"],
        },
        {
          id: "task-4",
          title: "Read through the new training plan",
          priority: "low",
          status: "not_started",
          due: "none",
          labels: [],
        },
      ],
      captures: [
        {
          id: "capture-1",
          text: "A long walk along the Hudson sounds good this weekend.",
          createdAt: now,
        },
        {
          id: "capture-2",
          text: "Look into a new recipe for Sunday dinner.",
          createdAt: now,
        },
      ],
      signals: [
        {
          id: "signal-1",
          name: "Strength training",
          kind: "activity",
          attention: "due",
          reason: "1 of 3 completed this week",
          ratio: 1 / 3,
          isComplete: false,
        },
        {
          id: "signal-2",
          name: "Water the plants",
          kind: "activity",
          attention: "soon",
          reason: "Last recorded 5 days ago",
          ratio: 0.7,
          isComplete: false,
        },
      ],
      scorecards: [
        {
          id: "card-1",
          name: "A good week",
          ratio: 0.6,
          isComplete: false,
          count: 3,
          target: 5,
        },
        {
          id: "card-2",
          name: "Daily essentials",
          ratio: 0.5,
          isComplete: false,
          count: 1,
          target: 2,
        },
      ],
      counts: { active: 14, dueToday: 1, overdue: 0, captures: 2 },
      truncated: false,
    },
  });
}
export function fixtureWeather(now = Date.now()): ModuleSnapshot {
  return {
    id: "weather",
    schemaVersion: 1,
    scope: "user",
    sourceDataAt: now,
    collectedAt: now,
    freshForMs: 7 * 3600_000,
    maxAgeMs: 12 * 3600_000,
    status: "available",
    payload: {
      location: "New York, NY · fixture",
      units: "F",
      current: {
        temperature: 73,
        description: "Partly sunny",
        observedAt: now,
      },
      forecast: [
        {
          date: "2026-09-15T07:00:00-04:00",
          high: 77,
          low: 64,
          description: "Partly sunny",
        },
        {
          date: "2026-09-16T07:00:00-04:00",
          high: 75,
          low: 63,
          description: "A few showers",
        },
        {
          date: "2026-09-17T07:00:00-04:00",
          high: 74,
          low: 62,
          description: "Mostly sunny",
        },
      ],
      forecastObservedAt: now,
      attributionUrl:
        "https://www.accuweather.com/en/us/new-york-ny/10007/weather-forecast/349727",
    },
  };
}
export function fixtureEdition(
  userId = "user-a",
  revision = 1,
  now = Date.now(),
  weather = true,
) {
  const feed: Feed = feedSchema.parse({
    schemaVersion: 1,
    userId,
    revision,
    publishedAt: now,
    timezone: "America/New_York",
    displayName: "Fixture",
    modules: [
      ingestTasky(fixtureExport(userId, revision, now)),
      ...(weather ? [fixtureWeather(now)] : []),
    ],
  });
  return {
    schemaVersion: 1 as const,
    feed,
    html: renderEdition(feed, "https://tasky.example.test", true),
  };
}
