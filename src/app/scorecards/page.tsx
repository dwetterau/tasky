"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  leftoverSignals,
  memberContributionCount,
  scorecardHeadline,
  SIGNAL_SOON_WINDOW_MS,
  type ScorecardItem,
  type SignalDashboardItem,
  useSignalClock,
} from "@/lib/signalDisplay";
import { useCachedConvexQuery } from "@/lib/useCachedConvexQuery";

function formatPercent(ratio: number): string {
  return `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
}

function memberKey(member: ScorecardItem["members"][number]): string {
  return member.type === "scorecard" ? member.scorecardId : member.signalId;
}

function ScorecardCard({
  scorecard,
  expanded,
  onToggle,
}: {
  scorecard: ScorecardItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const ratio = Math.min(1, Math.max(0, scorecard.evaluation.ratio));
  const counted = scorecard.targetCount !== undefined;
  const visibleMembers = counted
    ? scorecard.members
    : scorecard.members.filter((member) => member.role === "required");
  const completedMembers = visibleMembers.filter((member) =>
    counted
      ? memberContributionCount(member) > 0
      : member.evaluation.isComplete,
  ).length;

  return (
    <article className="bg-(--card-bg) border border-(--card-border) rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full p-5 text-left hover:bg-(--accent)/3 transition-colors"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold truncate">
                {scorecard.name}
              </h2>
              {scorecard.evaluation.isComplete ? (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  Complete
                </span>
              ) : scorecard.evaluation.attention === "due" ? (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-600 dark:text-red-400">
                  Due
                </span>
              ) : scorecard.evaluation.attention === "soon" ? (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  Soon
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-(--muted)">
              {scorecardHeadline(scorecard)}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-sm font-semibold tabular-nums text-(--muted)">
              {formatPercent(ratio)}
            </span>
            <svg
              className={`w-4 h-4 text-(--muted) transition-transform ${
                expanded ? "rotate-180" : ""
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="m19 9-7 7-7-7"
              />
            </svg>
          </div>
        </div>

        <div className="mt-4 h-2 rounded-full bg-(--card-border) overflow-hidden">
          <div
            className={`h-full rounded-full ${
              scorecard.evaluation.isComplete
                ? "bg-emerald-500"
                : "bg-accent"
            }`}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>

        <div className="mt-3 flex items-center justify-between gap-4">
          <span className="text-xs text-(--muted)">
            {completedMembers} of {visibleMembers.length} contributing
          </span>
          <div className="flex flex-wrap justify-end gap-1.5">
            {scorecard.tags.map((tag) => (
              <span
                key={tag.id}
                className="px-2 py-0.5 rounded-full text-xs font-medium"
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
          </div>
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-(--card-border)">
          {scorecard.members.map((member, index) => {
            const contribution = memberContributionCount(member);
            const complete = member.evaluation.isComplete;
            return (
              <div
                key={memberKey(member)}
                className={`px-5 py-3 flex items-center justify-between gap-4 ${
                  index > 0 ? "border-t border-(--card-border)" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        complete
                          ? "bg-emerald-500"
                          : member.role === "required"
                            ? "bg-amber-500"
                            : "bg-slate-400"
                      }`}
                    />
                    <span className="text-sm font-medium truncate">
                      {member.name}
                    </span>
                    {member.type === "scorecard" ? (
                      <span className="text-xs text-(--muted)">Scorecard</span>
                    ) : null}
                  </div>
                  <p className="mt-1 pl-4 text-xs text-(--muted)">
                    {member.evaluation.reason}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {contribution > 0 ? (
                    <span className="text-xs tabular-nums text-(--muted)">
                      {contribution}
                    </span>
                  ) : null}
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs ${
                      member.role === "required"
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "bg-slate-500/10 text-(--muted)"
                    }`}
                  >
                    {member.role}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-32">
      <div className="flex items-center gap-3 text-(--muted)">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <span>Loading scorecards...</span>
      </div>
    </div>
  );
}

function ScorecardsContent({ cacheScope }: { cacheScope: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const now = useSignalClock();
  const queryNow = getSignalQueryTime(now);
  const periodBounds = useMemo(
    () => getSignalPeriodBounds(queryNow),
    [queryNow],
  );
  const [searchText, setSearchText] = useState("");
  const [selectedSignal, setSelectedSignal] =
    useState<SignalDashboardItem | null>(null);
  const { allTags, selectedTag, selectedTagId, handleTagChange } =
    usePageTagFilter();
  const expandedScorecardId = searchParams.get("expanded");

  const baseQueryArgs = {
    now: queryNow,
    soonWindowMs: SIGNAL_SOON_WINDOW_MS,
    periodBounds,
  };
  const queryArgs = {
    ...baseQueryArgs,
    tagId: selectedTagId ?? undefined,
  };
  const scorecards = useCachedConvexQuery(
    api.scorecards.list,
    queryArgs,
    `${cacheScope}:scorecards:${selectedTagId ?? "all"}`,
  );
  const signals = useCachedConvexQuery(
    api.signals.listDashboard,
    queryArgs,
    `${cacheScope}:signals:${selectedTagId ?? "all"}`,
  );
  const scorecardsForExpansion = useCachedConvexQuery(
    api.scorecards.list,
    expandedScorecardId ? baseQueryArgs : "skip",
    `${cacheScope}:scorecards:all`,
  );

  const matchingScorecards = useMemo(() => {
    if (!scorecards) return undefined;
    const normalizedSearch = searchText.trim().toLocaleLowerCase();
    const matching = normalizedSearch
      ? scorecards.filter((scorecard) =>
          scorecard.name.toLocaleLowerCase().includes(normalizedSearch),
        )
      : [...scorecards];
    const expandedScorecard = scorecardsForExpansion?.find(
      (scorecard) => scorecard.id === expandedScorecardId,
    );
    if (
      expandedScorecard &&
      !matching.some((scorecard) => scorecard.id === expandedScorecard.id)
    ) {
      matching.unshift(expandedScorecard);
    }
    return matching;
  }, [
    expandedScorecardId,
    scorecards,
    scorecardsForExpansion,
    searchText,
  ]);

  const leftovers = useMemo(
    () =>
      scorecards && signals
        ? leftoverSignals(signals, scorecards)
        : undefined,
    [scorecards, signals],
  );
  const hasFilters = selectedTagId !== null || searchText.trim() !== "";

  const clearFilters = () => {
    setSearchText("");
    handleTagChange(null);
  };

  const toggleScorecard = (scorecardId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (expandedScorecardId === scorecardId) {
      params.delete("expanded");
    } else {
      params.set("expanded", scorecardId);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="pt-20 pb-12 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto">
        <div className="flex flex-col gap-5 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Scorecards</h1>
            <p className="mt-1 text-sm text-(--muted)">
              Roll signals and nested scorecards into daily or weekly goals.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
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
                placeholder="Search scorecards..."
                className="w-full h-[38px] pl-10 pr-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm"
              />
            </div>
            <SearchTagSelector
              selectedTag={selectedTag}
              onTagChange={handleTagChange}
              allTags={allTags}
              allowNoTag={false}
            />
          </div>

          <div className="flex items-center justify-between text-sm">
            <p className="text-(--muted)">
              {matchingScorecards === undefined
                ? "Loading..."
                : `${matchingScorecards.length} scorecard${
                    matchingScorecards.length === 1 ? "" : "s"
                  }`}
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

        {matchingScorecards === undefined || leftovers === undefined ? (
          <LoadingState />
        ) : matchingScorecards.length === 0 && leftovers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-28 text-center">
            <div className="w-16 h-16 rounded-2xl bg-(--card-bg) border border-(--card-border) flex items-center justify-center mb-5">
              <span className="text-3xl text-(--muted)" aria-hidden="true">
                ◎
              </span>
            </div>
            <p className="text-lg font-medium">No matching scorecards</p>
            <p className="mt-1 text-sm text-(--muted)">
              {hasFilters
                ? "Try adjusting the name or tag filter."
                : "Create scorecards in the Tasky mobile app or through MCP."}
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {matchingScorecards.length > 0 ? (
              <section className="grid grid-cols-1 gap-4">
                {matchingScorecards.map((scorecard) => (
                  <ScorecardCard
                    key={scorecard.id}
                    scorecard={scorecard}
                    expanded={expandedScorecardId === scorecard.id}
                    onToggle={() => toggleScorecard(scorecard.id)}
                  />
                ))}
              </section>
            ) : null}

            {leftovers.length > 0 ? (
              <section>
                <div className="mb-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-(--muted)">
                    Leftovers
                  </h2>
                  <p className="mt-1 text-xs text-(--muted)">
                    Signals in this tag scope that are not on a scorecard.
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {leftovers.map((signal) => (
                    <SignalCard
                      key={signal.id}
                      signal={signal}
                      now={now}
                      compact
                      onInspect={() => setSelectedSignal(signal)}
                    />
                  ))}
                </div>
              </section>
            ) : null}
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

export default function ScorecardsPage() {
  const { session, isPending } = useAuthSession();

  if (isPending) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return session ? (
    <ScorecardsContent cacheScope={session.user.id} />
  ) : (
    <SignIn />
  );
}
