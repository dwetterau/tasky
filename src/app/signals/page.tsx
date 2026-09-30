"use client";

import { useMemo, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Navigation } from "@/components/Navigation";
import { SearchTagSelector } from "@/components/TagSelector";
import { SignalCard } from "@/components/SignalCard";
import { SignalInspectorModal } from "@/components/SignalInspectorModal";
import { SignIn } from "@/components/SignIn";
import { useAuthSession } from "@/lib/useAuthSession";
import { usePageTagFilter } from "@/lib/usePageTagFilter";
import {
  getSignalPeriodBounds,
  getSignalQueryTime,
  groupSignalsByFirstTag,
  loggedTodaySignals,
  SIGNAL_SOON_WINDOW_MS,
  type SignalDashboardItem,
  useSignalClock,
} from "@/lib/signalDisplay";
import { useCachedConvexQuery } from "@/lib/useCachedConvexQuery";

type SignalKind = "all" | "activity" | "inventory";
type SignalView = "status" | "today";
type SignalAttention = SignalDashboardItem["evaluation"]["attention"];

const ATTENTION_ORDER: SignalAttention[] = ["due", "soon", "unknown", "ok"];
const ATTENTION_LABELS: Record<SignalAttention, string> = {
  due: "Due",
  soon: "Coming up",
  unknown: "Idle",
  ok: "On track",
};
const ATTENTION_STYLES: Record<
  SignalAttention,
  { dot: string; count: string }
