import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { calendar, LIMITS, localDateSchema, summary, taskyPayloadSchema, type TaskyPayload } from "../../packages/home-feed/src/index";
import { evaluateSignal, type ActivityPeriodProgress } from "./signalStatus";
import { evaluateScorecard, type ScorecardEvaluation } from "./scorecardStatus";

const statuses = ["not_started", "in_progress", "agent_running", "blocked"] as const;
const weights = { urgent: 5, high: 4, medium: 3, low: 2, triage: 1 };

/** One mutation snapshot, bounded indexed reads, no public/user-provided auth context. */
export async function projectHomepage(ctx: MutationCtx, userId: string, timezone: string, now: number): Promise<TaskyPayload> {
  const dates = calendar(now, timezone);
  const [taskGroups, priorityGroups, deadlineGroups, captures, signals, scorecards] = await Promise.all([
    Promise.all(statuses.map(status => ctx.db.query("tasks").withIndex("by_user_status", q => q.eq("userId", userId).eq("status", status)).order("desc").take(201))),
    Promise.all(statuses.flatMap(status => (["urgent", "high"] as const).map(priority => ctx.db.query("tasks").withIndex("by_user_status_priority", q => q.eq("userId", userId).eq("status", status).eq("priority", priority)).take(13)))),
    Promise.all(statuses.map(status => ctx.db.query("tasks").withIndex("by_user_status_due_date", q => q.eq("userId", userId).eq("status", status).gte("dueDate", "0001-01-01").lte("dueDate", dates.upcomingDate)).take(13))),
    ctx.db.query("captures").withIndex("by_user_completed", q => q.eq("userId", userId).eq("completed", false)).order("desc").take(201),
    ctx.db.query("signals").withIndex("by_user_archived", q => q.eq("userId", userId).eq("archivedAt", undefined)).take(61),
    ctx.db.query("scorecards").withIndex("by_user_archived", q => q.eq("userId", userId).eq("archivedAt", undefined)).take(31),
  ]);
  let truncated = taskGroups.some(group => group.length > 200) || captures.length > 200 || signals.length > 60 || scorecards.length > 30;
  const countedTasks = taskGroups.flatMap(group => group.slice(0, 200));
  // Separate deadline/priority reads keep important older tasks in the selection
  // even when the bounded count scan only sees more recently created records.
  const tasks = [...new Map([...countedTasks, ...priorityGroups.flat(), ...deadlineGroups.flat()].map(task => [task._id, task])).values()].map(task => ({ ...task, dueDate: localDateSchema.safeParse(task.dueDate).data }));
  const due = (date?: string): TaskyPayload["tasks"][number]["due"] => !date ? "none" : date < dates.localDate ? "overdue" : date === dates.localDate ? "today" : date <= dates.upcomingDate ? "upcoming" : "later";
  const dueWeight = { overdue: 4, today: 3, upcoming: 2, later: 1, none: 0 };
  tasks.sort((a, b) => dueWeight[due(b.dueDate)] - dueWeight[due(a.dueDate)] || weights[b.priority] - weights[a.priority] || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a._creationTime - b._creationTime || a._id.localeCompare(b._id));
  const selected = await Promise.all(tasks.slice(0, LIMITS.tasks).map(async task => {
    const tags = await Promise.all(task.tagIds.slice(0, 3).map(id => ctx.db.get("tags", id)));
    return { id: task._id, title: summary(task.content), status: task.status as typeof statuses[number], priority: task.priority, ...(task.dueDate ? { dueDate: task.dueDate } : {}), due: due(task.dueDate), labels: tags.filter((tag): tag is Doc<"tags"> => tag !== null && tag.userId === userId).map(tag => summary(tag.name, 60)) };
  }));
  const evaluated = await Promise.all(signals.slice(0, 60).map(async signal => {
    let progress: ActivityPeriodProgress | undefined;
    if (signal.model.kind === "activity" && signal.model.target?.type === "period") {
      const { period, targetCount } = signal.model.target;
      const bounds = dates[period];
      const entries = await ctx.db.query("signalEntries").withIndex("by_signal_effective_at", q => q.eq("signalId", signal._id).gte("effectiveAt", bounds.startAt).lt("effectiveAt", bounds.endAt)).take(201);
      if (entries.length > 200) truncated = true;
      const completedCount = entries.slice(0, 200).filter(entry => entry.userId === userId && entry.operation.type === "activity.occurred").length;
      progress = { period, ...bounds, targetCount, completedCount, remainingCount: Math.max(0, targetCount - completedCount) };
    }
    const evaluation = evaluateSignal(signal.model, now, 86400_000, progress);
    return { signal, evaluation, count: progress?.completedCount ?? (evaluation.isComplete ? 1 : 0) };
  }));
  const signalMap = new Map(evaluated.map(item => [String(item.signal._id), item]));
  const cardMap = new Map(scorecards.slice(0, 30).map(card => [String(card._id), card]));
  const memo = new Map<string, ScorecardEvaluation>();
  function cardEvaluation(id: string, visiting = new Set<string>()): ScorecardEvaluation {
    const cached = memo.get(id);
    if (cached) return cached;
    const card = cardMap.get(id);
    if (!card || visiting.has(id) || visiting.size >= 10) { truncated = true; return { ratio: 0, isComplete: false, count: 0, optionalDoneCount: 0 }; }
    const next = new Set([...visiting, id]);
    if (card.members.length > 60) truncated = true;
    const members = card.members.slice(0, 60).map(member => {
      if (member.type === "scorecard") {
        const evaluatedCard = cardEvaluation(member.scorecardId, next);
        return { role: member.role, ratio: evaluatedCard.ratio, count: evaluatedCard.count };
      }
      const item = signalMap.get(member.signalId);
      if (!item) truncated = true;
      return { role: member.role, ratio: item?.evaluation.ratio ?? 0, count: item?.count ?? 0 };
    });
    const result = evaluateScorecard(members, card.optionalQuota, card.targetCount);
    memo.set(id, result);
    return result;
  }
  const nestedIds = new Set(scorecards.flatMap(card => card.members.filter(m => m.type === "scorecard").map(m => m.scorecardId)));
  const cardItems = scorecards.slice(0, 30).filter(card => !nestedIds.has(card._id)).map(card => ({ id: card._id, name: summary(card.name), ...cardEvaluation(card._id), ...(card.targetCount ? { target: card.targetCount } : {}) }));
  const attentionRank = { due: 0, soon: 1, unknown: 2, ok: 3 };
  return taskyPayloadSchema.parse({
    localDate: dates.localDate, tasks: selected,
    captures: captures.slice(0, LIMITS.captures).map(capture => ({ id: capture._id, text: summary(capture.text), createdAt: Math.floor(capture._creationTime) })),
    signals: evaluated.filter(item => item.evaluation.attention !== "ok").sort((a, b) => attentionRank[a.evaluation.attention] - attentionRank[b.evaluation.attention] || a.signal.name.localeCompare(b.signal.name)).slice(0, LIMITS.signals).map(({ signal, evaluation }) => ({ id: signal._id, name: summary(signal.name), kind: signal.model.kind, attention: evaluation.attention, reason: summary(evaluation.reason), ratio: evaluation.ratio, isComplete: evaluation.isComplete })),
    scorecards: cardItems.sort((a, b) => Number(a.isComplete) - Number(b.isComplete) || a.name.localeCompare(b.name)).slice(0, LIMITS.scorecards).map(card => ({ id: card.id, name: card.name, ratio: card.ratio, isComplete: card.isComplete, count: card.count, ...(card.target ? { target: card.target } : {}) })),
    counts: { active: tasks.length, overdue: tasks.filter(task => due(task.dueDate) === "overdue").length, dueToday: tasks.filter(task => due(task.dueDate) === "today").length, captures: Math.min(200, captures.length) }, truncated,
  });
}
