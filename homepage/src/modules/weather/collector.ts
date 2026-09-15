import { z } from "zod";
import {
  weatherPayloadSchema,
  type ModuleSnapshot,
  type WeatherPayload,
} from "@tasky/home-feed";
import type { Env } from "../../env";
import { taskyService } from "../../ingestion/tasky-service";
import { missingModule } from "../contract";
import { weatherModule } from "./index";

export const weatherConfigSchema = z
  .object({
    locationKey: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
    locationName: z.string().min(1).max(120),
    units: z.enum(["F", "C"]).default("F"),
    language: z
      .string()
      .regex(/^[a-z]{2}(-[a-z]{2})?$/)
      .default("en-us"),
    currentIntervalMinutes: z.number().int().min(60).max(720).default(120),
    forecastIntervalMinutes: z.number().int().min(180).max(720).default(360),
    dailyRequestBudget: z.number().int().min(2).max(100).default(20),
  })
  .strict();
export type WeatherConfig = z.infer<typeof weatherConfigSchema>;
type Part = "current" | "forecast" | "hourly";
export type WeatherState = {
  configKey: string;
  forecastVersion?: number;
  payload: WeatherPayload | null;
  nextCurrent: number;
  nextForecast: number;
  nextHourly?: number;
  hourlyVersion?: number;
  collectedAt: number | null;
  error?: ModuleSnapshot["error"];
  failures: number;
  nextCheck: number;
  requestTimes: number[];
  disabled?: boolean;
  errors?: Partial<Record<Part, ModuleSnapshot["error"]>>;
};
const currentResponse = z
  .array(
    z.object({
      EpochTime: z.number(),
      WeatherText: z.string(),
      IsDayTime: z.boolean().optional(),
      Temperature: z.object({
        Imperial: z.object({ Value: z.number() }),
        Metric: z.object({ Value: z.number() }),
      }),
      Link: z.string(),
    }),
  )
  .min(1);
const forecastResponse = z.object({
  Headline: z.object({ Link: z.string() }),
  DailyForecasts: z
    .array(
      z.object({
        Date: z.string().datetime({ offset: true }),
        Temperature: z.object({
          Minimum: z.object({ Value: z.number() }),
          Maximum: z.object({ Value: z.number() }),
        }),
        Day: z.object({
          IconPhrase: z.string(),
          RainProbability: z.number().min(0).max(100).nullish(),
        }),
      }),
    )
    .min(1)
    .max(5),
});
const hourlyResponse = z
  .array(
    z.object({
      DateTime: z.string().datetime({ offset: true }),
      RainProbability: z.number().min(0).max(100).nullish(),
    }),
  )
  .min(1)
  .max(24);

export function normalizeHourly(raw: unknown, fetchedAt: number) {
  return {
    hourly: hourlyResponse
      .parse(raw)
      .map((hour) => ({
        at: Date.parse(hour.DateTime),
        rainProbability: hour.RainProbability ?? null,
      }))
      .sort((a, b) => a.at - b.at),
    hourlyFetchedAt: fetchedAt,
  };
}

