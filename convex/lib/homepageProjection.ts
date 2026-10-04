import type { MutationCtx } from "../_generated/server";
import {
  calendar,
  LIMITS,
  localDateSchema,
  summary,
  taskyPayloadSchema,
  type TaskyPayload,
} from "../../packages/home-feed/src/index";
import { evaluateSignal } from "./signalStatus";
import {
  evaluateScorecard,
  withScorecardAttention,
  type ScorecardEvaluation,
} from "./scorecardStatus";
import { getActivityPeriodProgress } from "./recurrenceData";
import { calendarProgress, calendarWindow } from "./recurrence";

const statuses = [
  "not_started",
  "in_progress",
  "agent_running",
  "blocked",
] as const;

/** One mutation snapshot, bounded indexed reads, no public/user-provided auth context. */
export async function projectHomepage(
  ctx: MutationCtx,
  userId: string,
  timezone: string,
  now: number,
): Promise<TaskyPayload> {
  const dates = calendar(now, timezone);
  const [taskGroups, dueTaskGroups, captures, signals, scorecards] =
    await Promise.all([
      Promise.all(
        statuses.map((status) =>
          ctx.db
            .query("tasks")
            .withIndex("by_user_status", (q) =>
              q.eq("userId", userId).eq("status", status),
            )
            .take(201),
        ),
      ),
      Promise.all(
        statuses.map((status) =>
          ctx.db
            .query("tasks")
            .withIndex("by_user_status_due_date", (q) =>
              q
                .eq("userId", userId)
                .eq("status", status)
                .eq("dueDate", dates.localDate),
            )
            .take(201),
        ),
      ),
      ctx.db
        .query("captures")
        .withIndex("by_user_completed", (q) =>
          q.eq("userId", userId).eq("completed", false),
        )
        .take(201),
      ctx.db
        .query("signals")
        .withIndex("by_user_archived", (q) =>
          q.eq("userId", userId).eq("archivedAt", undefined),
        )
        .take(61),
      ctx.db
        .query("scorecards")
        .withIndex("by_user_archived", (q) =>
          q.eq("userId", userId).eq("archivedAt", undefined),
        )
        .take(31),
    ]);
  let truncated =
    taskGroups.some((group) => group.length > 200) ||
    dueTaskGroups.some((group) => group.length > 200) ||
    captures.length > 200 ||
    signals.length > 60 ||
    scorecards.length > 30;
  const activeTasks = taskGroups
    .flatMap((group) => group.slice(0, 200))
    .map((task) => ({
      ...task,
      dueDate: localDateSchema.safeParse(task.dueDate).data,
    }));
  const dueTasks = dueTaskGroups.flatMap((group) => group.slice(0, 200));
  const evaluated = await Promise.all(
    signals.slice(0, 60).map(async (signal) => {
      const progress = await getActivityPeriodProgress(
        ctx,
        signal,
        now,
        timezone,
      );
      const evaluation = evaluateSignal(signal.model, now, 86400_000, progress);
      return {
        signal,
        evaluation,
        count: progress?.completedCount ?? (evaluation.isComplete ? 1 : 0),
      };
    }),
  );
  const signalMap = new Map(
    evaluated.map((item) => [String(item.signal._id), item]),
  );
  const cardMap = new Map(
    scorecards.slice(0, 30).map((card) => [String(card._id), card]),
  );
  const memo = new Map<string, ScorecardEvaluation>();
  function cardEvaluation(
    id: string,
    visiting = new Set<string>(),
  ): ScorecardEvaluation {
    const cached = memo.get(id);
    if (cached) return cached;
    const card = cardMap.get(id);
    if (!card || visiting.has(id) || visiting.size >= 10) {
      truncated = true;
      return { ratio: 0, isComplete: false, count: 0, optionalDoneCount: 0 };
    }
    const next = new Set([...visiting, id]);
    if (card.members.length > 60) truncated = true;
    const members = card.members.slice(0, 60).map((member) => {
      if (member.type === "scorecard") {
        const evaluatedCard = cardEvaluation(member.scorecardId, next);
        return {
          role: member.role,
          ratio: evaluatedCard.ratio,
          count: evaluatedCard.count,
        };
      }
      const item = signalMap.get(member.signalId);
      if (!item) truncated = true;
      return {
        role: member.role,
        ratio: item?.evaluation.ratio ?? 0,
        count: item?.count ?? 0,
      };
    });
    const baseResult = evaluateScorecard(
      members,
      card.optionalQuota,
      card.targetCount,
    );
    const requiredMembers = members.filter(
      (member) => member.role === "required",
    );
    const pacingTarget =
      card.targetCount ??
      Math.max(1, requiredMembers.length + card.optionalQuota);
    const pacingCompleted =
      card.targetCount !== undefined
        ? baseResult.count
        : requiredMembers.filter((member) => member.ratio >= 1).length +
          Math.min(card.optionalQuota, baseResult.optionalDoneCount);
    const progress =
      card.schedule === undefined
        ? undefined
        : calendarProgress(
            calendarWindow(card.schedule, pacingTarget, now, timezone),
            pacingCompleted,
            pacingTarget,
            now,
          );
    const result = withScorecardAttention(
      baseResult,
      now,
      86400_000,
      progress,
    );
    memo.set(id, result);
    return result;
  }
  const nestedIds = new Set(
    scorecards.flatMap((card) =>
      card.members
        .filter((m) => m.type === "scorecard")
        .map((m) => m.scorecardId),
    ),
  );
  const cardItems = scorecards
    .slice(0, 30)
    .filter((card) => !nestedIds.has(card._id))
    .map((card) => ({
      id: card._id,
      name: summary(card.name),
      ...cardEvaluation(card._id),
      ...(card.targetCount ? { target: card.targetCount } : {}),
    }));
  const dueSignals = evaluated
    .filter(
      (item) =>
        item.evaluation.attention === "due" && item.signal.name !== "Weight",
    )
    .sort(
      (a, b) =>
        (a.evaluation.actionAt ?? Number.POSITIVE_INFINITY) -
          (b.evaluation.actionAt ?? Number.POSITIVE_INFINITY) ||
        a.signal.name.localeCompare(b.signal.name),
    )
    .slice(0, 3);
  const tagIds = [
    ...new Set(dueSignals.flatMap(({ signal }) => signal.tagIds.slice(0, 3))),
  ];
  const tags = await Promise.all(tagIds.map((id) => ctx.db.get(id)));
  const tagNames = new Map(
    tags.flatMap((tag) =>
      tag?.userId === userId ? [[tag._id, summary(tag.name, 60)] as const] : [],
    ),
  );
  return taskyPayloadSchema.parse({
    localDate: dates.localDate,
    tasks: dueTasks
      .sort(
        (a, b) =>
          ({ urgent: 0, high: 1, medium: 2, low: 3, triage: 4 })[a.priority] -
            ({ urgent: 0, high: 1, medium: 2, low: 3, triage: 4 })[b.priority] ||
          a.content.localeCompare(b.content),
      )
      .slice(0, LIMITS.tasks)
      .map((task) => ({
        id: task._id,
        title: summary(task.content),
        status: task.status,
        priority: task.priority,
        dueDate: dates.localDate,
        due: "today" as const,
        labels: [],
      })),
    captures: [],
    signals: dueSignals.map(({ signal, evaluation }) => ({
      id: signal._id,
      name: summary(signal.name),
      kind: signal.model.kind,
      attention: evaluation.attention,
      reason: summary(evaluation.reason),
      ratio: evaluation.ratio,
      isComplete: evaluation.isComplete,
      labels: signal.tagIds.slice(0, 3).flatMap((id) => {
        const name = tagNames.get(id);
        return name ? [name] : [];
      }),
    })),
    scorecards: cardItems
      .sort(
        (a, b) =>
          Number(a.isComplete) - Number(b.isComplete) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, LIMITS.scorecards)
      .map((card) => ({
        id: card.id,
        name: card.name,
        ratio: card.ratio,
        isComplete: card.isComplete,
        count: card.count,
        ...(card.target ? { target: card.target } : {}),
      })),
    counts: {
      active: activeTasks.length,
      overdue: activeTasks.filter(
        (task) => task.dueDate && task.dueDate < dates.localDate,
      ).length,
      dueToday: dueTasks.length,
      captures: Math.min(200, captures.length),
    },
    truncated,
  });
}
