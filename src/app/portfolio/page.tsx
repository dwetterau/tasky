"use client";

import { useAction, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { ResponsiveContainer, Treemap } from "recharts";
import type { TreemapNode } from "recharts/types/chart/Treemap";
import { api } from "../../../convex/_generated/api";
import { Navigation } from "@/components/Navigation";
import { SignIn } from "@/components/SignIn";
import { applyLiveQuotes, isSessionLive } from "@/lib/portfolioLive";
import { colorForReturn, RETURN_LEGEND } from "@/lib/portfolioMapColors";
import { useLivePortfolio } from "@/lib/useLivePortfolio";
import { useAuthSession } from "@/lib/useAuthSession";
import { ReturnBars, type ChartDatum } from "./ReturnBars";
import { IntradayChart } from "./IntradayChart";
import { ValueOverTime } from "./ValueOverTime";

type Portfolio = FunctionReturnType<typeof api.portfolios.list>[number];
type Snapshot = FunctionReturnType<typeof api.portfolio.getSnapshot>;
type History = FunctionReturnType<typeof api.portfolio.getSnapshotHistory>;
type SnapshotArgs = FunctionArgs<typeof api.portfolio.getSnapshot>;
type HistoryArgs = FunctionArgs<typeof api.portfolio.getSnapshotHistory>;
type ScopeMode = "all" | "single" | "custom";
type Horizon = "1d" | "1w" | "1m" | "3m" | "ytd" | "total";
type ChartView = "map" | "bars" | "time";

const CHART_VIEWS: Array<{ value: ChartView; label: string }> = [
  { value: "map", label: "Map" },
  { value: "bars", label: "Bars" },
  { value: "time", label: "Over time" },
];

const PILL =
  "rounded-md px-2 py-0.5 text-xs font-medium transition-colors";
const PILL_ON = "bg-(--accent)/15 text-accent";
const PILL_OFF = "text-(--muted) hover:bg-(--hover) hover:text-foreground";
const STAT_LABEL = "text-[11px] uppercase tracking-wide text-(--muted)";

const HORIZONS: Array<{ value: Horizon; label: string }> = [
  { value: "1d", label: "1D" },
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "ytd", label: "YTD" },
  { value: "total", label: "Total" },
];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatSharePrice(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

function formatPercent(value: number | null): string {
  if (value === null) return "No baseline";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatSnapshotDateTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatCompactSignedCurrency(value: number): string {
  const absoluteValue = Math.abs(value);
  const maximumFractionDigits =
    absoluteValue < 10 ? 2 : absoluteValue < 100 ? 1 : 0;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: absoluteValue >= 1_000 ? "compact" : "standard",
    maximumFractionDigits,
  }).format(absoluteValue);
  return `${value >= 0 ? "+" : "-"}${formatted}`;
}

function formatSignedCurrency(value: number): string {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
  }).format(Math.abs(value));
  return `${value >= 0 ? "+" : "-"}${formatted}`;
}

function formatSignedSharePrice(value: number): string {
  return `${value >= 0 ? "+" : "-"}${formatSharePrice(Math.abs(value))}`;
}

