import { env as bindings } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import {
  collectWeather,
  normalizeForecast,
  normalizeHourly,
  weatherConfigSchema,
  type WeatherState,
} from "../src/modules/weather/collector";
import { renderEdition, freshnessBanner } from "../src/rendering/page";
import { weatherPayloadSchema } from "@tasky/home-feed";
import { renderHourlyRain } from "../src/modules/weather";
import { fixtureEdition } from "./fixtures";
import type { Env } from "../src/env";
const env = bindings as unknown as Env;
afterEach(() => vi.restoreAllMocks());
const config = weatherConfigSchema.parse({
  locationKey: "349727",
  locationName: "New York, NY",
});
const current = () => [
  {
    EpochTime: Math.floor(Date.now() / 1000),
    WeatherText: "Sunny",
    Temperature: { Imperial: { Value: 75 }, Metric: { Value: 24 } },
    RealFeelTemperature: {
      Imperial: { Value: 78 },
      Metric: { Value: 26 },
    },
    RelativeHumidity: 61,
    Link: "http://www.accuweather.com/",
  },
];
const forecast = {
  Headline: { Link: "http://www.accuweather.com/" },
  DailyForecasts: [
    {
      Date: "2026-09-15T07:00:00-04:00",
      Temperature: { Minimum: { Value: 61 }, Maximum: { Value: 76 } },
      Day: { IconPhrase: "Sunny", RainProbability: 0 },
    },
  ],
};

const hourly = () =>
  Array.from({ length: 12 }, (_, index) => ({
    DateTime: new Date(Date.now() + index * 3600_000).toISOString(),
    PrecipitationProbability: index * 4,
  }));
function weatherResponse(input: unknown) {
  const url = String(input);
  return url.includes("currentconditions")
    ? current()
    : url.includes("/hourly/")
      ? hourly()
      : forecast;
}

