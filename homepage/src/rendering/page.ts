import { withFreshness, type Feed } from "@tasky/home-feed";
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
button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 5px;
}
.paper {
  max-width: 1280px;
  margin: auto;
  padding: 24px 42px 32px;
}
.utility,
.eyebrow,
.meta,
.labels,
.section-heading > a,
.text-link,
button,
.attribution {
  font-family: system-ui, sans-serif;
}
.utility {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  font-size: 11px;
  letter-spacing: 0.06em;
}
.utility nav {
  display: flex;
  gap: 20px;
  align-items: center;
}
.utility form {
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
.masthead {
  text-align: center;
  padding: 24px 0 18px;
  border-bottom: 4px double var(--ink);
}
.masthead h1 {
  font-size: clamp(42px, 7vw, 76px);
  font-weight: 700;
  letter-spacing: -0.06em;
  line-height: 1;
  margin: 0 0 14px;
}
.masthead p {
  font-size: 14px;
  font-style: italic;
  color: var(--muted);
  margin: 0;
}
.dateline {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--ink);
  padding: 10px 0;
  font:
    11px system-ui,
    sans-serif;
  letter-spacing: 0.06em;
}
.edition-grid {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(230px, 1fr);
  gap: 30px;
  margin-top: 28px;
}
.module-supporting {
  border-left: 1px solid var(--rule);
  padding-left: 26px;
}
.module-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-size: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.meta {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.7;
}
.section-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  border-top: 1px solid var(--ink);
  padding: 16px 0 10px;
}
h2 {
  font-size: 24px;
  line-height: 1.15;
  margin: 0;
}
h3 {
  font-size: 19px;
  line-height: 1.25;
  margin: 0;
}
.section-heading > a,
.text-link {
  font-size: 11px;
  white-space: nowrap;
  color: var(--accent);
}
.statline {
  display: flex;
  gap: 34px;
  padding: 0 0 24px;
}
.statline div {
  display: flex;
  align-items: center;
  gap: 10px;
}
.statline strong {
  font-size: 38px;
  line-height: 1;
}
.statline span {
  font:
    10px/1.4 system-ui,
    sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  max-width: 56px;
}
.task-list,
.signal-list,
.captures {
  list-style: none;
  margin: 0;
  padding: 0;
}
.task {
  padding: 16px 0;
  border-bottom: 1px solid var(--rule);
}
.task h3 {
  margin-top: 8px;
}
.task h3,
.captures li,
.signal-list,
.scorecard h3,
.labels,
.weather-location,
.conditions,
.forecast-day > span {
  overflow-wrap: anywhere;
}
.task .labels {
  font-size: 11px;
  color: var(--muted);
  margin: 8px 0 0;
}
.task.lead-task {
  padding-top: 8px;
  padding-bottom: 22px;
}
.lead-task h3 {
  font-size: clamp(27px, 3.2vw, 39px);
  letter-spacing: -0.025em;
  line-height: 1.13;
  max-width: 95%;
}
.priority {
  color: var(--accent);
  font-weight: 700;
}
.priority.urgent,
.warning {
  color: var(--warn);
}
.personal-columns {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 26px;
  margin-top: 28px;
}
.personal-columns h2 {
  font-size: 21px;
}
.scorecard {
  margin: 12px 0 20px;
}
.row {
  display: flex;
  justify-content: space-between;
  gap: 15px;
}
.score {
  white-space: nowrap;
  font:
    15px system-ui,
    sans-serif;
  color: var(--accent);
}
progress {
  appearance: none;
  width: 100%;
  height: 5px;
  border: 0;
  margin-top: 12px;
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
.scorecard .meta {
  margin: 4px 0;
}
.small-heading {
  font-size: 16px;
  border-top: 1px solid var(--rule);
  padding-top: 16px;
}
.signal-list li {
  display: flex;
  gap: 10px;
  margin: 15px 0;
}
.signal-list strong {
  font-size: 14px;
}
.signal-list p {
  font:
    11px/1.5 system-ui,
    sans-serif;
  color: var(--muted);
  margin: 3px 0;
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
.captures li {
  font-size: 15px;
  padding: 13px 0;
  border-bottom: 1px solid var(--rule);
}
.text-link {
  display: inline-block;
  margin-top: 15px;
}
.temperature {
  font-size: 82px;
  letter-spacing: -0.06em;
  line-height: 1.15;
  margin: 20px 0 0;
}
.temperature > span {
  font-size: 30px;
  vertical-align: top;
  display: inline-block;
  padding-top: 17px;
  letter-spacing: -0.02em;
}
.conditions {
  font-size: 22px;
  margin: 0 0 10px;
}
.weather-location {
  margin-top: 15px;
  color: var(--muted);
}
.forecast {
  border-top: 1px solid var(--rule);
  margin-top: 25px;
}
.forecast-day {
  display: grid;
  grid-template-columns: 30px 1fr auto;
  align-items: baseline;
  gap: 8px;
  padding: 14px 0;
  border-bottom: 1px solid var(--rule);
  font-size: 12px;
}
.forecast-day > span {
  font:
    11px/1.5 system-ui,
    sans-serif;
}
.forecast-day b {
  white-space: nowrap;
}
.muted {
  color: var(--muted);
  font-weight: 400;
}
.attribution {
  display: inline-block;
  font-size: 10px;
  margin-top: 10px;
  color: var(--muted);
}
.empty {
  color: var(--muted);
  font-size: 14px;
  padding: 18px 0;
}
.notice {
  font:
    12px/1.6 system-ui,
    sans-serif;
  padding: 12px 16px;
  border-left: 3px solid var(--warn);
  background: #f1e9da;
  margin: 20px 0;
}
.footer {
  border-top: 4px double var(--ink);
  display: flex;
  justify-content: space-between;
  gap: 20px;
  margin-top: 38px;
  padding-top: 16px;
  font:
    10px/1.7 system-ui,
    sans-serif;
  color: var(--muted);
}
.preparation {
  max-width: 560px;
  padding: 60px 0 100px;
}
.preparation h2 {
  font-size: 36px;
}
.preparation a,
.preparation button {
  color: var(--accent);
  text-decoration: underline;
}
.stale {
  color: var(--warn);
}
@media (max-width: 850px) {
  .paper {
    padding: 20px 24px;
  }
  .edition-grid {
    gap: 22px;
    grid-template-columns: minmax(0, 2fr) minmax(205px, 1fr);
  }
  .personal-columns {
    grid-template-columns: 1fr;
  }
  .statline {
    gap: 16px;
  }
  .statline strong {
    font-size: 30px;
  }
  .module-supporting {
    padding-left: 20px;
  }
}
@media (max-width: 620px) {
  .paper {
    padding: 16px 20px;
  }
  .utility {
    font-size: 10px;
  }
  .utility nav {
    gap: 12px;
  }
  .masthead {
    padding: 25px 0 20px;
  }
  .dateline {
    font-size: 9px;
  }
  .edition-grid {
    grid-template-columns: 1fr;
  }
  .module-supporting {
    border-left: 0;
    border-top: 1px solid var(--ink);
    padding: 22px 0 0;
  }
  .personal-columns {
    gap: 18px;
  }
  .statline {
    justify-content: space-between;
  }
  .footer {
    flex-direction: column;
    gap: 4px;
  }
  .module-header {
    flex-wrap: wrap;
  }
  .lead-task h3 {
    max-width: 100%;
  }
  .temperature {
    font-size: 64px;
  }
  .forecast {
    margin-top: 20px;
  }
}
`;
export function shell(
  content: string,
  options: {
    date?: string;
    revision?: number;
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
          ${styles}
        </style>
        ${options.script ? '<script defer src="/assets/home.js"></script>' : ""}
      </head>
      <body
        data-revision="${options.revision ?? 0}"
        data-renew-at="<!--RENEW_AT-->"
      >
        <div class="paper">
          <header>
            <div class="utility">
              <span
                >${options.fixture
                  ? "DESIGN PREVIEW · FICTIONAL DATA"
                  : "YOUR PRIVATE EDITION"}</span
              >
              <nav>
                ${options.taskyOrigin
                  ? `<a href="${safeLink(options.taskyOrigin)}">Tasky ↗</a>`
                  : ""}
                ${options.showSignOut !== false
                  ? `<form action="/auth/logout" method="post">
                      <button>Sign out</button>
                    </form>`
                  : ""}
              </nav>
            </div>
            <div class="masthead">
              <h1>The Daily Brief</h1>
              <p>A little perspective for the day ahead.</p>
            </div>
            <div class="dateline">
              <span>${e(options.date ?? "Your personal homepage")}</span
              ><span
                >${options.revision
                  ? `EDITION Nº ${options.revision}`
                  : "PREPARING YOUR EDITION"}</span
              >
            </div>
          </header>
          <!--FRESHNESS-->${content}
          <footer class="footer">
            <span
              >A quiet place to see what matters.<br />Private to you. Read-only
              here; make changes in Tasky.</span
            ><span
              >Sources update in the background.<br />Source times reflect the
              data, not the time you opened this page.</span
            >
          </footer>
        </div>
      </body>
    </html>`;
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
      const state =
        snapshot.status === "unavailable" && snapshot.payload
          ? "Outdated"
          : snapshot.status;
      return /* HTML */ `<section
        class="module-${module.placement}"
        aria-label="${e(module.title)}"
      >
        <div class="module-header">
          <span class="eyebrow"
            >${e(
              module.id === "tasky" ? "From your Tasky" : module.title,
            )}</span
          ><span class="meta ${snapshot.status !== "available" ? "stale" : ""}"
            >${e(state)} ·
            ${sourceTime(snapshot.sourceDataAt, feed.timezone)}</span
          >
        </div>
        ${snapshot.error && snapshot.error !== "awaiting_data"
          ? '<p class="notice">The latest update failed. The last successful data is shown when available.</p>'
          : ""}${snapshot.payload
          ? renderModule(snapshot, context)
          : `<h2>${e(module.title)}</h2><p class="empty">${snapshot.error === "awaiting_data" ? "Your first update is on its way." : "This source is temporarily unavailable."}</p>`}
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