function formatPointChange(value: number): string {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(2)} pp`;
}

function toneClass(value: number | null): string {
  if (value === null || value === 0) return "text-(--muted)";
  return value > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-600 dark:text-red-400";
}

type HoldingDetail = {
  id: string;
  ticker: string;
  companyName: string;
  value: number;
  sharePrice: number | null;
  returnPercent: number | null;
  returnAmount: number | null;
  perShareChange: number | null;
  allocation: number | null;
  allocationChange: number | null;
};

function withChange(base: string, change: string | null): string {
  return change === null ? base : `${base} (${change})`;
}

function formatHoldingTitle(detail: HoldingDetail): string {
  return [
    detail.companyName
      ? `${detail.ticker} · ${detail.companyName}`
      : detail.ticker,
    `Return: ${formatPercent(detail.returnPercent)}`,
    `Value: ${withChange(
      formatCurrency(detail.value),
      detail.returnAmount === null
        ? null
        : formatSignedCurrency(detail.returnAmount),
    )}`,
    `Per share: ${withChange(
      formatSharePrice(detail.sharePrice),
      detail.perShareChange === null
        ? null
        : formatSignedSharePrice(detail.perShareChange),
    )}`,
    `Allocation: ${withChange(
      detail.allocation === null ? "—" : `${detail.allocation.toFixed(2)}%`,
      detail.allocationChange === null
        ? null
        : formatPointChange(detail.allocationChange),
    )}`,
  ].join("\n");
}

function ValueWithChange({
  value,
  change,
  tone,
}: {
  value: string;
  change: string | null;
  tone: string;
}) {
  return (
    <p className="font-semibold tabular-nums">
      {value}
      {change === null ? null : (
        <span className={`ml-1.5 text-sm font-medium ${tone}`}>({change})</span>
      )}
    </p>
  );
}

function shiftDate(date: string, horizon: Exclude<Horizon, "1d" | "total">) {
  const shifted = new Date(`${date}T12:00:00.000Z`);
  if (horizon === "1w") shifted.setUTCDate(shifted.getUTCDate() - 7);
  if (horizon === "1m") shifted.setUTCMonth(shifted.getUTCMonth() - 1);
  if (horizon === "3m") shifted.setUTCMonth(shifted.getUTCMonth() - 3);
  if (horizon === "ytd") {
    shifted.setUTCMonth(0, 1);
  }
  return shifted.toISOString().slice(0, 10);
}

function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function PortfolioTile(node: TreemapNode) {
  if (node.depth !== 1 || node.width < 2 || node.height < 2) {
    return <g />;
  }
  const ticker = typeof node.ticker === "string" ? node.ticker : node.name;
  const returnPercent =
    typeof node.returnPercent === "number" ? node.returnPercent : null;
  const returnAmount =
    typeof node.returnAmount === "number" ? node.returnAmount : undefined;
  const fill = typeof node.fill === "string" ? node.fill : "#475569";
  const value = typeof node.value === "number" ? node.value : 0;
  const title = typeof node.title === "string" ? node.title : ticker;
  const returnLabel = formatPercent(returnPercent);
  const plainValueLabel = formatCurrency(value);
  const valueWithChangeLabel =
    returnAmount === undefined
      ? plainValueLabel
      : `${plainValueLabel} (${formatCompactSignedCurrency(returnAmount)})`;
  const returnFontSize = Math.min(
    12,
    Math.max(9, (node.width - 16) / (returnLabel.length * 0.58)),
  );
  const showTicker =
    node.width >= Math.max(42, ticker.length * 9 + 16) && node.height >= 24;
  const showReturn =
    showTicker &&
    node.width >= returnLabel.length * 5.25 + 16 &&
    node.height >= 46;
  const fitsValue = (label: string) => node.width >= label.length * 6 + 16;
  const valueLabel =
    showReturn && node.height >= 68
      ? fitsValue(valueWithChangeLabel)
        ? valueWithChangeLabel
        : fitsValue(plainValueLabel)
          ? plainValueLabel
          : null
      : null;

  return (
    <g>
      <title>{title}</title>
      <rect
        x={node.x + 0.5}
        y={node.y + 0.5}
        width={Math.max(0, node.width - 1)}
        height={Math.max(0, node.height - 1)}
        rx={3}
        fill={fill}
        stroke="var(--background)"
        strokeWidth={1}
      />
      {showTicker ? (
        <text
          x={node.x + node.width / 2}
          y={node.y + node.height / 2 - (showReturn ? 9 : 0)}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="white"
          fontSize={Math.min(18, Math.max(11, node.width / 7))}
          fontWeight={800}
          pointerEvents="none"
        >
          {ticker || "Cash"}
        </text>
      ) : null}
      {showReturn ? (
        <text
          x={node.x + node.width / 2}
          y={node.y + node.height / 2 + 12}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(255,255,255,0.92)"
          fontSize={returnFontSize}
          fontWeight={650}
          pointerEvents="none"
        >
          {returnLabel}
        </text>
      ) : null}
      {valueLabel !== null ? (
        <text
          x={node.x + node.width / 2}
          y={node.y + node.height / 2 + 29}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(255,255,255,0.72)"
          fontSize={10}
          pointerEvents="none"
        >
          {valueLabel}
        </text>
      ) : null}
    </g>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
    </div>
  );
}

function PortfolioContent() {
  const portfolios = useQuery(api.portfolios.list);
  const getSnapshot = useAction(api.portfolio.getSnapshot);
  const getHistory = useAction(api.portfolio.getSnapshotHistory);
  const syncPortfolio = useAction(api.portfolio.syncPortfolio);
  const [scopeMode, setScopeMode] = useState<ScopeMode>("all");
  const [singleId, setSingleId] = useState<string | null>(null);
  const [customIds, setCustomIds] = useState<Set<string>>(() => new Set());
  const [horizon, setHorizon] = useState<Horizon>("1d");
  const [chartView, setChartView] = useState<ChartView>("map");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<{
    success: boolean;
    text: string;
  } | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hiddenTickers, setHiddenTickers] = useState<Set<string>>(
    () => new Set(),
  );
  const [today] = useState(localToday);

  useEffect(() => {
    if (!portfolios || portfolios.length === 0) return;
    const validIds = new Set(
      portfolios.map((portfolio) => String(portfolio._id)),
    );
    setSingleId((current) =>
      current && validIds.has(current)
        ? current
        : String(
            portfolios.find((portfolio) => portfolio.isDefault)?._id ??
              portfolios[0]!._id,
          ),
    );
    setCustomIds((current) => {
      const retained = new Set([...current].filter((id) => validIds.has(id)));
      return retained.size > 0 ? retained : new Set(validIds);
    });
  }, [portfolios]);

  const selectedPortfolios = useMemo(() => {
    if (!portfolios) return [];
    if (scopeMode === "all") return portfolios;
    if (scopeMode === "single") {
      return portfolios.filter(
        (portfolio) => String(portfolio._id) === singleId,
      );
    }
    return portfolios.filter((portfolio) =>
      customIds.has(String(portfolio._id)),
    );
  }, [customIds, portfolios, scopeMode, singleId]);

  // Hidden holdings belong to the set of portfolios they were hidden in:
  // looking at a different set starts with everything shown again.
  const scopeKey = selectedPortfolios
    .map((portfolio) => String(portfolio._id))
    .sort()
    .join(",");
  const [hiddenScopeKey, setHiddenScopeKey] = useState(scopeKey);
  if (hiddenScopeKey !== scopeKey) {
    setHiddenScopeKey(scopeKey);
    // The first load goes from no portfolios to some; nothing is hidden yet.
    if (hiddenTickers.size > 0) setHiddenTickers(new Set());
  }

  const readArgs = useMemo<{
    snapshot: SnapshotArgs;
    history: HistoryArgs;
  } | null>(() => {
    if (
      !portfolios ||
      portfolios.length === 0 ||
      selectedPortfolios.length === 0
    ) {
      return null;
    }
    if (scopeMode === "all") {
      return {
        snapshot: { includePriceStatus: true, allPortfolios: true },
        history: { allPortfolios: true },
      };
    }
    if (scopeMode === "single") {
      const portfolioId = selectedPortfolios[0]!._id;
      return {
        snapshot: { includePriceStatus: true, portfolioId },
        history: { portfolioId },
      };
    }
    const portfolioIds = selectedPortfolios.map((portfolio) => portfolio._id);
    return {
      snapshot: { includePriceStatus: true, portfolioIds },
      history: { portfolioIds },
    };
  }, [portfolios, scopeMode, selectedPortfolios]);

  useEffect(() => {
    if (!readArgs) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setSnapshot(null);
    setHistory(null);
    void getSnapshot(readArgs.snapshot)
      .then((nextSnapshot) => {
        if (cancelled) return;
        setSnapshot(nextSnapshot);
        if (nextSnapshot.status !== "ok") {
          setError(nextSnapshot.message ?? "Portfolio data is unavailable.");
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load portfolio data.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    void getHistory(readArgs.history)
      .then((nextHistory) => {
        if (!cancelled) setHistory(nextHistory);
      })
      .catch(() => {
        if (!cancelled) setHistory(null);
      });
    return () => {
      cancelled = true;
    };
  }, [getHistory, getSnapshot, readArgs, refreshVersion]);

  // The 1D horizon runs on live prices; the snapshot stays as the source of
  // share counts and as the fallback when no live price is available.
  const liveTickers = useMemo(
    () =>
      snapshot?.status === "ok"
        ? snapshot.holdings.flatMap((holding) =>
            holding.ticker && holding.shares > 0 ? [holding.ticker] : [],
          )
        : [],
    [snapshot],
  );
  const liveSession = useLivePortfolio(liveTickers, horizon === "1d");
  const view = useMemo<Snapshot | null>(() => {
    if (snapshot?.status !== "ok" || !liveSession) return snapshot;
    const live = applyLiveQuotes(
      snapshot.holdings,
      liveSession,
      (snapshot.summary.latestPriceDate ?? "") >= liveSession.sessionDate,
    );
    const gainLoss = live.totalCurrentValue - snapshot.summary.totalCost;
    return {
      ...snapshot,
      holdings: live.holdings,
      summary: {
        ...snapshot.summary,
        totalCurrentValue: live.totalCurrentValue,
        gainLoss,
        gainLossPercent:
          snapshot.summary.totalCost > 0
            ? (gainLoss / snapshot.summary.totalCost) * 100
            : 0,
        dayReturnDate: liveSession.sessionDate,
        dayReturn: live.dayReturn,
        dayReturnPercent: live.dayReturnPercent,
      },
    };
  }, [liveSession, snapshot]);
  const isLive = liveSession !== null && isSessionLive(liveSession);

  const baselinePoint = useMemo(() => {
    if (
      horizon === "1d" ||
      horizon === "total" ||
      history?.status !== "ok" ||
      history.points.length === 0
    ) {
      return null;
    }
    const latestDate =
      snapshot?.summary.latestPriceDate ??
      history.points[history.points.length - 1]!.date;
    const targetDate = shiftDate(latestDate, horizon);
    // When the period starts before the first snapshot, measure from the
    // earliest one rather than silently falling back to cost basis.
    return (
      history.points.filter((point) => point.date <= targetDate).at(-1) ??
      history.points[0]!
    );
  }, [history, horizon, snapshot?.summary.latestPriceDate]);

  const holdingsWithReturns = useMemo(() => {
    if (view?.status !== "ok") return [];
    const baselineByTicker = new Map(
      baselinePoint?.holdings.map((holding) => [
        holding.ticker.trim().toUpperCase(),
        holding,
      ]) ?? [],
    );
    return view.holdings
      .filter((holding) => holding.currentValue > 0)
      .map((holding) => {
        let returnPercent: number | null;
        let returnAmount: number | null;
        let returnBasis: number | null;
        if (horizon === "1d") {
          if (holding.dayReturnPercent != null && holding.dayReturn != null) {
            returnPercent = holding.dayReturnPercent;
            returnAmount = holding.dayReturn;
            returnBasis = holding.currentValue - holding.dayReturn;
          } else {
            returnPercent = holding.gainLossPercent;
            returnAmount = holding.gainLoss;
            returnBasis = holding.costBasis;
          }
        } else if (horizon === "total") {
          returnPercent = holding.gainLossPercent;
          returnAmount = holding.gainLoss;
          returnBasis = holding.costBasis;
        } else if (!holding.ticker) {
          returnPercent = 0;
          returnAmount = 0;
          returnBasis = holding.currentValue;
        } else {
          const baseline = baselineByTicker.get(
            holding.ticker.trim().toUpperCase(),
          );
          const currentPrice =
            holding.currentPrice ??
            (holding.shares > 0 ? holding.currentValue / holding.shares : null);
          const baselinePrice =
            baseline && baseline.quantity > 0
              ? baseline.value / baseline.quantity
              : null;
          if (
            currentPrice !== null &&
            baselinePrice !== null &&
            baselinePrice > 0
          ) {
            // Apply the price move to today's shares so quantity changes are
            // not themselves counted as return and dollars match the percent.
            returnBasis = baselinePrice * holding.shares;
            returnAmount = (currentPrice - baselinePrice) * holding.shares;
            returnPercent =
              returnBasis > 0 ? (returnAmount / returnBasis) * 100 : null;
          } else {
            returnPercent = holding.gainLossPercent;
            returnAmount = holding.gainLoss;
            returnBasis = holding.costBasis;
          }
        }
        return { holding, returnPercent, returnAmount, returnBasis };
      })
      .sort(
        (a, b) =>
          b.holding.currentValue - a.holding.currentValue ||
          a.holding.ticker.localeCompare(b.holding.ticker),
      );
  }, [baselinePoint, horizon, view]);

  const holdingDetails = useMemo<HoldingDetail[]>(() => {
    const totalValue =
      view?.status === "ok" ? view.summary.totalCurrentValue : 0;
    const startTotalValue =
      totalValue -
      holdingsWithReturns.reduce(
        (sum, entry) => sum + (entry.returnAmount ?? 0),
        0,
      );
    return holdingsWithReturns.map(
      ({ holding, returnPercent, returnAmount }) => {
        const allocation =
          totalValue > 0 ? (holding.currentValue / totalValue) * 100 : null;
        const startAllocation =
          startTotalValue > 0
            ? ((holding.currentValue - (returnAmount ?? 0)) / startTotalValue) *
              100
            : null;
        return {
          id: String(holding.id),
          ticker: holding.ticker || "Cash",
          companyName: holding.companyName,
          value: holding.currentValue,
          sharePrice: holding.currentPrice,
          returnPercent,
          returnAmount,
          perShareChange:
            holding.ticker && holding.shares > 0 && returnAmount !== null
              ? returnAmount / holding.shares
              : null,
          allocation,
          allocationChange:
            allocation !== null && startAllocation !== null
              ? allocation - startAllocation
              : null,
        };
      },
    );
  }, [holdingsWithReturns, view]);

  const chartData = useMemo<ChartDatum[]>(
    () =>
      holdingDetails.map((detail) => ({
        id: detail.id,
        name: detail.ticker,
        ticker: detail.ticker,
        value: detail.value,
        returnPercent: detail.returnPercent,
        returnAmount: detail.returnAmount,
        fill: colorForReturn(detail.returnPercent),
        title: formatHoldingTitle(detail),
      })),
    [holdingDetails],
  );

  const selectedReturn = useMemo(() => {
    if (view?.status !== "ok") {
      return { percent: null, amount: null };
    }
    if (horizon === "1d") {
      return view.summary.dayReturnPercent !== null &&
        view.summary.dayReturn !== null
        ? {
            percent: view.summary.dayReturnPercent,
            amount: view.summary.dayReturn,
          }
        : {
            percent: view.summary.gainLossPercent,
            amount: view.summary.gainLoss,
          };
    }
    if (horizon === "total") {
      return {
        percent: view.summary.gainLossPercent,
        amount: view.summary.gainLoss,
      };
    }
    const included = holdingsWithReturns.filter(
      (
        entry,
      ): entry is typeof entry & {
        returnAmount: number;
        returnBasis: number;
      } => entry.returnAmount !== null && entry.returnBasis !== null,
    );
    const amount = included.reduce((sum, entry) => sum + entry.returnAmount, 0);
    const basis = included.reduce((sum, entry) => sum + entry.returnBasis, 0);
    return included.length > 0 && basis > 0
      ? {
          percent: (amount / basis) * 100,
          amount,
        }
      : {
          percent: view.summary.gainLossPercent,
          amount: view.summary.gainLoss,
        };
  }, [holdingsWithReturns, horizon, view]);

  // Without live prices a single day is not a trend, so the 1D horizon
  // falls back to charting the past week of snapshots.
  const timeWindowStart =
    horizon === "total"
      ? null
      : shiftDate(today, horizon === "1d" ? "1w" : horizon);
  const timeWindowLabel =
    horizon === "total"
      ? "all recorded snapshots"
      : horizon === "1d"
        ? liveSession
          ? "today's move since the previous close, for the total and each holding"
          : "the past week (live prices are unavailable)"
        : `snapshots since ${timeWindowStart}`;

  const activeEntry =
    holdingDetails.find((detail) => detail.id === hoveredId) ??
    holdingDetails[0];

  const selectAll = () => {
    setScopeMode("all");
    setHoveredId(null);
  };

  const selectSingle = (portfolio: Portfolio) => {
    setScopeMode("single");
    setSingleId(String(portfolio._id));
    setHoveredId(null);
  };

  const selectPortfolio = (
    event: MouseEvent<HTMLButtonElement>,
    portfolio: Portfolio,
  ) => {
    if (!event.shiftKey || !portfolios || portfolios.length < 2) {
      selectSingle(portfolio);
      return;
    }

    const id = String(portfolio._id);
    setCustomIds((current) => {
      const next =
        scopeMode === "all"
          ? new Set(portfolios.map((candidate) => String(candidate._id)))
          : scopeMode === "single" && singleId
            ? new Set([singleId])
            : new Set(current);
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setScopeMode("custom");
    setHoveredId(null);
  };

  const selectCustom = () => {
    if (scopeMode === "all" && portfolios) {
      setCustomIds(
        new Set(portfolios.map((portfolio) => String(portfolio._id))),
      );
    } else if (scopeMode === "single" && singleId) {
      setCustomIds(new Set([singleId]));
    }
    setScopeMode("custom");
    setHoveredId(null);
  };

  const toggleCustomPortfolio = (portfolio: Portfolio) => {
    const id = String(portfolio._id);
    setCustomIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const result = await syncPortfolio({});
      setSyncMessage({ success: result.success, text: result.message });
      if (result.success) setRefreshVersion((version) => version + 1);
    } catch (syncError) {
      setSyncMessage({
        success: false,
        text:
          syncError instanceof Error
            ? syncError.message
            : "Portfolio sync failed.",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  if (portfolios === undefined) return <LoadingState />;

  if (portfolios.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <main className="mx-auto max-w-4xl px-4 pb-12 pt-(--page-top-roomy) sm:px-6">
          <div className="rounded-xl border border-(--card-border) bg-(--card-bg) p-8 text-center">
            <h1 className="text-xl font-bold">No portfolios configured</h1>
            <p className="mt-2 text-sm text-(--muted)">
              Add your Airtable credentials and at least one portfolio first.
            </p>
            <a
              href="/settings"
              className="mt-5 inline-flex rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
            >
              Open settings
            </a>
          </div>
        </main>
      </div>
    );
  }

  const horizonDescription =
    horizon === "1d"
      ? isLive
        ? "Previous market close to now"
        : view?.summary.dayReturnDate
          ? `Previous market close to ${view.summary.dayReturnDate}`
          : "Previous market close"
      : horizon === "total"
        ? "Return against cost basis"
        : baselinePoint
          ? `Price return since ${baselinePoint.date}`
          : "No snapshot baseline for this period";

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="mx-auto max-w-[1800px] px-3 pb-10 pt-(--page-top) sm:px-5">
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-base font-semibold">Portfolio</h1>
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={selectAll}
              className={`${PILL} ${scopeMode === "all" ? PILL_ON : PILL_OFF}`}
            >
              All
            </button>
            {portfolios.map((portfolio) => {
              const id = String(portfolio._id);
              const selected =
                (scopeMode === "single" && singleId === id) ||
                (scopeMode === "custom" && customIds.has(id));
              return (
                <button
                  key={portfolio._id}
                  type="button"
                  onClick={(event) => selectPortfolio(event, portfolio)}
                  aria-pressed={selected}
                  title="Click to view only this portfolio; Shift-click to add or remove it"
                  className={`${PILL} ${selected ? PILL_ON : PILL_OFF}`}
                >
                  {portfolio.name}
                </button>
              );
            })}
            {portfolios.length > 1 ? (
              <button
                type="button"
                onClick={selectCustom}
                className={`${PILL} ${scopeMode === "custom" ? PILL_ON : PILL_OFF}`}
              >
                Custom
              </button>
            ) : null}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
            {liveSession ? (
              <p
                className="inline-flex items-center gap-1.5 text-xs text-(--muted)"
                title={
                  isLive
                    ? "1D values use live prices and refresh every 15 seconds"
                    : "The market is closed; 1D values use the last session's prices"
                }
              >
                <span className="relative flex h-2 w-2">
                  {isLive ? (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                  ) : null}
                  <span
                    className={`relative inline-flex h-2 w-2 rounded-full ${
                      isLive ? "bg-emerald-500" : "bg-(--muted)"
                    }`}
                  />
                </span>
                {isLive ? (
                  <>
                    Live{" "}
                    <time
                      dateTime={new Date(liveSession.lastTradeAt).toISOString()}
                      className="font-medium tabular-nums text-foreground"
                    >
                      {new Intl.DateTimeFormat(undefined, {
                        timeStyle: "medium",
                      }).format(new Date(liveSession.lastTradeAt))}
                    </time>
                  </>
                ) : (
                  "Market closed"
                )}
              </p>
            ) : null}
            {snapshot?.status === "ok" ? (
              <p className="text-xs text-(--muted)">
                {snapshot.summary.snapshotCapturedAt === null ? (
                  "Snapshot time unavailable"
                ) : (
                  <>
                    Snapshot{" "}
                    <time
                      dateTime={new Date(
                        snapshot.summary.snapshotCapturedAt,
                      ).toISOString()}
                      title="When the displayed portfolio snapshot was captured"
                      className="font-medium text-foreground"
                    >
                      {formatSnapshotDateTime(
                        snapshot.summary.snapshotCapturedAt,
                      )}
                    </time>
                  </>
                )}
              </p>
            ) : null}
            <div
              className="inline-flex rounded-md border border-(--card-border) bg-(--card-bg) p-0.5"
              role="tablist"
              aria-label="Return horizon"
            >
              {HORIZONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={horizon === option.value}
                  onClick={() => setHorizon(option.value)}
                  className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                    horizon === option.value
                      ? "bg-(--accent)/15 text-accent"
                      : "text-(--muted) hover:text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void handleSync()}
              disabled={isSyncing}
              className="inline-flex h-7 items-center justify-center gap-1.5 rounded-md bg-accent px-2.5 text-xs font-semibold text-white transition-colors hover:bg-(--accent-hover) disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSyncing ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : null}
              {isSyncing ? "Syncing…" : "Sync"}
            </button>
          </div>
        </div>
        {scopeMode === "custom" ? (
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border border-(--card-border) bg-(--card-bg) px-3 py-2">
            {portfolios.map((portfolio) => {
              const checked = customIds.has(String(portfolio._id));
              return (
                <label
                  key={portfolio._id}
                  className="flex cursor-pointer items-center gap-1.5 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCustomPortfolio(portfolio)}
                    className="h-3.5 w-3.5 accent-(--accent)"
                  />
                  {portfolio.name}
                </label>
              );
            })}
          </div>
        ) : null}

        {syncMessage ? (
          <div
            className={`mb-2 rounded-md border px-3 py-2 text-xs ${
              syncMessage.success
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
            }`}
          >
            {syncMessage.text}
          </div>
        ) : null}

        {error && !snapshot ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        ) : snapshot?.status === "ok" ? (
          <>
            <dl className="mb-2 grid grid-cols-2 divide-(--card-border) overflow-hidden rounded-lg border border-(--card-border) bg-(--card-bg) max-lg:divide-y lg:grid-cols-4 lg:divide-x">
              <div className="px-3 py-2">
                <dt className={STAT_LABEL}>Value</dt>
                <dd className="text-lg font-semibold leading-tight tabular-nums">
                  {formatCurrency(
                    (view ?? snapshot).summary.totalCurrentValue,
                  )}
                  {selectedReturn.amount === null ? null : (
                    <span
                      className={`ml-1.5 text-sm font-medium ${toneClass(selectedReturn.amount)}`}
                    >
                      {formatSignedCurrency(selectedReturn.amount)}
                    </span>
                  )}
                </dd>
              </div>
              <div className="px-3 py-2">
                <dt className={STAT_LABEL}>
                  {HORIZONS.find((option) => option.value === horizon)!.label}{" "}
                  return
                </dt>
                <dd className="flex items-baseline gap-2">
                  <span
                    className={`text-lg font-semibold leading-tight tabular-nums ${
                      (selectedReturn.percent ?? 0) >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {formatPercent(selectedReturn.percent)}
                  </span>
                  <span className="truncate text-xs text-(--muted)">
                    {horizonDescription}
                  </span>
                </dd>
              </div>
              <div className="px-3 py-2">
                <dt className={STAT_LABEL}>Positions</dt>
                <dd className="text-lg font-semibold leading-tight tabular-nums">
                  {snapshot.summary.holdingsCount}
                </dd>
              </div>
              <div className="min-w-0 px-3 py-2">
                <dt className={STAT_LABEL}>Portfolios</dt>
                <dd className="flex items-baseline gap-2">
                  <span className="text-lg font-semibold leading-tight tabular-nums">
                    {selectedPortfolios.length}
                  </span>
                  <span className="truncate text-xs text-(--muted)">
                    {selectedPortfolios
                      .map((portfolio) => portfolio.name)
                      .join(", ")}
                  </span>
                </dd>
              </div>
            </dl>

            <section className="overflow-hidden rounded-lg border border-(--card-border) bg-(--card-bg)">
              <div className="flex flex-col gap-2 border-b border-(--card-border) px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <h2 className="text-sm font-semibold">Holdings</h2>
                  <div
                    className="inline-flex shrink-0 rounded-md border border-(--card-border) bg-background p-0.5"
                    role="tablist"
                    aria-label="Chart view"
                  >
                    {CHART_VIEWS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="tab"
                        aria-selected={chartView === option.value}
                        onClick={() => setChartView(option.value)}
                        className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                          chartView === option.value
                            ? "bg-(--accent)/15 text-accent"
                            : "text-(--muted) hover:text-foreground"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <p className="hidden min-w-0 truncate text-xs text-(--muted) md:block">
                    {chartView === "map"
                      ? "Area is position value; colour is return for the horizon."
                      : chartView === "time"
                        ? `Showing ${timeWindowLabel}.`
                        : "Width is position value; height and colour are return, worst to best."}
                  </p>
                </div>
                <div
                  className={`shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1.5 text-xs text-(--muted) ${
                    chartView === "time" ? "hidden" : "flex"
                  }`}
                >
                  {RETURN_LEGEND.map((bucket) => (
                    <span
                      key={bucket.label}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <span
                        className="h-3 w-3 rounded-sm"
                        style={{ backgroundColor: bucket.color }}
                      />
                      {bucket.label}
                    </span>
                  ))}
                </div>
              </div>
              {chartView === "time" && horizon === "1d" && liveSession ? (
                <IntradayChart
                  holdings={snapshot.holdings}
                  session={liveSession}
                  hidden={hiddenTickers}
                  onHiddenChange={setHiddenTickers}
                />
              ) : chartView === "time" ? (
                history?.status === "ok" ? (
                  <ValueOverTime
                    points={history.points}
                    windowStart={timeWindowStart}
                    today={today}
                    hidden={hiddenTickers}
                    onHiddenChange={setHiddenTickers}
                  />
                ) : (
                  <div className="flex h-[52vh] min-h-[380px] items-center justify-center px-6 text-center text-sm text-(--muted)">
                    {history
                      ? (history.message ?? "Snapshot history is unavailable.")
                      : "Loading snapshot history…"}
                  </div>
                )
              ) : (
                <div className="relative h-[58vh] min-h-[420px] w-full">
                  {isLoading ? (
                    <div className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-lg bg-background/90 px-3 py-2 text-xs text-(--muted) shadow">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                      Refreshing
                    </div>
                  ) : null}
                  {chartView === "map" ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <Treemap
                        data={chartData}
                        dataKey="value"
                        nameKey="name"
                        aspectRatio={4 / 3}
                        content={PortfolioTile}
                        isAnimationActive={false}
                        onMouseEnter={(node) =>
                          setHoveredId(String(node.id ?? ""))
                        }
                        onMouseLeave={() => setHoveredId(null)}
                      />
                    </ResponsiveContainer>
                  ) : (
                    <ReturnBars
                      data={chartData}
                      hoveredId={hoveredId}
                      onHover={setHoveredId}
                    />
                  )}
                </div>
              )}
              {activeEntry && chartView !== "time" ? (
                <div className="grid grid-cols-2 gap-3 border-t border-(--card-border) px-4 py-4 sm:grid-cols-5">
                  <div>
                    <p className="text-xs text-(--muted)">Holding</p>
                    <p className="font-bold">{activeEntry.ticker}</p>
                    <p className="truncate text-xs text-(--muted)">
                      {activeEntry.companyName}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-(--muted)">Return</p>
                    <p
                      className={`font-semibold tabular-nums ${
                        (activeEntry.returnPercent ?? 0) >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {formatPercent(activeEntry.returnPercent)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-(--muted)">Value</p>
                    <ValueWithChange
                      value={formatCurrency(activeEntry.value)}
                      change={
                        activeEntry.returnAmount === null
                          ? null
                          : formatSignedCurrency(activeEntry.returnAmount)
                      }
                      tone={toneClass(activeEntry.returnAmount)}
                    />
                  </div>
                  <div>
                    <p className="text-xs text-(--muted)">Per share</p>
                    <ValueWithChange
                      value={formatSharePrice(activeEntry.sharePrice)}
                      change={
                        activeEntry.perShareChange === null
                          ? null
                          : formatSignedSharePrice(activeEntry.perShareChange)
                      }
                      tone={toneClass(activeEntry.perShareChange)}
                    />
                  </div>
                  <div>
                    <p className="text-xs text-(--muted)">Allocation</p>
                    <ValueWithChange
                      value={
                        activeEntry.allocation === null
                          ? "—"
                          : `${activeEntry.allocation.toFixed(2)}%`
                      }
                      change={
                        activeEntry.allocationChange === null
                          ? null
                          : formatPointChange(activeEntry.allocationChange)
                      }
                      tone="text-(--muted)"
                    />
                  </div>
                </div>
              ) : null}
            </section>

            {history?.status !== "ok" &&
            horizon !== "1d" &&
            horizon !== "total" ? (
              <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
                {history?.message ?? "Snapshot history is unavailable."}
              </p>
            ) : null}
            {error ? (
              <p className="mt-3 text-sm text-red-700 dark:text-red-300">
                {error}
              </p>
            ) : null}
          </>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-32 text-(--muted)">
            <span className="mr-3 h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Loading portfolio…
          </div>
        ) : (
          <div className="rounded-xl border border-(--card-border) bg-(--card-bg) p-8 text-center">
            <p className="font-semibold">Portfolio data unavailable</p>
            <p className="mt-2 text-sm text-(--muted)">
              {error ?? snapshot?.message ?? "Check your portfolio settings."}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export default function PortfolioPage() {
  const { session, isPending } = useAuthSession();
  if (isPending) return <LoadingState />;
  return session ? <PortfolioContent /> : <SignIn />;
}
