import { weatherPayloadSchema, type WeatherPayload } from "@tasky/home-feed";
import type { HomeModule } from "../contract";
import { escapeHtml as e, safeLink, sourceTime } from "../../rendering/html";

export const weatherModule: HomeModule<WeatherPayload> = {
  id: "weather",
  title: "Outside your window",
  placement: "supporting",
  schemaVersion: 1,
  freshForMs: 7 * 3600_000,
  maxAgeMs: 12 * 3600_000,
  parse: (value) => weatherPayloadSchema.parse(value),
  render(data, context) {
    const currentOld =
      data.current && context.now - data.current.observedAt > 3 * 3600_000;
    return /* HTML */ `<h2>Outside your window</h2>
      <p class="eyebrow weather-location">${e(data.location)}</p>
      ${data.current
        ? `<div class="temperature">${Math.round(data.current.temperature)}<span>°${e(data.units)}</span></div><p class="conditions">${e(data.current.description)}</p><p class="meta">${currentOld ? "Earlier observation · " : "Observed · "}${sourceTime(data.current.observedAt, context.timezone)}</p>`
        : '<p class="empty">Current conditions are unavailable.</p>'}
      <div class="forecast">
        ${data.forecast
          .map(
            (day) =>
              `<div class="forecast-day"><strong>${e(new Intl.DateTimeFormat("en-US", { timeZone: context.timezone, weekday: "short" }).format(new Date(day.date)))}</strong><span>${e(day.description)}</span><b>${Math.round(day.high)}° <span class="muted">${Math.round(day.low)}°</span></b></div>`,
          )
          .join("")}
      </div>
      <p class="meta">
        Forecast checked ·
        ${sourceTime(data.forecastObservedAt, context.timezone)}
      </p>
      <a
        class="attribution"
        href="${safeLink(data.attributionUrl)}"
        rel="noreferrer"
        >Weather by AccuWeather</a
      >`;
  },
};
