import { calendar, withFreshness, type Feed } from "@tasky/home-feed";
import { moduleFor, renderModule } from "../modules/registry";
import { escapeHtml as e, sourceTime } from "./html";

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
  padding: 18px 36px;
}
.masthead {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  padding-bottom: 12px;
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
.due-tasks,
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
  padding: 8px 0;
  border-bottom: 1px solid var(--ink);
  font-size: 11px;
  color: var(--muted);
}
.edition-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 28px;
  margin-top: 18px;
}
.module {
  min-width: 0;
}
@media (min-width: 961px) {
  .module-portfolio {
    grid-column: 1;
    grid-row: 2;
  }
  .module-strava {
    grid-column: 2;
    grid-row: 2;
  }
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
.module-title,
.module-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.module-actions {
  font:
    11px system-ui,
    sans-serif;
}
.module-open,
.module-refresh button {
  color: var(--accent);
  white-space: nowrap;
}
.module-info {
  position: relative;
}
.info-trigger {
  opacity: 0;
  color: var(--muted);
  font-size: 17px;
  line-height: 1;
  padding: 4px;
}
.module-header:hover .info-trigger,
.module-info:focus-within .info-trigger {
  opacity: 1;
}
.info-tooltip {
  display: block;
  position: absolute;
  right: 0;
  top: 100%;
  width: min(280px, 75vw);
  padding: 12px;
  background: var(--paper);
  border: 1px solid var(--rule);
  box-shadow: 0 4px 14px #24282020;
  z-index: 2;
  color: var(--muted);
  font:
    11px/1.5 system-ui,
    sans-serif;
  visibility: hidden;
  opacity: 0;
}
.info-tooltip > span {
  display: block;
}
.info-tooltip > span + span {
  margin-top: 10px;
}
.info-tooltip strong {
  color: var(--ink);
}
.module-info:hover .info-tooltip,
.module-info:focus-within .info-tooltip {
  visibility: visible;
  opacity: 1;
}
@media (hover: none) {
  .info-trigger {
    opacity: 1;
  }
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
.briefing-markdown {
  overflow-wrap: anywhere;
}
.briefing-markdown > * + * {
  margin-top: 12px;
}
.briefing-markdown h1,
.briefing-markdown h2,
.briefing-markdown h3 {
  font-size: 18px;
  line-height: 1.25;
}
.briefing-markdown ul,
.briefing-markdown ol {
  margin: 8px 0 0;
  padding-left: 22px;
}
.briefing-markdown blockquote {
  margin: 12px 0;
  padding-left: 12px;
  border-left: 2px solid var(--rule);
  color: var(--muted);
}
.briefing-markdown code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.88em;
}
.widget-date {
  display: block;
  margin-bottom: 12px;
  color: var(--muted);
  font:
    11px system-ui,
    sans-serif;
}
.strava-activities {
  display: grid;
  gap: 18px;
}
.strava-activity {
  min-width: 0;
}
.strava-activity + .strava-activity {
  padding-top: 18px;
  border-top: 1px solid var(--rule);
}
.strava-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.strava-heading h3 {
  font-size: 16px;
}
.strava-heading time {
  display: block;
  margin-top: 2px;
  color: var(--muted);
  font-size: 10px;
}
.strava-heading > a {
  color: var(--accent);
  font-size: 10px;
  white-space: nowrap;
}
.strava-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
  margin: 12px 0 0;
  font-variant-numeric: tabular-nums;
}
.strava-stats div {
  min-width: 0;
}
.strava-stats dt {
  color: var(--muted);
  font-size: 9px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.strava-stats dd {
  margin: 2px 0 0;
  font-size: 15px;
  font-weight: 600;
}
.recurring-expenses {
  display: grid;
  gap: 22px;
}
.recurring-expenses .section-label {
  margin-bottom: 4px;
}
.expense-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.expense-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: baseline;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--rule);
}
.expense-list li:last-child {
  border-bottom: 0;
}
.expense-name {
  display: grid;
  min-width: 0;
}
.expense-name strong {
  overflow-wrap: anywhere;
}
.expense-name span,
.expense-amount small,
.expense-list time {
  color: var(--muted);
  font-size: 10px;
}
.expense-amount {
  display: grid;
  justify-items: end;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.expense-amount small {
  font-weight: 400;
}
.expense-list time {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.expense-category-totals {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 18px;
  margin: 10px 0 0;
}
.expense-category-totals div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 5px;
  border-bottom: 1px solid var(--rule);
}
.expense-category-totals dt {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--muted);
  font-size: 11px;
}
.expense-category-totals dd {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.release-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.release-list li {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--rule);
}
.release-list li:last-child {
  border-bottom: 0;
}
.release-kind {
  color: var(--accent);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.release-title {
  display: grid;
  min-width: 0;
}
.release-title strong {
  overflow-wrap: anywhere;
}
.release-title span,
.release-list time {
  color: var(--muted);
  font-size: 10px;
}
.release-list time {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.tasky-section {
  margin-bottom: 20px;
}
.scorecards,
.signal-list,
.due-tasks {
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
.scorecards > .scorecard:first-child {
  margin-top: 0;
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
.signal-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 3px 8px;
}
.signal-tags {
  font:
    10px system-ui,
    sans-serif;
  color: var(--muted);
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
.due-tasks {
  margin-top: 8px;
  font-size: 13px;
}
.due-tasks li {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.due-tasks li + li {
  margin-top: 4px;
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
  display: grid;
  grid-template-columns: auto minmax(72px, max-content) minmax(110px, 1fr);
  align-items: center;
  gap: 12px;
  margin: 16px 0;
}
.weather-emoji {
  font-size: 42px;
  line-height: 1;
}
.temperature {
  font-size: 48px;
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
.current-details {
  color: var(--muted);
  font-size: 12px;
  margin-top: 3px;
  white-space: nowrap;
}
.rain-chart {
  margin: 0;
  min-width: 0;
  overflow: visible;
  font:
    10px system-ui,
    sans-serif;
}
.rain-chart figcaption {
  display: flex;
  justify-content: space-between;
  gap: 4px;
  margin-bottom: 22px;
  color: var(--ink);
}
.rain-chart figcaption span {
  color: var(--muted);
  font-size: 9px;
}
.rain-plot {
  display: flex;
  gap: 5px;
  height: 60px;
  overflow: visible;
}
.rain-scale {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  color: var(--muted);
  font-size: 8px;
}
.rain-bars {
  display: flex;
  flex: 1;
  gap: 2px;
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
}
.rain-hour {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  flex: 1;
  min-width: 0;
}
.rain-bar {
  display: block;
  width: 100%;
  max-width: 9px;
  background: #668aa3;
  border-radius: 2px 2px 0 0;
}
.rain-hour.unknown {
  border-bottom: 1px dashed var(--muted);
}
.rain-hour:hover {
  background: #668aa315;
}
.rain-tip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 3px);
  transform: translateX(-50%);
  padding: 3px 6px;
  background: var(--paper);
  border: 1px solid var(--rule);
  box-shadow: 0 4px 14px #24282020;
  color: var(--ink);
  font:
    11px system-ui,
    sans-serif;
  white-space: nowrap;
  pointer-events: none;
  visibility: hidden;
  z-index: 3;
}
.rain-hour:first-child .rain-tip {
  left: 0;
  transform: none;
}
.rain-hour:last-child .rain-tip {
  left: auto;
  right: 0;
  transform: none;
}
.rain-hour:hover .rain-tip,
.rain-hour:focus-within .rain-tip {
  visibility: visible;
}
.rain-times {
  display: flex;
  justify-content: space-between;
  margin: 5px 0 0 25px;
  color: var(--muted);
  font-size: 9px;
}
.rain-empty {
  margin-left: auto;
  max-width: 140px;
}
.current-weather-missing .rain-chart {
  max-width: 240px;
  margin-bottom: 16px;
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
.forecast-values {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.rain-chance {
  font:
    10px system-ui,
    sans-serif;
  color: var(--muted);
  margin-top: 3px;
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
.portfolio-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
  font:
    11px system-ui,
    sans-serif;
}
.portfolio-tabs button {
  padding: 5px 10px;
  border: 1px solid var(--rule);
  border-radius: 999px;
  color: var(--muted);
}
.portfolio-tabs button[aria-selected="true"] {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--paper);
}
.portfolio-value {
  font-size: clamp(32px, 3.5vw, 44px);
  letter-spacing: -0.045em;
  line-height: 1.2;
  margin: 0 0 4px;
  overflow-wrap: anywhere;
}
.portfolio-market-time {
  margin-top: 8px;
}
.holdings-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-top: 24px;
  padding-bottom: 7px;
  border-bottom: 1px solid var(--ink);
}
.portfolio-table-scroll {
  overflow-x: auto;
}
.portfolio-table {
  width: 100%;
  min-width: 360px;
  border-collapse: collapse;
  table-layout: fixed;
  font:
    11px/1.35 system-ui,
    sans-serif;
  font-variant-numeric: tabular-nums;
}
.portfolio-table th,
.portfolio-table td {
  padding: 9px 5px;
  border-bottom: 1px solid var(--rule);
  text-align: right;
  vertical-align: middle;
  white-space: nowrap;
}
.portfolio-table th:first-child,
.portfolio-table td:first-child {
  width: 30%;
  padding-left: 0;
  text-align: left;
}
.portfolio-table th:last-child,
.portfolio-table td:last-child {
  padding-right: 0;
}
.portfolio-table th {
  color: var(--muted);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.portfolio-table th button {
  width: 100%;
  text-align: inherit;
}
.portfolio-table th[aria-sort="ascending"],
.portfolio-table th[aria-sort="descending"] {
  color: var(--ink);
}
.sort-arrow {
  display: inline-block;
  min-width: 8px;
  color: var(--accent);
}
.portfolio-holding {
  overflow: hidden;
}
.portfolio-holding strong,
.portfolio-holding span,
.portfolio-table td > span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}
.portfolio-holding span,
.portfolio-table td > span {
  margin-top: 2px;
  color: var(--muted);
  font-size: 9px;
  font-weight: 400;
}
.portfolio-table[data-expanded="false"] tbody tr:nth-child(n + 6) {
  display: none;
}
.portfolio-expand {
  margin-top: 10px;
  color: var(--accent);
  font:
    10px system-ui,
    sans-serif;
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
  font: inherit;
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
    padding: 14px 20px;
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
    fixture?: boolean;
    script?: boolean;
    showSignOut?: boolean;
  } = {},
) {
  const greeting = options.firstName ? `Hello, ${options.firstName}` : "Hello";
  return /* HTML */ `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="robots" content="noindex,nofollow" />
        <title>${e(greeting)}</title>
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
              <h1>${e(greeting)}</h1>
              <nav aria-label="Account">
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
        class="module module-${module.placement} module-${e(module.id)}"
        aria-label="${e(module.title)}"
      >
        <div class="module-header">
          ${module.renderHeader
            ? module.renderHeader(snapshot, context)
            : `<div class="module-title">
            <h2>${e(module.title)}</h2>
            <div class="module-actions">
              <span class="module-info">
                <button class="info-trigger" type="button"
                  aria-label="${e(module.title)} timing information"
                  aria-describedby="${e(module.id)}-info">ⓘ</button>
                <span class="info-tooltip" id="${e(module.id)}-info" role="tooltip">
                  <span>${
                    timestamp === null
                      ? "Awaiting first update"
                      : `<strong>${e(label)}</strong> ${sourceTime(timestamp, feed.timezone)}`
                  }</span>
                </span>
              </span>
            </div>
          </div>`}
        </div>
        ${snapshot.payload
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
    fixture,
    script: true,
  });
}
/** Delivery-time notice only when a source is past maxAge. Stale last-good
 * snapshots are expected and must not look like an error. */
export function freshnessBanner(feed: Feed, now: number) {
  const old = feed.modules
    .map((m) => withFreshness(m, now))
    .filter((m) => m.payload !== null && m.status === "unavailable");
  if (!old.length) return "";
  return /* HTML */ `<aside class="notice" role="status">
    ${old
      .map(
        (m) =>
          `${e(moduleFor(m.id).title)} is outdated (${sourceTime(m.sourceDataAt, feed.timezone)}).`,
      )
      .join(" ")}
  </aside>`;
}
export const browserScript = `
(() => {
  const portfolioStorageKey = "tasky:selected-portfolio";
  const portfolioSortStorageKey = "tasky:portfolio-sort";
  const portfolioSortKeys = ["ticker", "day-dollar", "day-percent", "value", "total-percent"];
  let portfolioSortKey = "day-dollar";
  let portfolioSortDirection = "desc";
  try {
    const savedSort = (localStorage.getItem(portfolioSortStorageKey) ?? "").split(":");
    if (
      portfolioSortKeys.includes(savedSort[0]) &&
      (savedSort[1] === "asc" || savedSort[1] === "desc")
    ) {
      portfolioSortKey = savedSort[0];
      portfolioSortDirection = savedSort[1];
    }
  } catch {}
  const applyPortfolioSort = (table, key, direction) => {
    const rows = Array.from(table.tBodies[0].rows);
    rows.sort((a, b) => {
      const av = a.getAttribute("data-sort-" + key) ?? "";
      const bv = b.getAttribute("data-sort-" + key) ?? "";
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      const compared =
        key === "ticker" ? av.localeCompare(bv) : Number(av) - Number(bv);
      return direction === "asc" ? compared : -compared;
    });
    rows.forEach((row) => table.tBodies[0].append(row));
    table.querySelectorAll("[data-portfolio-sort]").forEach((button) => {
      const active = button.getAttribute("data-portfolio-sort") === key;
      button.dataset.direction = active ? direction : "";
      const arrow = button.querySelector(".sort-arrow");
      if (arrow)
        arrow.textContent = active ? (direction === "asc" ? "▲" : "▼") : "";
      button.closest("th")?.setAttribute(
        "aria-sort",
        active ? (direction === "asc" ? "ascending" : "descending") : "none",
      );
    });
  };
  const selectPortfolio = (requestedId) => {
    const tabs = Array.from(document.querySelectorAll("[data-portfolio-tab]"));
    if (!tabs.length) return;
    const selected =
      tabs.find((tab) => tab.getAttribute("data-portfolio-tab") === requestedId) ??
      tabs[0];
    const selectedId = selected.getAttribute("data-portfolio-tab");
    tabs.forEach((tab) => {
      const active = tab === selected;
      tab.setAttribute("aria-selected", String(active));
      tab.setAttribute("tabindex", active ? "0" : "-1");
    });
    document.querySelectorAll("[data-portfolio-panel]").forEach((panel) => {
      panel.toggleAttribute(
        "hidden",
        panel.getAttribute("data-portfolio-panel") !== selectedId,
      );
      if (panel.getAttribute("data-portfolio-panel") === selectedId) {
        const table = panel.querySelector("[data-portfolio-table]");
        if (table instanceof HTMLTableElement)
          applyPortfolioSort(
            table,
            portfolioSortKey,
            portfolioSortDirection,
          );
      }
    });
    try {
      localStorage.setItem(portfolioStorageKey, selectedId ?? "");
    } catch {}
  };
  const applyPortfolioSelection = () => {
    let selected = "";
    try {
      selected = localStorage.getItem(portfolioStorageKey) ?? "";
    } catch {}
    selectPortfolio(selected);
  };
  const renewal = document.querySelector("form[data-auto-renew]");
  if (renewal instanceof HTMLFormElement) {
    const renew = async () => {
      try {
        const r = await fetch(renewal.action, {
          method: "POST",
          credentials: "same-origin",
          headers: { accept: "application/json" },
        });
        if (r.ok) {
          location.replace("/");
          return;
        }
        if (r.status === 401) location.replace("/auth/sign-in");
      } catch {
        // Keep the manual form available when automatic renewal cannot connect.
      }
    };
    renew();
    return;
  }
  document.addEventListener("click", (event) => {
    const element = event.target instanceof Element ? event.target : null;
    const portfolioTab = element?.closest("[data-portfolio-tab]");
    if (portfolioTab instanceof HTMLButtonElement) {
      selectPortfolio(portfolioTab.dataset.portfolioTab ?? "");
      return;
    }
    const expand = element?.closest("[data-portfolio-expand]");
    if (expand instanceof HTMLButtonElement) {
      const table = expand
        .closest("[data-portfolio-panel]")
        ?.querySelector("[data-portfolio-table]");
      if (!(table instanceof HTMLTableElement)) return;
      const open = table.dataset.expanded !== "true";
      table.dataset.expanded = String(open);
      expand.ariaExpanded = String(open);
      expand.textContent = open
        ? "Show fewer"
        : "Show all " + table.tBodies[0].rows.length;
      return;
    }
    const sort = element?.closest("[data-portfolio-sort]");
    if (!(sort instanceof HTMLButtonElement)) return;
    const table = sort.closest("[data-portfolio-table]");
    if (!(table instanceof HTMLTableElement)) return;
    const key = sort.dataset.portfolioSort;
    if (!key || !portfolioSortKeys.includes(key)) return;
    portfolioSortDirection =
      key === portfolioSortKey
        ? portfolioSortDirection === "asc"
          ? "desc"
          : "asc"
        : key === "ticker"
          ? "asc"
          : "desc";
    portfolioSortKey = key;
    document.querySelectorAll("[data-portfolio-table]").forEach((candidate) => {
      if (candidate instanceof HTMLTableElement)
        applyPortfolioSort(
          candidate,
          portfolioSortKey,
          portfolioSortDirection,
        );
    });
    try {
      localStorage.setItem(
        portfolioSortStorageKey,
        portfolioSortKey + ":" + portfolioSortDirection,
      );
    } catch {}
  });
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
          document.title = page.title;
          document
            .querySelector(".paper")
            .replaceWith(page.querySelector(".paper"));
          applyPortfolioSelection();
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
  applyPortfolioSelection();
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