it("works without a weather key, and never writes credentials to snapshots or durable state", async () => {
  const save = vi.fn(async (_state: WeatherState) => {});
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ apiKey: null }));
  const none = await collectWeather(env, "user-a", config, undefined, save);
  expect(none.snapshot?.status).toBe("disabled");
  expect(network).toHaveBeenCalledTimes(1);
  expect(
    (await collectWeather(env, "user-a", config, none.state, save)).snapshot
      ?.status,
  ).toBe("disabled");
  network.mockImplementation(async (input, init) => {
    if (String(input).includes("weather-key"))
      return Response.json({ keyId: "key-a", apiKey: "secret-not-for-feed" });
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer secret-not-for-feed",
    );
    expect(String(input)).not.toContain("secret-not-for-feed");
    if (String(input).includes("/daily/")) {
      expect(new URL(String(input)).searchParams.get("details")).toBe("true");
    }
    if (String(input).includes("currentconditions")) {
      expect(new URL(String(input)).searchParams.get("details")).toBe("true");
    }
    if (String(input).includes("/hourly/")) {
      expect(String(input)).toContain("/hourly/12hour/");
      expect(new URL(String(input)).searchParams.get("details")).toBe("false");
    }
    return Response.json(weatherResponse(input));
  });
  const result = await collectWeather(env, "user-a", config, undefined, save);
  expect(result.snapshot?.status).toBe("available");
  expect(result.state?.payload?.current?.realFeelTemperature).toBe(78);
  expect(result.state?.payload?.current?.relativeHumidity).toBe(61);
  expect(result.state?.payload?.forecast[0].rainProbability).toBe(0);
  expect(result.state?.payload?.hourly).toHaveLength(12);
  expect(result.state?.nextHourly).toBeGreaterThanOrEqual(
    result.state!.payload!.hourlyFetchedAt! + 6 * 3600_000,
  );
  expect(result.state?.payload?.attributionUrl).toBe(
    "https://www.accuweather.com/",
  );
  expect(JSON.stringify(result)).not.toContain("secret-not-for-feed");
  expect(JSON.stringify(save.mock.calls)).not.toContain("secret-not-for-feed");
  const calls = network.mock.calls.length;
  await collectWeather(env, "user-a", config, result.state, save);
  expect(network).toHaveBeenCalledTimes(calls);
});
it("upgrades only the forecast without clearing current conditions or the request budget", async () => {
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input) => {
      if (String(input).includes("weather-key"))
        return Response.json({ apiKey: "secret" });
      return Response.json(weatherResponse(input));
    });
  const save = vi.fn(async (_state: WeatherState) => {});
  const first = await collectWeather(env, "user-a", config, undefined, save);
  const previous = structuredClone(first.state!);
  delete previous.forecastVersion;
  network.mockClear();
  const next = await collectWeather(env, "user-a", config, previous, save);
  expect(network).toHaveBeenCalledTimes(2); // credential + forecast only
  expect(next.state!.requestTimes).toHaveLength(4);
  expect(next.state!.payload!.current).toEqual(first.state!.payload!.current);
  const missing = structuredClone(forecast);
  delete (missing.DailyForecasts[0].Day as { RainProbability?: number })
    .RainProbability;
  expect(
    normalizeForecast(missing, Date.now(), Date.now()).forecast[0]
      .rainProbability,
  ).toBeNull();
});
it("backs off on rate limits, enforces a persisted budget, and keeps original last-good times", async () => {
  let stored: WeatherState | undefined;
  const save = async (state: WeatherState) => {
    stored = structuredClone(state);
  };
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input) => {
      if (String(input).includes("weather-key"))
        return Response.json({ apiKey: "secret" });
      return Response.json(weatherResponse(input));
    });
  const first = await collectWeather(env, "user-a", config, undefined, save);
  const observed = first.snapshot!.sourceDataAt;
  stored!.nextCheck = 0;
  stored!.nextCurrent = 0;
  stored!.nextForecast = 0;
  network.mockImplementation(async (input) =>
    String(input).includes("weather-key")
      ? Response.json({ apiKey: "secret" })
      : new Response(null, {
          status: 429,
          headers: { "retry-after": "14400" },
        }),
  );
  const failed = await collectWeather(env, "user-a", config, stored, save);
  expect(failed.snapshot!.sourceDataAt).toBeGreaterThanOrEqual(observed!);
  expect(failed.state!.payload?.current?.observedAt).toBe(
    first.state!.payload!.current!.observedAt,
  );
  expect(failed.snapshot!.error).toBeUndefined();
  expect(failed.state!.error).toBe("rate_limited");
  expect(failed.state!.payload?.current).toEqual(
    first.state!.payload!.current,
  );
  expect(stored!.nextCurrent).toBeGreaterThan(Date.now() + 3 * 3600_000);
  stored!.nextCheck = 0;
  stored!.nextCurrent = 0;
  stored!.nextForecast = 0;
  stored!.requestTimes = Array(config.dailyRequestBudget).fill(Date.now());
  const count = network.mock.calls.length;
  await collectWeather(env, "user-a", config, stored, save);
  expect(network.mock.calls.length - count).toBe(1); // credential check only; no weather calls
  const forced = network.mock.calls.length;
  await collectWeather(env, "user-a", config, stored, save, Date.now(), true);
  expect(
    network.mock.calls
      .slice(forced)
      .filter((call) => !String(call[0]).includes("weather-key")),
  ).toHaveLength(3);
});
it("does not treat a morning forecast issue time or hourly miss as the whole module going stale", async () => {
  const save = vi.fn(async (_state: WeatherState) => {});
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
    String(input).includes("weather-key")
      ? Response.json({ apiKey: "secret" })
      : Response.json(weatherResponse(input)),
  );
  const first = await collectWeather(env, "user-a", config, undefined, save);
  const morning = Date.now() - 10 * 3600_000;
  const stored = structuredClone(first.state!);
  stored.payload!.forecastObservedAt = morning;
  stored.payload!.hourlyFetchedAt = morning;
  stored.errors = { hourly: "configuration" };
  stored.error = "configuration";
  stored.nextCheck = Date.now() + 60_000;
  const next = await collectWeather(env, "user-a", config, stored, save);
  expect(next.snapshot!.sourceDataAt).toBeGreaterThan(morning);
  expect(next.snapshot!.error).toBeUndefined();
  expect(next.snapshot!.status).toBe("available");
});
it("does not treat a last-good snapshot as a page error", () => {
  const edition = fixtureEdition();
  const weather = edition.feed.modules.find((module) => module.id === "weather")!;
  weather.status = "stale";
  weather.error = "collection_failed";
  weather.sourceDataAt = Date.now() - 8 * 3600_000;
  const html = `${freshnessBanner(edition.feed, Date.now())}${renderEdition(edition.feed, env.TASKY_ORIGIN)}`;
  expect(html).not.toContain("earlier snapshot");
  expect(html).not.toContain('class="notice"');
  expect(html).not.toContain("latest update failed");
  expect(html).not.toContain("Earlier weather snapshot");
  expect(html).not.toContain("Updates will appear when the source recovers");
  expect(html).toContain('action="/api/refresh"');
});
it("shows real feel and humidity in one compact line when available", () => {
  const edition = fixtureEdition();
  const weather = edition.feed.modules.find((module) => module.id === "weather")!;
  const data = weatherPayloadSchema.parse(weather.payload);
  data.current = {
    ...data.current!,
    realFeelTemperature: 74.6,
    relativeHumidity: 61,
  };
  weather.payload = data;

  const html = renderEdition(edition.feed, env.TASKY_ORIGIN);
  expect(html).toContain(
    '<p class="current-details">Feels 75°F · Humidity 61%</p>',
  );
});
it("counts attempts in a rolling 24-hour window across restarts and location changes", async () => {
  const now = Date.now();
  const smallBudget = { ...config, dailyRequestBudget: 2 };
  const save = vi.fn(async (_state: WeatherState) => {});
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input) =>
      String(input).includes("weather-key")
        ? Response.json({ apiKey: "secret" })
        : new Response(null, { status: 503 }),
    );
  const first = await collectWeather(
    env,
    "user-a",
    smallBudget,
    undefined,
    save,
    now,
  );
  expect(first.state!.requestTimes).toEqual([now, now]);
  // Reload durable state just before the first attempts age out. Configuration
  // changes cannot reset this budget, and failed calls still count.
  const restored = structuredClone(first.state!);
  const changed = { ...smallBudget, locationKey: "123" };
  network.mockClear();
  const blocked = await collectWeather(
    env,
    "user-a",
    changed,
    restored,
    save,
    now + 86400_000 - 1,
  );
  expect(network).toHaveBeenCalledTimes(1); // key retrieval only
  expect(blocked.state!.requestTimes).toHaveLength(2);
  network.mockClear();
  const next = await collectWeather(
    env,
    "user-a",
    changed,
    blocked.state,
    save,
    now + 86400_000 + 60_000,
  );
  expect(network).toHaveBeenCalledTimes(3);
  expect(next.state!.requestTimes).toEqual([
    now + 86400_000 + 60_000,
    now + 86400_000 + 60_000,
  ]);
});
it("graphs upcoming hours across midnight and distinguishes fetch time", () => {
  const now = Date.parse("2026-09-16T02:30:00Z"); // 10:30 PM in New York
  const sourceAt = now - 3600_000;
  const daily = normalizeForecast(forecast, sourceAt, now);
  expect(daily.forecastObservedAt).toBe(sourceAt);
  expect(daily.forecastFetchedAt).toBe(now);
  expect(
    normalizeHourly(
      [
        {
          DateTime: "2026-09-16T12:00:00-04:00",
          RainProbability: 11,
          PrecipitationProbability: 90,
        },
      ],
      now,
    ).hourly[0].rainProbability,
  ).toBe(11);
  const hours = normalizeHourly(
    [
      { DateTime: "2026-09-15T21:00:00-04:00", PrecipitationProbability: 80 },
      { DateTime: "2026-09-15T22:00:00-04:00", PrecipitationProbability: 0 },
      { DateTime: "2026-09-15T23:00:00-04:00", PrecipitationProbability: 25 },
      { DateTime: "2026-09-16T00:00:00-04:00", PrecipitationProbability: 90 },
    ],
    now,
  );
  const data = weatherPayloadSchema.parse({
    location: "New York",
    units: "F",
    current: null,
    ...daily,
    ...hours,
  });
  const html = renderHourlyRain(data, {
    now,
    timezone: "America/New_York",
    taskyOrigin: env.TASKY_ORIGIN,
  });
  expect(html).toContain("10 PM: 0% chance of rain");
  expect(html).toContain("11 PM: 25% chance of rain");
  expect(html).toContain("12 AM: 90% chance of rain");
  expect(html).toContain('class="rain-tip"');
  expect(html).toContain("10p 0%");
  expect(html).toContain("11p 25%");
  expect(html).toContain("12a 90%");
  expect(html).toContain("Rain next 3h");
  expect(html).not.toContain("9 PM:");
  expect(html).toContain("height:25%");
});
it("escapes source text and rejects unsafe links", () => {
  const edition = fixtureEdition();
  const tasky = edition.feed.modules[0].payload as {
    signals: { name: string }[];
  };
  tasky.signals[0].name =
    '<script>alert(1)</script><img src=x onerror="evil()">';
  const html = renderEdition(edition.feed, "https://tasky.example.test");
  expect(html).not.toContain("<script>alert");
  expect(html).toContain("&lt;script&gt;");
});
