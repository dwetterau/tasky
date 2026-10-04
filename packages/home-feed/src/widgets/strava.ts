import { z } from "zod";

export const STRAVA_SCHEMA_VERSION = 1 as const;

const stravaActivityUrlSchema = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "www.strava.com" &&
      /^\/activities\/\d+\/?$/.test(url.pathname)
    );
  }, "Must be an HTTPS Strava activity URL");

const activityFields = {
  activityUrl: stravaActivityUrlSchema.describe(
    "Canonical Strava activity link, for example https://www.strava.com/activities/20421937807.",
  ),
  startedAt: z
    .string()
    .datetime({ offset: true })
    .describe("Activity start time from Strava's start_date field."),
  distanceMeters: z
    .number()
    .positive()
    .max(10_000_000)
    .describe("Distance in meters from Strava's distance field."),
  movingTimeSeconds: z
    .number()
    .int()
    .nonnegative()
    .max(7 * 24 * 60 * 60)
    .describe("Moving time in seconds from Strava's moving_time field."),
  elapsedTimeSeconds: z
    .number()
    .int()
    .nonnegative()
    .max(7 * 24 * 60 * 60)
    .optional()
    .describe("Optional elapsed time in seconds from elapsed_time."),
  averageSpeedMetersPerSecond: z
    .number()
    .positive()
    .max(100)
    .describe(
      "Average speed in meters per second from average_speed; clients derive pace from it.",
    ),
  averagePowerWatts: z
    .number()
    .nonnegative()
    .max(10_000)
    .optional()
    .describe("Optional average power from average_watts."),
  averageHeartRateBpm: z
    .number()
    .positive()
    .max(300)
    .optional()
    .describe("Optional average heart rate in BPM from average_heartrate."),
};

export const stravaActivitySchema = z.discriminatedUnion("sport", [
  z.object({ sport: z.literal("run"), ...activityFields }).strict(),
  z.object({ sport: z.literal("ride"), ...activityFields }).strict(),
]);

export const stravaPayloadSchema = z
  .object({
    latestRun: z
      .object({ sport: z.literal("run"), ...activityFields })
      .strict(),
    latestRide: z
      .object({ sport: z.literal("ride"), ...activityFields })
      .strict(),
  })
  .strict();

export type StravaActivity = z.infer<typeof stravaActivitySchema>;
export type StravaPayload = z.infer<typeof stravaPayloadSchema>;

const METERS_PER_MILE = 1609.344;
const MILES_PER_METER = 1 / METERS_PER_MILE;
const MILES_PER_HOUR_PER_METER_PER_SECOND = 2.2369362921;

export function formatStravaDistance(distanceMeters: number): string {
  const miles = distanceMeters * MILES_PER_METER;
  return `${miles.toFixed(miles >= 10 ? 1 : 2)} mi`;
}

export function formatStravaDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  return hours > 0
    ? `${hours}h ${minutes.toString().padStart(2, "0")}m`
    : `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function formatStravaPace(activity: StravaActivity): string {
  if (activity.sport === "ride") {
    return `${(
      activity.averageSpeedMetersPerSecond *
      MILES_PER_HOUR_PER_METER_PER_SECOND
    ).toFixed(1)} mph`;
  }
  const secondsPerMile =
    METERS_PER_MILE / activity.averageSpeedMetersPerSecond;
  const minutes = Math.floor(secondsPerMile / 60);
  const seconds = Math.round(secondsPerMile % 60);
  if (seconds === 60) return `${minutes + 1}:00 /mi`;
  return `${minutes}:${seconds.toString().padStart(2, "0")} /mi`;
}
