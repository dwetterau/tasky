import { weatherPayloadSchema, type WeatherPayload } from "@tasky/home-feed";
import type { HomeModule } from "../contract";
import { escapeHtml as e, safeLink, sourceTime } from "../../rendering/html";

export function weatherEmoji(description: string, isDay = true) {
  const text = description.toLowerCase();
  if (/thunder|storm/.test(text)) return "⛈️";
  if (/snow|flurr|blizzard/.test(text)) return "🌨️";
  if (/ice|sleet|freez/.test(text)) return "🌧️";
  if (/rain|shower|drizzle/.test(text)) return "🌧️";
  if (/fog|haze|mist/.test(text)) return "🌫️";
  if (/partly|mostly sunny|intermittent/.test(text)) return isDay ? "⛅" : "☁️";
  if (/cloud|overcast/.test(text)) return "☁️";
  if (/sun|clear/.test(text)) return isDay ? "☀️" : "🌙";
  return "🌡️";
}
export const weatherModule: HomeModule<WeatherPayload> = {
  id: "weather",
  title: "Weather",
  placement: "supporting",
  schemaVersion: 1,
  freshForMs: 7 * 3600_000,
  maxAgeMs: 12 * 3600_000,
  parse: (value) => weatherPayloadSchema.parse(value),
  render(data, context) {
    return /* HTML */ `<p class="weather-location">${e(data.location)}</p>
      ${data.current
        ? `<div class="current-weather"><span class="weather-emoji" aria-hidden="true">${weatherEmoji(data.current.description, data.current.isDay)}</span><div><div class="temperature">${Math.round(data.current.temperature)}<span>°${e(data.units)}</span></div><p class="conditions">${e(data.current.description)}</p></div></div>`
        : '<p class="empty">Current conditions are unavailable.</p>'}
      <div class="forecast">
        ${data.forecast
          .map(
            (day) => `
        <div class="forecast-day"><strong>${e(new Intl.DateTimeFormat("en-US", { timeZone: context.timezone, weekday: "short" }).format(new Date(day.date)))}</strong><span class="forecast-description"><span aria-hidden="true">${weatherEmoji(day.description)}</span> ${e(day.description)}</span><b>${Math.round(day.high)}° <span class="muted">${Math.round(day.low)}°</span></b></div>`,
          )
          .join("")}
      </div>
      <details class="source-details">
        <summary>Observation times</summary>
        ${data.current
          ? `<p>Current conditions observed ${sourceTime(data.current.observedAt, context.timezone)}.</p>`
          : ""}
        <p>
          Forecast retrieved
          ${sourceTime(data.forecastObservedAt, context.timezone)}.
        </p>
      </details>
      <a
        class="attribution"
        href="${safeLink(data.attributionUrl)}"
        rel="noreferrer"
        >Weather by AccuWeather</a
      >`;
  },
};
