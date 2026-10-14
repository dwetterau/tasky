import { z } from "zod";

export const WEATHER_SCHEMA_VERSION = 1 as const;
export const WEATHER_FRESH_FOR_MS = 7 * 60 * 60_000;
export const WEATHER_MAX_AGE_MS = 12 * 60 * 60_000;

const timestamp = z.number().int().nonnegative();
const description = z.string().max(240);

export const weatherPayloadSchema = z
  .object({
    location: z.string().max(120),
    units: z.enum(["F", "C"]),
    current: z
      .object({
        temperature: z.number(),
        realFeelTemperature: z.number().nullable().optional(),
        relativeHumidity: z.number().min(0).max(100).nullable().optional(),
        description,
        observedAt: timestamp,
        isDay: z.boolean().optional(),
      })
      .strict()
      .nullable(),
    forecast: z
      .array(
        z
          .object({
            date: z.string().datetime({ offset: true }),
            location: z.string().trim().min(1).max(120).optional(),
            high: z.number(),
            low: z.number(),
            description,
            rainProbability: z.number().min(0).max(100).nullable().optional(),
          })
          .strict(),
      )
      .max(5),
    forecastObservedAt: timestamp.nullable(),
    forecastFetchedAt: timestamp.nullable().optional(),
    hourly: z
      .array(
        z
          .object({
            at: timestamp,
            rainProbability: z.number().min(0).max(100).nullable(),
          })
          .strict(),
      )
      .max(24)
      .optional(),
    hourlyFetchedAt: timestamp.nullable().optional(),
    attributionUrl: z
      .url()
      .refine((value) => new URL(value).protocol === "https:"),
  })
  .strict();

export type WeatherPayload = z.infer<typeof weatherPayloadSchema>;

export function weatherForecastLocation(
  day: WeatherPayload["forecast"][number],
  fallbackLocation: string,
): string {
  return day.location ?? fallbackLocation;
}