function providerLink(value: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !(
      url.hostname === "accuweather.com" ||
      url.hostname.endsWith(".accuweather.com")
    ) ||
    url.username ||
    url.password
  )
    throw new Error("Invalid provider link");
  // AccuWeather still returns HTTP attribution URLs; render their HTTPS versions.
  url.protocol = "https:";
  return url.toString();
}
export function normalizeCurrent(raw: unknown, units: "F" | "C") {
  const first = currentResponse.parse(raw)[0];
  const observedAt = first.EpochTime * 1000;
  if (observedAt > Date.now() + 60_000 || observedAt < 0)
    throw new Error("Invalid observation time");
  return {
    current: {
      temperature:
        units === "F"
          ? first.Temperature.Imperial.Value
          : first.Temperature.Metric.Value,
      description: first.WeatherText.slice(0, 240),
      observedAt,
      ...(first.IsDayTime !== undefined ? { isDay: first.IsDayTime } : {}),
    },
    attributionUrl: providerLink(first.Link),
  };
}
export function normalizeForecast(
  raw: unknown,
  issuedAt: number,
  fetchedAt: number,
) {
  const value = forecastResponse.parse(raw);
  return {
    forecast: value.DailyForecasts.map((day) => ({
      date: day.Date,
      high: day.Temperature.Maximum.Value,
      low: day.Temperature.Minimum.Value,
      description: day.Day.IconPhrase.slice(0, 240),
      rainProbability: day.Day.RainProbability ?? null,
    })),
    forecastObservedAt: issuedAt,
    forecastFetchedAt: fetchedAt,
    attributionUrl: providerLink(value.Headline.Link),
  };
}
function retryDelay(response: Response, now: number) {
  const value = response.headers.get("retry-after");
  const seconds = Number(value);
  return Math.max(
    3600_000,
    value
      ? Number.isFinite(seconds)
        ? seconds * 1000
        : Math.max(0, Date.parse(value) - now) || 0
      : 0,
  );
}
function cacheDelay(response: Response, now: number) {
  const maxAge = /max-age=(\d+)/i.exec(
    response.headers.get("cache-control") ?? "",
  );
  const expires = Date.parse(response.headers.get("expires") ?? "");
  return Math.max(
    maxAge ? Number(maxAge[1]) * 1000 : 0,
    Number.isFinite(expires) ? expires - now : 0,
  );
}
function snapshot(state: WeatherState): ModuleSnapshot {
  if (state.disabled) return missingModule(weatherModule, true);
  const times = [
    state.payload?.current?.observedAt,
    state.payload?.forecastObservedAt,
    state.payload?.hourlyFetchedAt,
  ].filter((t): t is number => typeof t === "number");
  return {
    id: "weather",
    schemaVersion: 1,
    scope: "user",
    sourceDataAt: times.length ? Math.min(...times) : null,
    collectedAt: state.collectedAt,
    freshForMs: weatherModule.freshForMs,
    maxAgeMs: weatherModule.maxAgeMs,
    status: state.payload ? "available" : "unavailable",
    ...(state.error ? { error: state.error } : {}),
    payload: state.payload,
  };
}

/** Platform owns durable state/serialization; adapter owns provider URLs and
 * normalization. Credentials are fetched only on this background path. */
