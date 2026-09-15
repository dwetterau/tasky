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
  renderHeader(snapshot, context) {
    const data =
      snapshot.payload === null
        ? null
        : weatherPayloadSchema.parse(snapshot.payload);
    return /* HTML */ `<div class="module-title">
        <h2>Weather</h2>
        <div class="module-actions">
          <span class="module-info">
            <button
              class="info-trigger"
              type="button"
              aria-label="Weather timing information"
              aria-describedby="weather-info"
            >
              ⓘ
            </button>
            <span class="info-tooltip" id="weather-info" role="tooltip">
              <span
                ><strong>Updated</strong> ${sourceTime(
                  snapshot.collectedAt,
                  context.timezone,
                )}<br />
                The homepage's last successful weather fetch.</span
              >
              ${data?.current
                ? `<span><strong>Current conditions observed</strong> ${sourceTime(data.current.observedAt, context.timezone)}<br />When AccuWeather recorded the conditions.</span>`
                : ""}
              <span
                ><strong>Forecast timestamp</strong> ${sourceTime(
                  data?.forecastObservedAt ?? null,
                  context.timezone,
                )}<br />
                The provider's timestamp for the forecast response.</span
              >
              <span
                >Rain percentages are the chance of rain during the
                daytime.</span
              >
            </span>
          </span>
          ${data
            ? `<a class="module-open" href="${safeLink(data.attributionUrl)}" aria-label="Open weather on AccuWeather" rel="noreferrer">Open ↗</a>`
            : ""}
        </div>
      </div>
      ${snapshot.status !== "available"
        ? `<p class="meta stale">${snapshot.payload ? "Earlier weather snapshot" : "Awaiting weather"}</p>`
        : ""}`;
  },
  render(data, context) {
    return /* HTML */ `<p class="weather-location">${e(data.location)}</p>
      ${data.current
        ? `<div class="current-weather"><span class="weather-emoji" aria-hidden="true">${weatherEmoji(data.current.description, data.current.isDay)}</span><div><div class="temperature">${Math.round(data.current.temperature)}<span>°${e(data.units)}</span></div><p class="conditions">${e(data.current.description)}</p></div></div>`
        : '<p class="empty">Current conditions are unavailable.</p>'}
      <div class="forecast">
        ${data.forecast
          .map(
            (day) => `
        <div class="forecast-day"><strong>${e(new Intl.DateTimeFormat("en-US", { timeZone: context.timezone, weekday: "short" }).format(new Date(day.date)))}</strong><span class="forecast-description"><span aria-hidden="true">${weatherEmoji(day.description)}</span> ${e(day.description)}</span><span class="forecast-values"><b>${Math.round(day.high)}° <span class="muted">${Math.round(day.low)}°</span></b><span class="rain-chance" title="Daytime rain chance" aria-label="Daytime rain chance: ${day.rainProbability == null ? "unavailable" : `${Math.round(day.rainProbability)} percent`}"><span aria-hidden="true">💧</span> ${day.rainProbability == null ? "—" : `${Math.round(day.rainProbability)}%`}</span></span></div>`,
          )
          .join("")}
      </div> `;
  },
};