> = {
  due: {
    dot: "bg-amber-500",
    count: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  soon: {
    dot: "bg-blue-500",
    count: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  unknown: {
    dot: "bg-slate-400",
    count: "bg-slate-500/10 text-(--muted)",
  },
  ok: {
    dot: "bg-emerald-500",
    count: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
};

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-32">
      <div className="flex items-center gap-3 text-(--muted)">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <span>Loading signals...</span>
      </div>
    </div>
  );
}

function SignalsContent({ cacheScope }: { cacheScope: string }) {
  const now = useSignalClock();
  const queryNow = getSignalQueryTime(now);
  const periodBounds = useMemo(
    () => getSignalPeriodBounds(queryNow),
    [queryNow],
  );
  const [kind, setKind] = useState<SignalKind>("all");
  const [view, setView] = useState<SignalView>("status");
  const [searchText, setSearchText] = useState("");
  const [selectedSignal, setSelectedSignal] =
    useState<SignalDashboardItem | null>(null);
  const { allTagsRaw, allTags, selectedTag, selectedTagId, handleTagChange } =
    usePageTagFilter();

  const signals = useCachedConvexQuery(
    api.signals.listDashboard,
    {
      now: queryNow,
      soonWindowMs: SIGNAL_SOON_WINDOW_MS,
      periodBounds,
      kind: kind === "all" ? undefined : kind,
      tagId: selectedTagId ?? undefined,
    },
    `${cacheScope}:signals:${kind}:${selectedTagId ?? "all"}`,
  );

  const matchingSignals = useMemo(() => {
    if (!signals) return undefined;
    const normalizedSearch = searchText.trim().toLocaleLowerCase();
    if (!normalizedSearch) return signals;
    return signals.filter((signal) =>
      signal.name.toLocaleLowerCase().includes(normalizedSearch),
    );
  }, [searchText, signals]);

  const todaySignals = useMemo(
    () => loggedTodaySignals(matchingSignals ?? [], periodBounds.day),
    [matchingSignals, periodBounds.day],
  );

  const groups = useMemo(
    () =>
      ATTENTION_ORDER.map((attention) => ({
        attention,
        signals:
          matchingSignals?.filter(
            (signal) => signal.evaluation.attention === attention,
          ) ?? [],
      }))
        .filter((group) => group.signals.length > 0)
        .map((group) => ({
          ...group,
          tagGroups: groupSignalsByFirstTag(group.signals, allTagsRaw),
        })),
    [allTagsRaw, matchingSignals],
  );

  const visibleCount =
    view === "today" ? todaySignals.length : (matchingSignals?.length ?? 0);
  const hasFilters =
    kind !== "all" || selectedTagId !== null || searchText.trim() !== "";

  const clearFilters = () => {
    setKind("all");
    setSearchText("");
    handleTagChange(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="pt-20 pb-12 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
        <div className="flex flex-col gap-5 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Signals</h1>
            <p className="mt-1 text-sm text-(--muted)">
              Recurring activities and inventory levels, ordered by attention.
            </p>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div
              className="inline-flex self-start items-center bg-(--card-bg) border border-(--card-border) rounded-lg p-1"
              role="tablist"
              aria-label="Signal view"
            >
              {(["status", "today"] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => setView(option)}
                  role="tab"
                  aria-selected={view === option}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    view === option
                      ? "bg-(--accent)/15 text-accent"
                      : "text-(--muted) hover:text-foreground"
                  }`}
                >
                  {option === "status" ? "Status" : `Today (${todaySignals.length})`}
                </button>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative min-w-56">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-(--muted)"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="m21 21-4.35-4.35m1.35-5.65a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"
                  />
                </svg>
                <input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Search signals..."
                  className="w-full h-[38px] pl-10 pr-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm"
                />
              </div>
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as SignalKind)}
                aria-label="Filter by signal type"
                className="h-[38px] px-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent text-sm"
              >
                <option value="all">All types</option>
                <option value="activity">Activities</option>
                <option value="inventory">Inventory</option>
              </select>
              <SearchTagSelector
                selectedTag={selectedTag}
                onTagChange={handleTagChange}
                allTags={allTags}
                allowNoTag={false}
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <p className="text-(--muted)">
              {matchingSignals === undefined
                ? "Loading..."
                : `${visibleCount} signal${visibleCount === 1 ? "" : "s"}`}
            </p>
            {hasFilters ? (
              <button
                onClick={clearFilters}
                className="text-accent hover:underline"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        </div>

        {matchingSignals === undefined ? (
          <LoadingState />
        ) : visibleCount === 0 ? (
          <div className="flex flex-col items-center justify-center py-28 text-center">
            <div className="w-16 h-16 rounded-2xl bg-(--card-bg) border border-(--card-border) flex items-center justify-center mb-5">
              <span className="text-3xl text-(--muted)" aria-hidden="true">
                ◉
              </span>
            </div>
            <p className="text-lg font-medium">
              {view === "today" ? "Nothing logged today" : "No matching signals"}
            </p>
            <p className="mt-1 text-sm text-(--muted)">
              {hasFilters
                ? "Try adjusting the name, type, or tag filter."
                : "Create signals in the Tasky mobile app or through MCP."}
            </p>
          </div>
        ) : view === "today" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {todaySignals.map((signal) => (
              <SignalCard
                key={signal.id}
                signal={signal}
                now={now}
                onInspect={() => setSelectedSignal(signal)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-10">
            {groups.map((group) => {
              const attentionStyle = ATTENTION_STYLES[group.attention];
              return (
                <section
                  key={group.attention}
                  aria-labelledby={`signals-${group.attention}`}
                >
                  <div className="flex items-center gap-2.5 mb-4">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${attentionStyle.dot}`}
                      aria-hidden="true"
                    />
                    <h2
                      id={`signals-${group.attention}`}
                      className="text-base font-semibold text-foreground"
                    >
                      {ATTENTION_LABELS[group.attention]}
                    </h2>
                    <span
                      className={`ml-auto min-w-7 px-2 py-0.5 rounded-full text-center text-xs font-semibold tabular-nums ${attentionStyle.count}`}
                    >
                      {group.signals.length}
                    </span>
                  </div>

                  <div className="space-y-6 border-l border-(--card-border) pl-3 sm:pl-5">
                    {group.tagGroups.map((tagGroup) => (
                      <div key={tagGroup.key}>
                        <div className="flex items-center gap-2 mb-2.5">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{
                              backgroundColor:
                                tagGroup.tag?.color ?? "var(--muted)",
                            }}
                            aria-hidden="true"
                          />
                          <h3 className="text-sm font-medium text-(--muted)">
                            {tagGroup.label}
                          </h3>
                          <span className="text-xs text-(--muted) tabular-nums">
                            {tagGroup.signals.length}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                          {tagGroup.signals.map((signal) => (
                            <SignalCard
                              key={signal.id}
                              signal={signal}
                              now={now}
                              onInspect={() => setSelectedSignal(signal)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
      {selectedSignal ? (
        <SignalInspectorModal
          signal={selectedSignal}
          now={now}
          cacheScope={cacheScope}
          onClose={() => setSelectedSignal(null)}
        />
      ) : null}
    </div>
  );
}

export default function SignalsPage() {
  const { session, isPending } = useAuthSession();

  if (isPending) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return session ? <SignalsContent cacheScope={session.user.id} /> : <SignIn />;
}
