import {
  calendar,
  weatherPayloadSchema,
  type WeatherPayload,
} from "@tasky/home-feed";
import type { HomeModule, RenderContext } from "../contract";
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

export function renderHourlyRain(data: WeatherPayload, context: RenderContext) {
  const { day } = calendar(context.now, context.timezone);
  const hours = (data.hourly ?? []).filter(
    (hour) =>
      hour.at >= day.startAt &&
      hour.at < day.endAt &&
      hour.at + 3600_000 > context.now,
  );
  if (!hours.length)
    return '<p class="rain-empty meta">Hourly rain outlook unavailable.</p>';
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: context.timezone,
    hour: "numeric",
  });
  const ticks = [
    ...new Set([0, Math.floor((hours.length - 1) / 2), hours.length - 1]),
  ];
  return /* HTML */ `<figure
    class="rain-chart"
    aria-label="Hourly rain chance for the rest of today"
  >
    <figcaption>Rain today <span>hourly</span></figcaption>
    <div class="rain-plot">
      <div class="rain-scale" aria-hidden="true">
        <span>100%</span><span>0%</span>
      </div>
      <ol class="rain-bars">
        ${hours
          .map((hour) => {
            const probability = hour.rainProbability;
            const label = `${time.format(hour.at)}: ${probability === null ? "rain chance unavailable" : `${Math.round(probability)}% chance of rain`}`;
            return `<li class="rain-hour${probability === null ? " unknown" : ""}" title="${e(label)}" aria-label="${e(label)}"><span class="rain-bar" style="height:${probability ?? 0}%" aria-hidden="true"></span></li>`;
          })
          .join("")}
      </ol>
    </div>
    <div class="rain-times" aria-hidden="true">
      ${ticks
        .map(
          (index) =>
            `<span>${e(time.format(hours[index].at).replace(" AM", "a").replace(" PM", "p"))}</span>`,
        )
        .join("")}
    </div>
  </figure>`;
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
                ><strong>Forecast fetched</strong> ${data?.forecastFetchedAt ==
                null
                  ? "Awaiting the next forecast refresh"
                  : sourceTime(data.forecastFetchedAt, context.timezone)}<br />
                When the homepage downloaded this forecast from
                AccuWeather.</span
              >
              <span
                >Rain percentages are the chance of rain during the daytime in
                the daily list, and during each hour in the chart.</span
              >
              ${data?.hourlyFetchedAt
                ? `<span><strong>Hourly forecast fetched</strong> ${sourceTime(data.hourlyFetchedAt, context.timezone)}<br />When the homepage downloaded the hourly rain outlook.</span>`
                : ""}
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
        ? `<div class="current-weather"><span class="weather-emoji" aria-hidden="true">${weatherEmoji(data.current.description, data.current.isDay)}</span><div><div class="temperature">${Math.round(data.current.temperature)}<span>°${e(data.units)}</span></div><p class="conditions">${e(data.current.description)}</p></div>${renderHourlyRain(data, context)}</div>`
        : `<div class="current-weather-missing"><p class="empty">Current conditions are unavailable.</p>${renderHourlyRain(data, context)}</div>`}
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
