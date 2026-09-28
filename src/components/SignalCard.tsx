"use client";

import Link from "next/link";
import {
  signalPrimaryText,
  signalSecondaryText,
  type SignalDashboardItem,
} from "@/lib/signalDisplay";

const ATTENTION_STYLES: Record<
  SignalDashboardItem["evaluation"]["attention"],
  { dot: string; label: string; badge: string }
> = {
  due: {
    dot: "bg-amber-500",
    label: "Due",
    badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  soon: {
    dot: "bg-blue-500",
    label: "Soon",
    badge: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  unknown: {
    dot: "bg-slate-400",
    label: "Idle",
    badge: "bg-slate-500/10 text-(--muted)",
  },
  ok: {
    dot: "bg-emerald-500",
    label: "On track",
    badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
};

export function SignalCard({
  signal,
  now,
  compact = false,
  onInspect,
}: {
  signal: SignalDashboardItem;
  now: number;
  compact?: boolean;
  onInspect?: () => void;
}) {
  const attention = ATTENTION_STYLES[signal.evaluation.attention];

  return (
    <article
      role={onInspect ? "button" : undefined}
      tabIndex={onInspect ? 0 : undefined}
      onClick={onInspect}
      onKeyDown={(event) => {
        if (
          onInspect &&
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          onInspect();
        }
      }}
      className={`bg-(--card-bg) border border-(--card-border) rounded-xl transition-colors hover:border-(--accent)/30 ${
        onInspect
          ? "cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/40"
          : ""
      } ${
        compact ? "p-4" : "p-5"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${attention.dot}`}
              aria-hidden="true"
            />
            <h3 className="font-semibold text-foreground truncate">
              {signal.name}
            </h3>
          </div>
          <p className="mt-1.5 text-sm text-(--muted) tabular-nums">
            {signalPrimaryText(signal, now)}
            <span className="mx-1.5 text-(--card-border)">·</span>
            {signalSecondaryText(signal, now)}
          </p>
        </div>
        <span
          className={`px-2 py-1 rounded-full text-xs font-medium shrink-0 ${attention.badge}`}
        >
          {attention.label}
        </span>
      </div>

      {!compact && (signal.tags.length > 0 || signal.scorecards.length > 0) ? (
        <div className="mt-4 pt-4 border-t border-(--card-border) flex flex-wrap items-center gap-2">
          {signal.tags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
              style={{
                backgroundColor: tag.color
                  ? `${tag.color}20`
                  : "var(--accent-subtle)",
                color: tag.color || "var(--accent)",
              }}
            >
              {tag.name}
            </span>
          ))}
          {signal.scorecards.map((scorecard) => (
            <Link
              key={scorecard.id}
              href={`/scorecards?expanded=${scorecard.id}`}
              onClick={(event) => event.stopPropagation()}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-(--muted) bg-(--card-border)"
            >
              <span aria-hidden="true">◎</span>
              {scorecard.name}
              {scorecard.role === "optional" ? " · optional" : ""}
            </Link>
          ))}
        </div>
      ) : null}
    </article>
  );
}
