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
          activityUrl: "https://www.strava.com/activities/20421937807",
          startedAt: "2026-10-02T15:46:42Z",
          distanceMeters: 4866.9,
          movingTimeSeconds: 1563,
          elapsedTimeSeconds: 1672,
          averageSpeedMetersPerSecond: 3.114,
          averageHeartRateBpm: 165.8,
        },
        latestRide: {
          sport: "ride",
          activityUrl: "https://www.strava.com/activities/20380252374",
          startedAt: "2026-09-29T14:15:57Z",
          distanceMeters: 35857.6,
          movingTimeSeconds: 6544,
          elapsedTimeSeconds: 6833,
          averageSpeedMetersPerSecond: 5.479,
          averagePowerWatts: 75.2,
          averageHeartRateBpm: 137.4,
        },
      },
    });
    edition.feed = feedSchema.parse(edition.feed);

    const html = renderEdition(
      edition.feed,
      "https://tasky.example.test",
    );

    expect(html).toContain("Latest run");
    expect(html).toContain("3.02 mi");
    expect(html).toContain("8:37 /mi");
    expect(html).toContain("Latest ride");
    expect(html).toContain("22.3 mi");
    expect(html).toContain("1h 49m");
    expect(html).toContain("75 W");
    expect(html).toContain("12.3 mph");
    expect(html).toContain("166 bpm");
    expect(html).toContain("137 bpm");
    expect(html).toContain(
      'href="https://www.strava.com/activities/20380252374"',
    );
  });
});
