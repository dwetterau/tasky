import {
  formatStravaDistance,
  formatStravaDuration,
  formatStravaPace,
  stravaPayloadSchema,
  widgetDefinitions,
  type StravaActivity,
  type StravaPayload,
} from "@tasky/home-feed/widgets";
import type { HomeModule, RenderContext } from "../contract";
import { escapeHtml as e, safeLink } from "../../rendering/html";

function activityDate(activity: StravaActivity, context: RenderContext) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: context.timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(activity.startedAt));
}

function renderActivity(
  activity: StravaActivity,
  context: RenderContext,
): string {
  const label = activity.sport === "run" ? "Latest run" : "Latest ride";
  const paceLabel = activity.sport === "run" ? "Avg pace" : "Avg speed";
  const power =
    activity.averagePowerWatts === undefined
      ? "—"
      : `${Math.round(activity.averagePowerWatts)} W`;
  const heartRate =
    activity.averageHeartRateBpm === undefined
      ? "—"
      : `${Math.round(activity.averageHeartRateBpm)} bpm`;
  const activityLink = safeLink(
    activity.activityUrl,
    "https://www.strava.com",
  );
  return /* HTML */ `<article class="strava-activity">
    <div class="strava-activity-body">
      <div class="strava-heading">
        <div>
          <h3>${label}</h3>
          <time datetime="${e(activity.startedAt)}">${e(activityDate(activity, context))}</time>
        </div>
        <a href="${activityLink}" target="_blank" rel="noreferrer">View on Strava ↗</a>
      </div>
      <dl class="strava-stats">
        <div><dt>Distance</dt><dd>${e(formatStravaDistance(activity.distanceMeters))}</dd></div>
        <div><dt>Moving time</dt><dd>${e(formatStravaDuration(activity.movingTimeSeconds))}</dd></div>
        <div><dt>Avg power</dt><dd>${e(power)}</dd></div>
        <div><dt>${paceLabel}</dt><dd>${e(formatStravaPace(activity))}</dd></div>
        <div><dt>Avg heart rate</dt><dd>${e(heartRate)}</dd></div>
      </dl>
    </div>
  </article>`;
}

export const stravaModule: HomeModule<StravaPayload> = {
  id: "strava",
  title: "Strava",
  placement: "supporting",
  schemaVersion: 1,
  freshForMs: widgetDefinitions.strava.freshForMs,
  maxAgeMs: widgetDefinitions.strava.maxAgeMs,
  parse: (value) => stravaPayloadSchema.parse(value),
  render(data, context) {
    return `<div class="strava-activities">${renderActivity(data.latestRun, context)}${renderActivity(data.latestRide, context)}</div>`;
  },
};
