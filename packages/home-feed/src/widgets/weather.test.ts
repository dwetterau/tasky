import { describe, expect, it } from "vitest";
import {
  weatherForecastLocation,
  weatherPayloadSchema,
} from "./weather";

describe("weather widget", () => {
  it("preserves per-day locations and falls back to the current location", () => {
    const weather = weatherPayloadSchema.parse({
      location: "New York, NY",
      units: "F",
      current: null,
      forecast: [
        {
          date: "2026-10-15T07:00:00-04:00",
          high: 64,
          low: 49,
          description: "Cloudy",
        },
        {
          date: "2026-10-16T07:00:00-04:00",
          location: "Boston, MA",
          high: 60,
          low: 45,
          description: "Rain",
        },
      ],
      forecastObservedAt: Date.parse("2026-10-14T16:00:00Z"),
      attributionUrl: "https://www.accuweather.com/",
    });

    expect(weatherForecastLocation(weather.forecast[0], weather.location)).toBe(
      "New York, NY",
    );
    expect(weatherForecastLocation(weather.forecast[1], weather.location)).toBe(
      "Boston, MA",
    );
  });
});
