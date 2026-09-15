import {
  taskyPayloadSchema,
  type TaskyPayload,
  type TaskyExport,
  type ModuleSnapshot,
} from "@tasky/home-feed";
import { escapeHtml as e, safeLink } from "../../rendering/html";
import type { HomeModule } from "../contract";

export const taskyModule: HomeModule<TaskyPayload> = {
  id: "tasky",
  title: "Tasky",
  placement: "lead",
  schemaVersion: 1,
  freshForMs: 15 * 60_000,
  maxAgeMs: 60 * 60_000,
  parse: (value) => taskyPayloadSchema.parse(value),
  render(data, context) {
    const taskUrl = safeLink(
      `${context.taskyOrigin}/tasks`,
      context.taskyOrigin,
    );
    const attention = data.signals
      .filter((signal) => signal.attention !== "ok")
      .sort(
        (a, b) =>
          ({ due: 0, soon: 1, unknown: 2, ok: 3 })[a.attention] -
          { due: 0, soon: 1, unknown: 2, ok: 3 }[b.attention],
      )
      .slice(0, 3);
    const today = data.signals.filter((signal) => signal.todayCount > 0);
    const scorecard = (card: TaskyPayload["scorecards"][number]) => `
      <li class="scorecard">
        <div class="row"><h3>${e(card.name)}</h3><span class="score">${card.isComplete ? "✓ " : ""}${Math.round(card.ratio * 100)}%</span></div>
        <progress max="1" value="${card.ratio}" aria-label="${e(card.name)} progress"></progress>
      </li>`;
    return /* HTML */ ` <section class="tasky-section">
        <h3 class="section-label">Scorecards</h3>
        <ul class="scorecards">
          ${data.scorecards.slice(0, 4).map(scorecard).join("") ||
          '<li class="empty">No scorecards yet.</li>'}
        </ul>
        ${data.scorecards.length > 4
          ? `<details><summary>${data.scorecards.length - 4} more scorecards</summary><ul class="scorecards">${data.scorecards.slice(4).map(scorecard).join("")}</ul></details>`
          : ""}
      </section>
      <section class="tasky-section">
        <h3 class="section-label">Signals</h3>
        <ul class="signal-list">
          ${attention
            .map(
              (signal) => `
          <li><span class="signal-dot ${e(signal.attention)}" aria-hidden="true"></span>
            <div><strong>${e(signal.name)}</strong><p>${e(signal.reason)}</p></div></li>`,
            )
            .join("") || '<li class="empty">All on track.</li>'}
        </ul>
        ${today.length
          ? `<h4 class="section-label logged-label">Logged today</h4><ul class="logged-signals">${today.map((signal) => `<li><span aria-hidden="true">✓</span> ${e(signal.name)}${signal.todayCount > 1 ? ` <span class="muted">×${signal.todayCount}</span>` : ""}</li>`).join("")}</ul>`
          : ""}
      </section>
      <section class="task-summary">
        <div class="section-heading">
          <h3 class="section-label">Tasks & inbox</h3>
          <a href="${taskUrl}">Open Tasky ↗</a>
        </div>
        <div class="statline">
          <div>
            <strong>${data.counts.active}${data.truncated ? "+" : ""}</strong
            ><span>Open</span>
          </div>
          <div>
            <strong>${data.counts.dueToday}</strong><span>Due today</span>
          </div>
          <div>
            <strong class="${data.counts.overdue ? "warning" : ""}"
              >${data.counts.overdue}</strong
            ><span>Overdue</span>
          </div>
          <div><strong>${data.counts.captures}</strong><span>Inbox</span></div>
        </div>
      </section>
      ${data.truncated
        ? '<p class="meta">A selection is shown; counts may be lower bounds.</p>'
        : ""}`;
  },
};
export function ingestTasky(value: TaskyExport): ModuleSnapshot {
  return {
    id: taskyModule.id,
    schemaVersion: 1,
    scope: "user",
    sourceRevision: value.sourceRevision,
    sourceDataAt: value.exportedAt,
    collectedAt: Date.now(),
    freshForMs: taskyModule.freshForMs,
    maxAgeMs: taskyModule.maxAgeMs,
    status: "available",
    payload: taskyModule.parse(value.payload),
  };
}
