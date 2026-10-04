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
      kind: "strava",
      schemaVersion: 1,
      dataJson: JSON.stringify({
        latestRun: {
          sport: "run",
          activityUrl: "https://www.strava.com/activities/20421937807",
          startedAt: "2026-10-02T15:46:42Z",
          distanceMeters: 4866.9,
          movingTimeSeconds: 1563,
          averageSpeedMetersPerSecond: 3.114,
          averageHeartRateBpm: 165.8,
        },
        latestRide: {
          sport: "ride",
          activityUrl: "https://www.strava.com/activities/20380252374",
          startedAt: "2026-09-29T14:15:57Z",
          distanceMeters: 35857.6,
          movingTimeSeconds: 6544,
          averageSpeedMetersPerSecond: 5.479,
          averagePowerWatts: 75.2,
          averageHeartRateBpm: 137.4,
        },
      }),
    });

    const projected = await t.run((ctx) =>
      projectLatestWidgets(ctx, "user-a", Date.now()),
    );
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({
      id: "strava",
      schemaVersion: 1,
      freshForMs: 30 * 60 * 60_000,
      maxAgeMs: 7 * 24 * 60 * 60_000,
      payload: {
        latestRun: { sport: "run", distanceMeters: 4866.9 },
        latestRide: {
          sport: "ride",
          averagePowerWatts: 75.2,
          averageHeartRateBpm: 137.4,
        },
      },
    });
    expect(() => moduleSchema.parse(projected[0])).not.toThrow();
  });
});
