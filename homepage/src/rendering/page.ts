import { calendar, withFreshness, type Feed } from "@tasky/home-feed";
import { moduleFor, renderModule } from "../modules/registry";
import { escapeHtml as e, safeLink, sourceTime } from "./html";

export const styles = `
:root {
  color-scheme: light;
  --paper: #f8f6ef;
  --ink: #242820;
  --muted: #656b60;
  --rule: #c8ccbe;
  --accent: #315b43;
  --warn: #a24730;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font:
    16px/1.5 Georgia,
    "Times New Roman",
    serif;
}
a {
  color: inherit;
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}
a:focus-visible,
button:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 4px;
}
.paper {
  max-width: 1280px;
  margin: auto;
  padding: 28px 36px;
}
.masthead {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  padding-bottom: 22px;
  border-bottom: 4px double var(--ink);
}
.masthead h1 {
  font-size: clamp(36px, 5vw, 60px);
  letter-spacing: -0.045em;
  line-height: 1.1;
  margin: 0;
}
.masthead nav {
  display: flex;
  align-items: center;
  gap: 20px;
}
.masthead nav,
button,
.meta,
.section-label,
.dateline,
.section-heading a,
details,
.attribution,
.logged-signals,
.statline span {
  font-family: system-ui, sans-serif;
}
.masthead nav {
  font-size: 12px;
  white-space: nowrap;
}
form {
  margin: 0;
}
button {
  border: 0;
  background: none;
  padding: 0;
  color: inherit;
  cursor: pointer;
  font-size: inherit;
}
.dateline {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 18px;
  padding: 10px 0;
  border-bottom: 1px solid var(--ink);
  font-size: 11px;
  color: var(--muted);
}
.edition-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 28px;
  margin-top: 24px;
}
.module {
  min-width: 0;
}
.module-header {
  border-bottom: 1px solid var(--rule);
  padding-bottom: 10px;
  margin-bottom: 16px;
}
.module-header h2 {
  font-size: 25px;
  margin: 0 0 3px;
  line-height: 1.2;
}
h3,
h4,
p {
  margin: 0;
}
.meta {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.6;
}
.section-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.tasky-section {
  margin-bottom: 20px;
}
.scorecards,
.signal-list,
.logged-signals,
.holdings {
  list-style: none;
  margin: 0;
  padding: 0;
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}
.scorecard {
  margin-top: 12px;
}
.scorecard h3 {
  font-size: 16px;
  font-weight: 400;
  overflow-wrap: anywhere;
}
.score {
  font:
    13px system-ui,
    sans-serif;
  color: var(--accent);
  white-space: nowrap;
}
progress {
  appearance: none;
  width: 100%;
  height: 4px;
  border: 0;
  display: block;
  margin-top: 6px;
  background: #e3e6dc;
  color: var(--accent);
}
progress::-webkit-progress-bar {
  background: #e3e6dc;
}
progress::-webkit-progress-value {
  background: var(--accent);
}
progress::-moz-progress-bar {
  background: var(--accent);
}
.signal-list li {
  display: flex;
  gap: 9px;
  margin-top: 12px;
}
.signal-list strong {
  font-size: 15px;
  overflow-wrap: anywhere;
}
.signal-list p {
  font:
    11px/1.5 system-ui,
    sans-serif;
  color: var(--muted);
  margin-top: 2px;
}
.signal-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #7e8875;
  flex-shrink: 0;
  margin-top: 8px;
}
.signal-dot.due {
  background: var(--warn);
}
.signal-dot.soon {
  background: #a88138;
}
.logged-label {
  margin: 16px 0 8px;
}
.logged-signals {
  display: flex;
  gap: 5px 12px;
  flex-wrap: wrap;
  font-size: 11px;
}
.logged-signals li > span:first-child {
  color: var(--accent);
}
.section-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  border-top: 1px solid var(--rule);
  padding: 14px 0 10px;
}
.section-heading a {
  font-size: 11px;
  color: var(--accent);
}
.statline {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.statline strong {
  display: block;
  font-size: 29px;
  line-height: 1.2;
}
.statline span {
  font-size: 10px;
  color: var(--muted);
}
.weather-location {
  font-size: 14px;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.current-weather {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 16px 0;
}
.weather-emoji {
  font-size: 42px;
  line-height: 1;
}
.temperature {
  font-size: 56px;
  letter-spacing: -0.05em;
  line-height: 1;
}
.temperature > span {
  font-size: 24px;
  vertical-align: top;
  letter-spacing: 0;
}
.conditions {
  font-size: 15px;
  margin-top: 6px;
  overflow-wrap: anywhere;
}
.forecast {
  border-top: 1px solid var(--rule);
}
.forecast-day {
  display: grid;
  grid-template-columns: 30px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 10px 0;
  border-bottom: 1px solid var(--rule);
  font-size: 12px;
}
.forecast-description {
  font:
    11px/1.4 system-ui,
    sans-serif;
  overflow-wrap: anywhere;
}
.forecast-day b {
  white-space: nowrap;
}
.muted {
  color: var(--muted);
  font-weight: 400;
}
.warning,
.stale {
  color: var(--warn);
}
.positive {
  color: var(--accent);
}
details {
  font-size: 11px;
  color: var(--muted);
  margin-top: 14px;
}
summary {
  cursor: pointer;
}
.source-details p {
  margin-top: 6px;
}
.attribution {
  display: inline-block;
  font-size: 10px;
  margin-top: 12px;
  color: var(--muted);
}
.portfolio-value {
  font-size: clamp(32px, 3.5vw, 44px);
  letter-spacing: -0.045em;
  line-height: 1.2;
  margin: 12px 0 4px;
  overflow-wrap: anywhere;
}
.portfolio-return {
  font-size: 17px;
  margin-bottom: 4px;
}
.portfolio-return span {
  font-size: 14px;
}
.holdings-label {
  margin-top: 24px;
}
.holdings {
  margin-bottom: 16px;
}
.holdings li {
  padding: 12px 0;
  border-bottom: 1px solid var(--rule);
}
.holdings .row {
  font-size: 12px;
}
.empty {
  color: var(--muted);
  font-size: 13px;
  padding: 12px 0;
}
.notice {
  font:
    12px/1.6 system-ui,
    sans-serif;
  padding: 12px;
  border-left: 3px solid var(--warn);
  background: #f1e9da;
  margin: 16px 0;
}
.preparation {
  max-width: 560px;
  padding: 60px 0;
}
.preparation h2 {
  font-size: 32px;
}
.preparation p {
  margin-top: 16px;
}
.preparation a,
.preparation button {
  color: var(--accent);
  text-decoration: underline;
}
.eyebrow {
  font:
    10px system-ui,
    sans-serif;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
@media (max-width: 960px) {
  .edition-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .module-lead {
    grid-row: span 2;
  }
}
@media (max-width: 620px) {
  .paper {
    padding: 20px;
  }
  .masthead {
    gap: 12px;
  }
  .masthead h1 {
    font-size: 34px;
  }
  .masthead nav {
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    font-size: 11px;
  }
  .edition-grid {
    grid-template-columns: 1fr;
    gap: 28px;
  }
  .module-lead {
    grid-row: auto;
  }
}
`;
export function shell(
  content: string,
  options: {
    date?: string;
    revision?: number;
    edition?: number;
    firstName?: string;
    generated?: string;
    taskyOrigin?: string;
    fixture?: boolean;
    script?: boolean;
    showSignOut?: boolean;
  } = {},
) {
  return /* HTML */ `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="robots" content="noindex,nofollow" />
        <title>The Daily Brief · Tasky</title>
        <style>
          ${styles.replace(/\s+/g, " ").trim()}
        </style>
        ${options.script
          ? `<script defer src="/assets/home.js?v=${browserScriptVersion}"></script>`
          : ""}
      </head>
      <body
        data-revision="${options.revision ?? 0}"
        data-renew-at="<!--RENEW_AT-->"
      >
        <div class="paper">
          <header>
            <div class="masthead">
              <h1>
                ${options.firstName
                  ? `Hello, ${e(options.firstName)}`
                  : "Hello"}
              </h1>
              <nav aria-label="Account">
                ${options.taskyOrigin
                  ? `<a href="${safeLink(options.taskyOrigin)}">Tasky ↗</a>`
                  : ""}
                ${options.showSignOut !== false
                  ? '<form action="/auth/logout" method="post"><button>Sign out</button></form>'
                  : ""}
              </nav>
            </div>
            <div class="dateline">
              <span>${e(options.date ?? "Tasky Homepage")}</span>
              ${options.generated
                ? `<span>Generated ${options.generated}</span>`
                : ""}
              ${options.edition
                ? `<span>Edition Nº ${options.edition}</span>`
                : ""}
              ${options.fixture ? "<span>Fictional preview</span>" : ""}
            </div>
          </header>
          <!--FRESHNESS-->${content}
        </div>
      </body>
    </html>`;
}
/** Daily cover number; feed.revision still increments for every publication. */
export function dailyEdition(at: number, timezone: string) {
  const localDate = calendar(at, timezone).localDate;
  return Math.max(
    1,
    Math.round((Date.parse(localDate) - Date.parse("2026-09-15")) / 86400_000) +
      1,
  );
}
export function renderEdition(
  feed: Feed,
  taskyOrigin: string,
  fixture = false,
) {
  const context = {
    taskyOrigin,
    timezone: feed.timezone,
    now: feed.publishedAt,
  };
  const parts = feed.modules
    .filter((m) => m.status !== "disabled")
    .map((snapshot) => {
      const module = moduleFor(snapshot.id);
      const timestamp =
        snapshot.id === "weather" || snapshot.id === "portfolio"
          ? snapshot.collectedAt
          : snapshot.sourceDataAt;
      const label =
        snapshot.status === "available"
          ? snapshot.id === "portfolio"
            ? "Checked"
            : "Updated"
          : snapshot.status === "unavailable" && snapshot.payload
            ? "Outdated"
            : snapshot.status;
      return /* HTML */ `<section
        class="module module-${module.placement}"
        aria-label="${e(module.title)}"
      >
        <div class="module-header">
          <h2>${e(module.title)}</h2>
          <div class="meta ${snapshot.status !== "available" ? "stale" : ""}">
            ${timestamp === null
              ? "Awaiting first update"
              : `${e(label)} ${sourceTime(timestamp, feed.timezone)}`}
          </div>
        </div>
        ${snapshot.error && snapshot.error !== "awaiting_data"
          ? '<p class="notice">The latest update failed. The last successful data is shown when available.</p>'
          : ""}${snapshot.payload
          ? renderModule(snapshot, context)
          : `<p class="empty">${snapshot.error === "awaiting_data" ? "Your first update is on its way." : "This source is temporarily unavailable."}</p>`}
      </section>`;
    });
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: feed.timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(feed.publishedAt);
  return shell(`<main class="edition-grid">${parts.join("")}</main>`, {
    date,
    revision: feed.revision,
    edition: dailyEdition(feed.publishedAt, feed.timezone),
    firstName: feed.displayName?.trim().split(/\s+/)[0],
    generated: `<time datetime="${new Date(feed.publishedAt).toISOString()}">${e(new Intl.DateTimeFormat("en-US", { timeZone: feed.timezone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(feed.publishedAt))}</time>`,
    taskyOrigin,
    fixture,
    script: true,
  });
}
/** Delivery-time freshness adds a banner to frozen HTML; it never changes the edition. */
export function freshnessBanner(feed: Feed, now: number) {
  const old = feed.modules
    .map((m) => withFreshness(m, now))
    .filter(
      (m) =>
        m.payload !== null &&
        (m.status === "stale" || m.status === "unavailable"),
    );
  if (!old.length) return "";
  return /* HTML */ `<aside class="notice" role="status">
    ${old
      .map(
        (m) =>
          `${e(moduleFor(m.id).title)}: ${m.status === "unavailable" ? "outdated; check the source before relying on it" : "an earlier snapshot"} (source ${sourceTime(m.sourceDataAt, feed.timezone)})`,
      )
      .join(". ")}.
    Updates will appear when the source recovers.
  </aside>`;
}
export const browserScript = `
(() => {
  let revision = Number(document.body.dataset.revision);
  let failures = 0;
  const poll = async () => {
    try {
      const r = await fetch("/", {
        cache: "no-store",
        credentials: "same-origin",
        redirect: "manual",
      });
      if (r.type === "opaqueredirect" || r.status === 401) {
        location.assign("/auth/renew");
        return;
      }
      if (r.ok) {
        const page = new DOMParser().parseFromString(
          await r.text(),
          "text/html",
        );
        const next = Number(page.body.dataset.revision);
        if (next > revision) {
          document
            .querySelector(".paper")
            .replaceWith(page.querySelector(".paper"));
          revision = next;
          document.body.dataset.revision = String(next);
        }
      }
      failures = 0;
    } catch {
      failures++;
    }
    setTimeout(
      poll,
      revision ? 120000 : Math.min(30000, 3000 * (failures + 1)),
    );
  };
  setTimeout(poll, revision ? 120000 : 3000);
  const scheduleRenew = (at) => {
    if (at > 0)
      setTimeout(
        async () => {
          try {
            const r = await fetch("/auth/renew", {
              method: "POST",
              credentials: "same-origin",
              headers: { accept: "application/json" },
            });
            if (!r.ok) {
              location.assign("/auth/renew");
              return;
            }
            scheduleRenew((await r.json()).renewAt);
          } catch {
            scheduleRenew(Date.now() + 60000);
          }
        },
        Math.max(1000, at - Date.now()),
      );
  };
  scheduleRenew(Number(document.body.dataset.renewAt));
})();
`;

// Content-derived cache key; this script contains no user-specific data.
export const browserScriptVersion = (
  Array.from(browserScript).reduce(
    (hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16777619),
    2166136261,
  ) >>> 0
).toString(16);
