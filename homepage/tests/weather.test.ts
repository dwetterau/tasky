import { env as bindings } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import { collectWeather, weatherConfigSchema, type WeatherState } from "../src/modules/weather/collector";
import { renderEdition } from "../src/rendering/page";
import { fixtureEdition } from "./fixtures";
import type { Env } from "../src/env";
const env = bindings as unknown as Env;
afterEach(() => vi.restoreAllMocks());
const config = weatherConfigSchema.parse({ locationKey: "349727", locationName: "New York, NY" });
const current = () => [{ EpochTime: Math.floor(Date.now() / 1000), WeatherText: "Sunny", Temperature: { Imperial: { Value: 75 }, Metric: { Value: 24 } }, Link: "https://www.accuweather.com/" }];
const forecast = { Headline: { Link: "https://www.accuweather.com/" }, DailyForecasts: [{ Date: "2026-09-15T07:00:00-04:00", Temperature: { Minimum: { Value: 61 }, Maximum: { Value: 76 } }, Day: { IconPhrase: "Sunny" } }] };

it("works without a weather key, and never writes credentials to snapshots or durable state", async () => {
  const save = vi.fn(async (_state: WeatherState) => {});
  const network = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ apiKey: null }));
  const none = await collectWeather(env, "user-a", config, undefined, save);
  expect(none.snapshot?.status).toBe("disabled"); expect(network).toHaveBeenCalledTimes(1);
  expect((await collectWeather(env, "user-a", config, none.state, save)).snapshot?.status).toBe("disabled");
  network.mockImplementation(async (input, init) => {
    if (String(input).includes("weather-key")) return Response.json({ keyId: "key-a", apiKey: "secret-not-for-feed" });
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret-not-for-feed");
    expect(String(input)).not.toContain("secret-not-for-feed");
    return Response.json(String(input).includes("currentconditions") ? current() : forecast);
  });
  const result = await collectWeather(env, "user-a", config, undefined, save);
  expect(result.snapshot?.status).toBe("available");
  expect(JSON.stringify(result)).not.toContain("secret-not-for-feed");
  expect(JSON.stringify(save.mock.calls)).not.toContain("secret-not-for-feed");
  const calls = network.mock.calls.length;
  await collectWeather(env, "user-a", config, result.state, save);
  expect(network).toHaveBeenCalledTimes(calls);
});
it("backs off on rate limits, enforces a persisted budget, and keeps original last-good times", async () => {
  let stored: WeatherState | undefined;
  const save = async (state: WeatherState) => { stored = structuredClone(state); };
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
    if (String(input).includes("weather-key")) return Response.json({ apiKey: "secret" });
    return Response.json(String(input).includes("currentconditions") ? current() : forecast);
  });
  const first = await collectWeather(env, "user-a", config, undefined, save);
  const observed = first.snapshot!.sourceDataAt;
  stored!.nextCheck = 0; stored!.nextCurrent = 0; stored!.nextForecast = 0;
  network.mockImplementation(async input => String(input).includes("weather-key") ? Response.json({ apiKey: "secret" }) : new Response(null, { status: 429, headers: { "retry-after": "14400" } }));
  const failed = await collectWeather(env, "user-a", config, stored, save);
  expect(failed.snapshot!.sourceDataAt).toBe(observed);
  expect(failed.snapshot!.error).toBe("rate_limited");
  expect(stored!.nextCurrent).toBeGreaterThan(Date.now() + 3 * 3600_000);
  stored!.nextCheck = 0; stored!.nextCurrent = 0; stored!.nextForecast = 0; stored!.requestTimes = Array(config.dailyRequestBudget).fill(Date.now());
  const count = network.mock.calls.length;
  await collectWeather(env, "user-a", config, stored, save);
  expect(network.mock.calls.length - count).toBe(1); // credential check only; no weather calls
});
it("counts attempts in a rolling 24-hour window across restarts and location changes", async () => {
  const now = Date.now();
  const smallBudget = { ...config, dailyRequestBudget: 2 };
  const save = vi.fn(async (_state: WeatherState) => {});
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(async input => String(input).includes("weather-key") ? Response.json({ apiKey: "secret" }) : new Response(null, { status: 503 }));
  const first = await collectWeather(env, "user-a", smallBudget, undefined, save, now);
  expect(first.state!.requestTimes).toEqual([now, now]);
  // Reload durable state just before the first attempts age out. Configuration
  // changes cannot reset this budget, and failed calls still count.
  const restored = structuredClone(first.state!);
  const changed = { ...smallBudget, locationKey: "123" };
  network.mockClear();
  const blocked = await collectWeather(env, "user-a", changed, restored, save, now + 86400_000 - 1);
  expect(network).toHaveBeenCalledTimes(1); // key retrieval only
  expect(blocked.state!.requestTimes).toHaveLength(2);
  network.mockClear();
  const next = await collectWeather(env, "user-a", changed, blocked.state, save, now + 86400_000 + 60_000);
  expect(network).toHaveBeenCalledTimes(3);
  expect(next.state!.requestTimes).toEqual([now + 86400_000 + 60_000, now + 86400_000 + 60_000]);
});
it("escapes source text and rejects unsafe links", () => {
  const edition = fixtureEdition();
  const tasky = edition.feed.modules[0].payload as { tasks: { title: string }[] };
  tasky.tasks[0].title = '<script>alert(1)</script><img src=x onerror="evil()">';
  const html = renderEdition(edition.feed, "https://tasky.example.test");
  expect(html).not.toContain('<script>alert');
  expect(html).toContain("&lt;script&gt;");
});
