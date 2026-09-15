import { taskyPayloadSchema, type TaskyPayload, type TaskyExport, type ModuleSnapshot } from "@tasky/home-feed";
import { escapeHtml as e, safeLink } from "../../rendering/html";
import type { HomeModule } from "../contract";

export const taskyModule: HomeModule<TaskyPayload> = {
  id: "tasky", title: "Your priorities", placement: "lead", schemaVersion: 1,
  freshForMs: 5 * 60_000, maxAgeMs: 60 * 60_000,
  parse: value => taskyPayloadSchema.parse(value),
  render(data, context) {
    const taskUrl = safeLink(`${context.taskyOrigin}/tasks`, context.taskyOrigin);
    const capturesUrl = safeLink(`${context.taskyOrigin}/captures`, context.taskyOrigin);
    const taskMarkup = data.tasks.map((task, index) => `<li class="task ${index === 0 ? "lead-task" : ""}">
      <div class="eyebrow"><span class="priority ${e(task.priority)}">${e(task.priority)}</span><span>${e(task.status.replaceAll("_", " "))}</span>${task.dueDate ? `<span class="${task.due === "overdue" ? "warning" : ""}">${task.due === "today" ? "Due today" : `${e(task.due)} · ${e(task.dueDate)}`}</span>` : ""}</div>
      <h3><a href="${taskUrl}">${e(task.title || "Untitled task")}</a></h3>
      ${task.labels.length ? `<p class="labels">${task.labels.map(e).join(" / ")}</p>` : ""}</li>`).join("");
    return `<div class="statline"><div><strong>${data.counts.active}${data.truncated ? "+" : ""}</strong><span>Open tasks</span></div><div><strong>${data.counts.dueToday}</strong><span>Due today</span></div><div><strong class="${data.counts.overdue ? "warning" : ""}">${data.counts.overdue}</strong><span>Overdue</span></div></div>
      <div class="section-heading"><h2>First things first</h2><a href="${taskUrl}">Open Tasky ↗</a></div>
      <ol class="task-list">${taskMarkup || '<li class="empty">A clear desk. No open tasks in this edition.</li>'}</ol>
      <div class="personal-columns"><section><div class="section-heading"><h2>The bigger picture</h2><span class="eyebrow">Scorecards</span></div>
      ${data.scorecards.length ? data.scorecards.map(card => `<article class="scorecard"><div class="row"><h3>${e(card.name)}</h3><span class="score">${card.target ? `${card.count} / ${card.target}` : `${Math.round(card.ratio * 100)}%`}</span></div><progress max="1" value="${card.ratio}" aria-label="${e(card.name)} progress"></progress><p class="meta">${card.isComplete ? "Complete for this period" : "In progress"}</p></article>`).join("") : '<p class="empty">No scorecards yet.</p>'}
      <h3 class="small-heading">Worth your attention</h3><ul class="signal-list">${data.signals.map(signal => `<li><span class="signal-dot ${e(signal.attention)}" aria-label="${e(signal.attention)}"></span><div><strong>${e(signal.name)}</strong><p>${e(signal.reason)}</p></div></li>`).join("") || '<li class="empty">Nothing calling for your attention.</li>'}</ul></section>
      <section><div class="section-heading"><h2>On your mind</h2><span class="eyebrow">${data.counts.captures} captures</span></div><ul class="captures">${data.captures.map(capture => `<li><a href="${capturesUrl}">${e(capture.text)}</a></li>`).join("") || '<li class="empty">Your capture inbox is clear.</li>'}</ul><a class="text-link" href="${capturesUrl}">Visit your inbox ↗</a></section></div>
      ${data.truncated ? '<p class="meta">A bounded selection is shown. Counts may be lower bounds; open Tasky for the complete view.</p>' : ""}`;
  },
};
export function ingestTasky(value: TaskyExport): ModuleSnapshot {
  return { id: taskyModule.id, schemaVersion: 1, scope: "user", sourceRevision: value.sourceRevision, sourceDataAt: value.exportedAt, collectedAt: Date.now(), freshForMs: taskyModule.freshForMs, maxAgeMs: taskyModule.maxAgeMs, status: "available", payload: taskyModule.parse(value.payload) };
}
