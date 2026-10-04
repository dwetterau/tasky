import {
  formatReleaseDate,
  getUpcomingReleases,
  localDateAt,
  releasesPayloadSchema,
  widgetDefinitions,
  type ReleasesPayload,
} from "@tasky/home-feed/widgets";
import type { HomeModule } from "../contract";
import { escapeHtml as e } from "../../rendering/html";

export const releasesModule: HomeModule<ReleasesPayload> = {
  id: "releases",
  title: "Upcoming releases",
  placement: "supporting",
  schemaVersion: 1,
  freshForMs: widgetDefinitions.releases.freshForMs,
  maxAgeMs: widgetDefinitions.releases.maxAgeMs,
  parse: (value) => releasesPayloadSchema.parse(value),
  render(data, context) {
    const today = localDateAt(context.now, context.timezone);
    const releases = getUpcomingReleases(data, today);
    if (releases.length === 0) {
      return '<p class="empty">No dated releases ahead.</p>';
    }
    return `<ul class="release-list">${releases
      .map(
        (release) => `<li>
          <span class="release-kind">${release.kind === "tv" ? "TV" : "Film"}</span>
          <span class="release-title"><strong>${e(release.title)}</strong>${release.detail ? `<span>${e(release.detail)}</span>` : ""}</span>
          <time datetime="${e(release.releaseDate)}">${e(formatReleaseDate(release.releaseDate, today))}</time>
        </li>`,
      )
      .join("")}</ul>`;
  },
};