export async function collectWeather(
  env: Env,
  userId: string,
  config: WeatherConfig | null,
  state: WeatherState | undefined,
  save: (state: WeatherState) => Promise<void>,
  now = Date.now(),
): Promise<{ state?: WeatherState; snapshot?: ModuleSnapshot }> {
  if (!config) return { snapshot: missingModule(weatherModule, true) };
  // Retry data rejected by the older parser while retaining the request budget.
  const configKey = JSON.stringify({ normalizationVersion: 2, ...config });
  if (!state || state.configKey !== configKey)
    state = {
      configKey,
      payload: null,
      nextCurrent: 0,
      nextForecast: 0,
      collectedAt: null,
      failures: 0,
      nextCheck: 0,
      requestTimes: state?.requestTimes ?? [],
    };
  // Fetch detailed forecasts once after upgrading, preserving current conditions
  // and every reserved provider call in the rolling request budget.
  if (state.forecastVersion !== 2) {
    state.forecastVersion = 2;
    state.nextForecast = 0;
    state.nextCheck = 0;
  }
  if (state.nextHourly === undefined || state.hourlyVersion !== 1) {
    state.hourlyVersion = 1;
    state.nextHourly = 0;
    state.nextCheck = 0;
  }
  // A rolling window also survives configuration changes; changing location
  // must not buy another day's worth of requests.
  state.requestTimes = state.requestTimes.filter(
    (time) => time > now - 86400_000,
  );
  // Recover older service failures that were treated as bad provider credentials.
  if (
    state.error === "configuration" &&
    !state.requestTimes.length &&
    !state.payload
  )
    state.nextCheck = 0;
  if (state.payload) {
    if (
      state.payload.current &&
      now - state.payload.current.observedAt > 12 * 3600_000
    )
      state.payload.current = null;
    if (
      state.payload.forecastObservedAt &&
      now - state.payload.forecastObservedAt > 12 * 3600_000
    ) {
      state.payload.forecast = [];
      state.payload.forecastObservedAt = null;
      state.payload.forecastFetchedAt = null;
    }
    if (
      state.payload.hourlyFetchedAt &&
      now - state.payload.hourlyFetchedAt > 12 * 3600_000
    ) {
      state.payload.hourly = [];
      state.payload.hourlyFetchedAt = null;
    }
    if (
      !state.payload.current &&
      !state.payload.forecast.length &&
      !state.payload.hourly?.length
    )
      state.payload = null;
  }
  if (now < state.nextCheck) {
    await save(state);
    return { state, snapshot: snapshot(state) };
  }
  let credentials: { keyId?: string; apiKey: string | null };
  try {
    credentials = await taskyService(env, "/api/homepage/weather-key", {
      userId,
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "homepage_weather_credentials_retry",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    state.error = "collection_failed";
    state.nextCheck = now + 60_000;
    await save(state);
    return { state, snapshot: snapshot(state) };
  }
  if (!credentials.apiKey) {
    state.payload = null;
    state.nextCheck = now + 30 * 60_000;
    state.error = undefined;
    state.disabled = true;
    await save(state);
    return { state, snapshot: missingModule(weatherModule, true) };
  }
  state.disabled = false;
  state.errors ??= {};
  let failed = false;
  for (const part of ["current", "forecast", "hourly"] as Part[]) {
    const nextField = {
      current: "nextCurrent",
      forecast: "nextForecast",
      hourly: "nextHourly",
    } as const;
    const field = nextField[part];
    if (now < (state[field] ?? 0)) continue;
    if (state.requestTimes.length >= config.dailyRequestBudget) {
      state.error = "rate_limited";
      state.errors[part] = state.error;
      state[field] = Math.min(...state.requestTimes) + 86400_000;
      failed = true;
      continue;
    }
    const interval =
      (part === "current"
        ? config.currentIntervalMinutes
        : part === "forecast"
          ? config.forecastIntervalMinutes
          : 360) * 60_000;
    // Reserve the call durably BEFORE fetch so restarts can't bypass the budget.
    state.requestTimes.push(now);
    state[field] = now + interval;
    await save(state);
    try {
      const path =
        part === "current"
          ? `currentconditions/v1/${config.locationKey}`
          : part === "forecast"
            ? `forecasts/v1/daily/5day/${config.locationKey}`
            : `forecasts/v1/hourly/12hour/${config.locationKey}`;
      const url = new URL(`https://dataservice.accuweather.com/${path}`);
      url.search = new URLSearchParams({
        language: config.language,
        details: String(part !== "current"),
        ...(part !== "current" ? { metric: String(config.units === "C") } : {}),
      }).toString();
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
          "Accept-Encoding": "gzip,deflate",
        },
        // Never forward provider credentials to a redirected host.
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        failed = true;
        state.failures++;
        state.error =
          response.status === 401 || response.status === 403
            ? "configuration"
            : response.status === 429
              ? "rate_limited"
              : "collection_failed";
        state.errors[part] = state.error;
        state[field] =
          now +
          (state.error === "configuration"
            ? 6 * 3600_000
            : state.error === "rate_limited"
              ? retryDelay(response, now)
              : Math.max(
                  interval,
                  Math.min(
                    12 * 3600_000,
                    3600_000 * 2 ** Math.min(state.failures, 4),
                  ),
                ));
        await response.body?.cancel();
        continue;
      }
      const raw = await response.json();
      const issuedHeader = Date.parse(
        response.headers.get("last-modified") ??
          response.headers.get("date") ??
          "",
      );
      const issued =
        Number.isFinite(issuedHeader) && issuedHeader <= now + 60_000
          ? issuedHeader
          : now;
      const patch =
        part === "current"
          ? normalizeCurrent(raw, config.units)
          : part === "forecast"
            ? normalizeForecast(raw, issued, now)
            : normalizeHourly(raw, now);
      state.payload = weatherPayloadSchema.parse({
        location: config.locationName,
        units: config.units,
        current: null,
        forecast: [],
        forecastObservedAt: null,
        ...state.payload,
        ...patch,
      });
      state.collectedAt = now;
      delete state.errors[part];
      state[field] = now + Math.max(interval, cacheDelay(response, now));
    } catch {
      failed = true;
      state.error = "collection_failed";
      state.errors[part] = state.error;
      state.failures++;
    }
  }
  state.error =
    state.errors.current ?? state.errors.forecast ?? state.errors.hourly;
  if (!failed && !state.error) state.failures = 0;
  state.nextCheck = Math.max(
    now + 60_000,
    Math.min(state.nextCurrent, state.nextForecast, state.nextHourly ?? 0),
  );
  await save(state);
  return { state, snapshot: snapshot(state) };
}
