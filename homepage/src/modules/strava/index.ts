import {
  getStravaActivityStats,
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
  const stats = getStravaActivityStats(activity);
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
        ${stats.map(([statLabel, value]) => `<div><dt>${e(statLabel)}</dt><dd>${e(value)}</dd></div>`).join("")}
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
