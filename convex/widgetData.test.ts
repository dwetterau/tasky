import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import {
  getLatestWidgetData,
  projectLatestWidget,
  projectLatestWidgets,
} from "./widgetData";
import { moduleSchema } from "../packages/home-feed/src/index";

describe("widget data", () => {
  it("finds the newest row by user and kind", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.widgetData.publishFromMcp, {
      userId: "user-a",
      kind: "briefing",
      schemaVersion: 1,
      dataJson: JSON.stringify({ markdown: "# Morning" }),
    });
    await t.mutation(internal.widgetData.publishFromMcp, {
      userId: "user-b",
      kind: "briefing",
      schemaVersion: 1,
      dataJson: JSON.stringify({ markdown: "# Private" }),
    });
    const evening = await t.mutation(internal.widgetData.publishFromMcp, {
      userId: "user-a",
      kind: "briefing",
      schemaVersion: 1,
      dataJson: JSON.stringify({ markdown: "# Evening" }),
    });

    const latest = await t.run((ctx) =>
      getLatestWidgetData(ctx, "user-a", "briefing"),
    );
    expect(latest?._id).toBe(evening.id);
    expect(JSON.parse(latest!.dataJson)).toEqual({ markdown: "# Evening" });
  });

  it("deduplicates retry keys and rejects conflicting reuse", async () => {
    const t = convexTest(schema, modules);
    const input = {
      userId: "user-a",
      kind: "briefing" as const,
      schemaVersion: 1,
      dataJson: JSON.stringify({ markdown: "# Morning" }),
      idempotencyKey: "briefing:2026-09-30:morning",
    };
    const first = await t.mutation(
      internal.widgetData.publishFromMcp,
      input,
    );
    const retry = await t.mutation(
      internal.widgetData.publishFromMcp,
      input,
    );
    expect(retry).toEqual({ ...first, duplicate: true });

    await expect(
      t.mutation(internal.widgetData.publishFromMcp, {
        ...input,
        dataJson: JSON.stringify({ markdown: "# Different" }),
      }),
    ).rejects.toThrow(
      "idempotencyKey was already used with different widget data",
    );
  });

  it("projects only schema-valid briefing data for the homepage", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.widgetData.publishFromMcp, {
      userId: "user-a",
      kind: "briefing",
      schemaVersion: 1,
      dataJson: JSON.stringify({ markdown: "  # Briefing  " }),
    });
    const projected = await t.run((ctx) =>
      projectLatestWidget(ctx, "user-a", Date.now(), "briefing"),
    );
    const latest = await t.run((ctx) =>
      getLatestWidgetData(ctx, "user-a", "briefing"),
    );
    expect(projected).toMatchObject({
      id: "briefing",
      schemaVersion: 1,
      sourceDataAt: Math.floor(latest!._creationTime),
      payload: { markdown: "# Briefing" },
    });
    expect(() => moduleSchema.parse(projected)).not.toThrow();
  });

  it("projects every registered widget with its own freshness policy", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.widgetData.publishFromMcp, {
      userId: "user-a",
      kind: "on-this-day",
      schemaVersion: 1,
      dataJson: JSON.stringify({
        date: "2026-10-08",
        markdown: "- **2021:** Moved into a new apartment.",
      }),
    });
    await t.mutation(internal.widgetData.publishFromMcp, {
      userId: "user-a",
      kind: "strava",
      schemaVersion: 1,
      dataJson: JSON.stringify({
        latestRun: {
          sport: "run",
          activityUrl: "https://www.strava.com/activities/20421937807",
          startedAt: "2026-10-02T15:46:42Z",
          distanceMeters: 4866.9,
          totalElevationGainMeters: 13,
          movingTimeSeconds: 1563,
          averageSpeedMetersPerSecond: 3.114,
          averageHeartRateBpm: 165.8,
        },
        latestRide: {
          sport: "ride",
          activityUrl: "https://www.strava.com/activities/20380252374",
          startedAt: "2026-09-29T14:15:57Z",
          distanceMeters: 35857.6,
          totalElevationGainMeters: 214.3,
          movingTimeSeconds: 6544,
          averageSpeedMetersPerSecond: 5.479,
          averagePowerWatts: 75.2,
          averageHeartRateBpm: 137.4,
        },
      }),
    });
    await t.mutation(internal.widgetData.publishFromMcp, {
      userId: "user-a",
      kind: "releases",
      schemaVersion: 1,
      dataJson: JSON.stringify({
        asOf: "2026-10-04",
        releases: [
          {
            kind: "tv",
            title: "Blue Eye Samurai",
            detail: "Season 2",
            releaseDate: "2027-01",
          },
        ],
      }),
    });
    await t.mutation(internal.widgetData.publishFromMcp, {
      userId: "user-a",
      kind: "recurring-expenses",
      schemaVersion: 1,
      dataJson: JSON.stringify({
        asOf: "2026-10-04",
        currency: "USD",
        upcomingExpenses: [
          {
            name: "Cloud storage",
            monthlyAmount: 2.99,
            category: "Software",
            nextPaymentDate: "2026-10-05",
          },
        ],
        monthlyTotals: {
          month: "2026-10",
          byCategory: [
            { category: "Housing", totalMonthlyAmount: 3200 },
            { category: "Software", totalMonthlyAmount: 42.98 },
          ],
        },
      }),
    });

    const projected = await t.run((ctx) =>
      projectLatestWidgets(ctx, "user-a", Date.now()),
    );
    expect(projected).toHaveLength(4);
    expect(projected[0]).toMatchObject({
      id: "on-this-day",
      schemaVersion: 1,
      freshForMs: 18 * 60 * 60_000,
      maxAgeMs: 7 * 24 * 60 * 60_000,
      payload: {
        date: "2026-10-08",
        markdown: "- **2021:** Moved into a new apartment.",
      },
    });
    expect(() => moduleSchema.parse(projected[0])).not.toThrow();
    expect(projected[1]).toMatchObject({
      id: "strava",
      schemaVersion: 1,
      freshForMs: 30 * 60 * 60_000,
      maxAgeMs: 7 * 24 * 60 * 60_000,
      payload: {
        latestRun: {
          sport: "run",
          distanceMeters: 4866.9,
          totalElevationGainMeters: 13,
        },
        latestRide: {
          sport: "ride",
          averagePowerWatts: 75.2,
          averageHeartRateBpm: 137.4,
        },
      },
    });
    expect(() => moduleSchema.parse(projected[1])).not.toThrow();
    expect(projected[2]).toMatchObject({
      id: "releases",
      schemaVersion: 1,
      freshForMs: 8 * 24 * 60 * 60_000,
      maxAgeMs: 21 * 24 * 60 * 60_000,
      payload: {
        asOf: "2026-10-04",
        releases: [
          {
            kind: "tv",
            title: "Blue Eye Samurai",
            releaseDate: "2027-01",
          },
        ],
      },
    });
    expect(() => moduleSchema.parse(projected[2])).not.toThrow();
    expect(projected[3]).toMatchObject({
      id: "recurring-expenses",
      schemaVersion: 1,
      freshForMs: 8 * 24 * 60 * 60_000,
      maxAgeMs: 21 * 24 * 60 * 60_000,
      payload: {
        asOf: "2026-10-04",
        currency: "USD",
        upcomingExpenses: [
          {
            name: "Cloud storage",
            monthlyAmount: 2.99,
            category: "Software",
            nextPaymentDate: "2026-10-05",
          },
        ],
        monthlyTotals: {
          month: "2026-10",
          byCategory: [
            { category: "Housing", totalMonthlyAmount: 3200 },
            { category: "Software", totalMonthlyAmount: 42.98 },
          ],
        },
      },
    });
    expect(() => moduleSchema.parse(projected[3])).not.toThrow();
  });
});
