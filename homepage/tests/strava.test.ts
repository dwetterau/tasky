// Strava activity records below are synthetic; never substitute personal activity exports.
import { describe, expect, it } from "vitest";
import { feedSchema } from "@tasky/home-feed";
import { renderEdition } from "../src/rendering/page";
import { fixtureEdition } from "./fixtures";

describe("Strava homepage module", () => {
  it("renders normalized summaries with links and heart rate", () => {
    const now = Date.parse("2026-10-04T14:00:00Z");
    const edition = fixtureEdition("user-a", 1, now);
    edition.feed.modules.push({
      id: "strava",
      schemaVersion: 1,
      scope: "user",
      sourceDataAt: now,
      collectedAt: now,
      freshForMs: 30 * 60 * 60_000,
      maxAgeMs: 7 * 24 * 60 * 60_000,
      status: "available",
      payload: {
        latestRun: {
          sport: "run",
          activityUrl: "https://www.strava.com/activities/00000000001",
          startedAt: "2020-01-02T12:00:00Z",
          distanceMeters: 5000,
          totalElevationGainMeters: 10,
          movingTimeSeconds: 1500,
          elapsedTimeSeconds: 1600,
          averageSpeedMetersPerSecond: 3.333,
          averageHeartRateBpm: 150,
        },
        latestRide: {
          sport: "ride",
          activityUrl: "https://www.strava.com/activities/00000000002",
          startedAt: "2020-01-01T12:00:00Z",
          distanceMeters: 30000,
          totalElevationGainMeters: 200,
          movingTimeSeconds: 6000,
          elapsedTimeSeconds: 6300,
          averageSpeedMetersPerSecond: 5,
          averagePowerWatts: 100,
          averageHeartRateBpm: 130,
        },
      },
    });
    edition.feed = feedSchema.parse(edition.feed);

    const html = renderEdition(
      edition.feed,
      "https://tasky.example.test",
    );

    expect(html).toContain("Latest run");
    expect(html).toContain("3.11 mi");
    expect(html).toContain("8:03 /mi");
    expect(html).toContain("Latest ride");
    expect(html).toContain("18.6 mi");
    expect(html).toContain("1h 40m");
    expect(html).toContain("100 W");
    expect(html.match(/Avg power/g)).toHaveLength(1);
    expect(html).toContain("11.2 mph");
    expect(html).toContain("33 ft");
    expect(html).toContain("656 ft");
    expect(html).toContain("150 bpm");
    expect(html).toContain("130 bpm");
    expect(html).toContain(
      'href="https://www.strava.com/activities/00000000002"',
    );
  });
});
