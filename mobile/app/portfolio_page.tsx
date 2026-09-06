import type { FunctionReturnType } from "convex/server";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { taskyApi, useTaskyAction, useTaskyAuth } from "@/lib/tasky";
import {
  colors,
  fontSize,
  radius,
  sharedStyles,
  spacing,
  tone,
} from "@/lib/theme";
import { automaticKeyboardInsets } from "@/lib/headerItems";
import { PortfolioHistoryChart } from "@/components/PortfolioHistoryChart";

type PortfolioSnapshot = FunctionReturnType<
  typeof taskyApi.portfolio.getSnapshot
>;
type PriceHistoryResult = FunctionReturnType<
  typeof taskyApi.portfolio.getPriceHistory
>;
type Holding = PortfolioSnapshot["holdings"][number];

type SortKey = "ticker" | "value" | "dayDollar" | "dayPercent" | "totalPercent";
type SortDirection = "asc" | "desc";

function formatCurrency(value: number, digits = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  }).format(value);
}

function formatSignedCurrency(value: number, digits = 0): string {
  const formatted = formatCurrency(Math.abs(value), digits);
  return `${value >= 0 ? "+" : "-"}${formatted}`;
}

function formatPercent(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatOptionalSignedCurrency(
  value: number | null | undefined,
): string {
  return value === null || value === undefined
    ? "—"
    : formatSignedCurrency(value);
}

function formatOptionalPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : formatPercent(value);
}

function formatMarketDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getSortValue(holding: Holding, key: SortKey): number | string {
  switch (key) {
    case "ticker":
      return holding.ticker;
    case "value":
      return holding.currentValue;
    case "dayDollar":
      return holding.dayReturn ?? Number.NEGATIVE_INFINITY;
    case "dayPercent":
      return holding.dayReturnPercent ?? Number.NEGATIVE_INFINITY;
    case "totalPercent":
      return holding.gainLossPercent;
  }
}

function sortHoldings(
  holdings: Holding[],
  key: SortKey,
  direction: SortDirection,
): Holding[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...holdings].sort((a, b) => {
    const av = getSortValue(a, key);
    const bv = getSortValue(b, key);
    if (typeof av === "string" || typeof bv === "string") {
      const aStr = String(av);
      const bStr = String(bv);
      return aStr.localeCompare(bStr) * factor;
    }
    return (av - bv) * factor;
  });
}

type SortableColumn = {
  key: SortKey;
  label: string;
  width: number;
  align?: "left" | "right";
};

const COLUMNS: SortableColumn[] = [
  { key: "ticker", label: "Ticker", width: 92, align: "left" },
  { key: "dayDollar", label: "Day $", width: 80, align: "right" },
  { key: "dayPercent", label: "Day %", width: 76, align: "right" },
  { key: "value", label: "Value", width: 88, align: "right" },
  { key: "totalPercent", label: "Total %", width: 80, align: "right" },
];

const COLUMN_WIDTHS = COLUMNS.reduce(
  (acc, column) => {
    acc[column.key] = column.width;
    return acc;
  },
  {} as Record<SortKey, number>,
);

function SummaryStrip({
  summary,
  onRefresh,
  onSync,
  isLoading,
  isSyncing,
  canSync,
}: {
  summary: PortfolioSnapshot["summary"];
  onRefresh: () => void;
  onSync: () => void;
  isLoading: boolean;
  isSyncing: boolean;
  canSync: boolean;
}) {
  const dayHas = summary.dayReturn !== null;
  const syncDisabled = !canSync || isSyncing || isLoading;
  const refreshDisabled = isLoading || isSyncing;
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryHeader}>
        <View style={styles.summaryHeaderText}>
          <Text style={styles.summaryValue}>
            {formatCurrency(summary.totalCurrentValue)}
          </Text>
          <Text style={sharedStyles.muted}>
            As of {formatMarketDate(summary.latestPriceDate)}
          </Text>
        </View>
        <View style={styles.summaryActions}>
          <TouchableOpacity
            style={[styles.syncButton, syncDisabled && styles.actionDisabled]}
            onPress={onSync}
            disabled={syncDisabled}
            hitSlop={6}
          >
            {isSyncing ? (
              <ActivityIndicator
                size="small"
                color={colors.systemBlue as unknown as string}
              />
            ) : (
              <Text style={styles.syncButtonText}>Sync prices</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.refreshButton,
              refreshDisabled && styles.actionDisabled,
            ]}
            onPress={onRefresh}
            disabled={refreshDisabled}
            hitSlop={6}
          >
            {isLoading ? (
              <ActivityIndicator
                size="small"
                color={colors.systemBlue as unknown as string}
              />
            ) : (
              <Text style={styles.refreshIcon}>{"\u21BB"}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.summaryStats}>
        <SummaryStat
          label="Today"
          primary={dayHas ? formatSignedCurrency(summary.dayReturn!) : "—"}
          secondary={
            summary.dayReturnPercent !== null
              ? formatPercent(summary.dayReturnPercent)
              : null
          }
          tone={tone(summary.dayReturn ?? 0)}
        />
        <View style={styles.summaryDivider} />
        <SummaryStat
          label="Total return"
          primary={formatPercent(summary.gainLossPercent)}
          secondary={formatSignedCurrency(summary.gainLoss)}
          tone={tone(summary.gainLoss)}
        />
        <View style={styles.summaryDivider} />
        <SummaryStat
          label="Cost basis"
          primary={formatCurrency(summary.totalCost)}
          secondary={null}
          tone={colors.label}
        />
      </View>
    </View>
  );
}

function SummaryStat({
  label,
  primary,
  secondary,
  tone: valueTone,
}: {
  label: string;
  primary: string;
  secondary: string | null;
  tone: unknown;
}) {
  return (
    <View style={styles.summaryStat}>
      <Text style={styles.summaryStatLabel}>{label}</Text>
      <Text
        style={[
          styles.summaryStatPrimary,
          { color: valueTone as unknown as string },
        ]}
      >
        {primary}
      </Text>
      {secondary ? (
        <Text
          style={[
            styles.summaryStatSecondary,
            { color: valueTone as unknown as string },
          ]}
        >
          {secondary}
        </Text>
      ) : null}
    </View>
  );
}

function HoldingsTable({
  holdings,
  sortKey,
  sortDirection,
  onSort,
}: {
  holdings: Holding[];
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (key: SortKey) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tableScrollContent}
    >
      <View style={styles.tableCard}>
        <View style={[styles.tableRow, styles.tableHeader]}>
          {COLUMNS.map((column) => {
            const active = column.key === sortKey;
            return (
              <TouchableOpacity
                key={column.key}
                style={[styles.cell, { width: column.width }]}
                onPress={() => onSort(column.key)}
                hitSlop={4}
              >
                <Text
                  style={[
                    styles.headerCellText,
                    column.align === "right" && styles.cellRight,
                    active && styles.headerCellActive,
                  ]}
                  numberOfLines={1}
                >
                  {column.label}
                  {active
                    ? sortDirection === "asc"
                      ? " \u25B2"
                      : " \u25BC"
                    : ""}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {holdings.map((holding, index) => (
          <View key={holding.id}>
            {index > 0 ? <View style={styles.tableDivider} /> : null}
            <HoldingRow holding={holding} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function HoldingRow({ holding }: { holding: Holding }) {
  return (
    <View style={styles.tableRow}>
      <View style={[styles.cell, { width: COLUMN_WIDTHS.ticker }]}>
        <Text style={styles.tickerText} numberOfLines={1}>
          {holding.ticker}
        </Text>
        {holding.companyName ? (
          <Text style={styles.companyText} numberOfLines={1}>
            {holding.companyName}
          </Text>
        ) : null}
      </View>
      <View style={[styles.cell, { width: COLUMN_WIDTHS.dayDollar }]}>
        <Text
          style={[
            styles.cellPrimary,
            styles.cellRight,
            { color: tone(holding.dayReturn ?? 0) as unknown as string },
          ]}
          numberOfLines={1}
        >
          {formatOptionalSignedCurrency(holding.dayReturn)}
        </Text>
      </View>
      <View style={[styles.cell, { width: COLUMN_WIDTHS.dayPercent }]}>
        <Text
          style={[
            styles.cellPrimary,
            styles.cellRight,
            { color: tone(holding.dayReturnPercent ?? 0) as unknown as string },
          ]}
          numberOfLines={1}
        >
          {formatOptionalPercent(holding.dayReturnPercent)}
        </Text>
      </View>
      <View style={[styles.cell, { width: COLUMN_WIDTHS.value }]}>
        <Text style={[styles.cellPrimary, styles.cellRight]} numberOfLines={1}>
          {formatCurrency(holding.currentValue)}
        </Text>
        <Text style={[styles.cellMeta, styles.cellRight]} numberOfLines={1}>
          {holding.shares.toLocaleString()} sh
        </Text>
      </View>
      <View style={[styles.cell, { width: COLUMN_WIDTHS.totalPercent }]}>
        <Text
          style={[
            styles.cellPrimary,
            styles.cellRight,
            { color: tone(holding.gainLossPercent) as unknown as string },
          ]}
          numberOfLines={1}
        >
          {formatPercent(holding.gainLossPercent)}
        </Text>
      </View>
    </View>
  );
}

function MoversCard({ holdings }: { holdings: Holding[] }) {
  const movers = useMemo(() => {
    const withDay = holdings.filter(
      (h): h is Holding & { dayReturn: number; dayReturnPercent: number } =>
        h.dayReturn !== null &&
        h.dayReturn !== undefined &&
        h.dayReturnPercent !== null &&
        h.dayReturnPercent !== undefined,
    );
    const sorted = [...withDay].sort(
      (a, b) => b.dayReturnPercent - a.dayReturnPercent,
    );
    const best = sorted[0] ?? null;
    const worst = sorted[sorted.length - 1] ?? null;
    return { best, worst };
  }, [holdings]);

  if (!movers.best && !movers.worst) return null;

  return (
    <View style={styles.moversCard}>
      <Text style={sharedStyles.sectionTitle}>Today&rsquo;s movers</Text>
      <View style={styles.moversRow}>
        {movers.best ? (
          <MoverPanel label="Top gainer" holding={movers.best} />
        ) : null}
        {movers.worst && movers.worst !== movers.best ? (
          <MoverPanel label="Top loser" holding={movers.worst} />
        ) : null}
      </View>
    </View>
  );
}

function SyncFeedbackBanner({
  feedback,
  onDismiss,
}: {
  feedback: SyncFeedback;
  onDismiss: () => void;
}) {
  const isSuccess = feedback.kind === "success";
  const accent = isSuccess ? colors.systemGreen : colors.systemRed;
  const details = feedback.details;
  return (
    <View
      style={[
        styles.feedbackBanner,
        { borderLeftColor: accent as unknown as string },
      ]}
    >
      <View style={styles.feedbackHeader}>
        <Text
          style={[styles.feedbackTitle, { color: accent as unknown as string }]}
        >
          {isSuccess ? "Prices synced" : "Sync failed"}
        </Text>
        <TouchableOpacity onPress={onDismiss} hitSlop={8}>
          <Text style={styles.feedbackDismiss}>Dismiss</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.feedbackMessage}>{feedback.message}</Text>
      {isSuccess && details ? (
        <Text style={sharedStyles.muted}>
          {details.recordsInserted} inserted · {details.recordsFound} found ·{" "}
          {details.tickersProcessed} ticker
          {details.tickersProcessed === 1 ? "" : "s"}
        </Text>
      ) : null}
    </View>
  );
}

function MoverPanel({
  label,
  holding,
}: {
  label: string;
  holding: Holding & { dayReturn: number; dayReturnPercent: number };
}) {
  return (
    <View style={styles.moverPanel}>
      <Text style={styles.moverLabel}>{label}</Text>
      <Text style={styles.moverTicker}>{holding.ticker}</Text>
      <Text
        style={[
          styles.moverDelta,
          { color: tone(holding.dayReturn) as unknown as string },
        ]}
      >
        {formatPercent(holding.dayReturnPercent)}
      </Text>
      <Text style={sharedStyles.muted}>
        {formatSignedCurrency(holding.dayReturn)}
      </Text>
    </View>
  );
}

type SyncFeedback = {
  kind: "success" | "error";
  message: string;
  details?: SyncResult["details"];
};

type SyncResult = NonNullable<
  Awaited<
    ReturnType<
      ReturnType<
        typeof useTaskyAction<typeof taskyApi.portfolio.syncPriceHistory>
      >
    >
  >
>;

export default function PortfolioPage() {
  const router = useRouter();
  const taskyAuth = useTaskyAuth();
  const taskyEnabled =
    taskyAuth.isAuthenticated && taskyAuth.convexAuthenticated;
  const getPortfolioSnapshot = useTaskyAction(taskyApi.portfolio.getSnapshot);
  const getPriceHistory = useTaskyAction(taskyApi.portfolio.getPriceHistory);
  const syncPriceHistory = useTaskyAction(taskyApi.portfolio.syncPriceHistory);

  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryResult | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<SyncFeedback | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const refreshPortfolio = useCallback(async () => {
    if (!taskyEnabled) return;
    setIsLoading(true);
    setError(null);
    try {
      const snapshot = await getPortfolioSnapshot({ includePriceStatus: true });
      setPortfolio(snapshot);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Failed to load portfolio",
      );
    } finally {
      setIsLoading(false);
    }
  }, [getPortfolioSnapshot, taskyEnabled]);

  const refreshHistory = useCallback(async () => {
    if (!taskyEnabled) return;
    setIsHistoryLoading(true);
    setHistoryError(null);
    try {
      const history = await getPriceHistory({});
      if (!history) {
        setHistoryError("Tasky session is unavailable.");
        return;
      }
      setPriceHistory(history);
      if (history.status !== "ok") {
        setHistoryError(history.message ?? "Price history unavailable.");
      }
    } catch (refreshError) {
      setHistoryError(
        refreshError instanceof Error
          ? refreshError.message
          : "Failed to load price history",
      );
    } finally {
      setIsHistoryLoading(false);
    }
  }, [getPriceHistory, taskyEnabled]);

  useEffect(() => {
    void refreshPortfolio();
  }, [refreshPortfolio]);

  useEffect(() => {
    if (portfolio?.status === "ok") {
      void refreshHistory();
    }
  }, [portfolio?.status, refreshHistory]);

  const handleSyncPrices = useCallback(async () => {
    if (!taskyEnabled || isSyncing || isLoading) return;
    setIsSyncing(true);
    setSyncFeedback(null);
    try {
      const result = await syncPriceHistory({});
      if (!result) {
        setSyncFeedback({
          kind: "error",
          message:
            "Tasky session is unavailable. Reconnect from Settings and try again.",
        });
        return;
      }
      setSyncFeedback({
        kind: result.success ? "success" : "error",
        message: result.message,
        details: result.details,
      });
      if (result.success) {
        await refreshPortfolio();
        await refreshHistory();
      }
    } catch (syncError) {
      setSyncFeedback({
        kind: "error",
        message:
          syncError instanceof Error
            ? syncError.message
            : "Failed to sync prices",
      });
    } finally {
      setIsSyncing(false);
    }
  }, [
    taskyEnabled,
    isSyncing,
    isLoading,
    syncPriceHistory,
    refreshPortfolio,
    refreshHistory,
  ]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection(key === "ticker" ? "asc" : "desc");
    }
  };

  const sortedHoldings = useMemo(() => {
    if (portfolio?.status !== "ok") return [];
    return sortHoldings(portfolio.holdings, sortKey, sortDirection);
  }, [portfolio, sortKey, sortDirection]);

  if (!taskyAuth.isAuthenticated) {
    return (
      <ScrollView
        style={sharedStyles.screen}
        contentContainerStyle={sharedStyles.screenContent}
        {...automaticKeyboardInsets}
      >
        <View style={sharedStyles.card}>
          <Text style={styles.notConnectedTitle}>Tasky not connected</Text>
          <Text style={sharedStyles.muted}>
            Connect Tasky in Settings to see your portfolio.
          </Text>
          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => router.push("/settings_page")}
          >
            <Text style={styles.linkButtonText}>Open Settings</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  if (!taskyEnabled || (isLoading && !portfolio)) {
    return (
      <View style={[sharedStyles.screen, styles.centerColumn]}>
        <ActivityIndicator />
        <Text style={sharedStyles.muted}>Loading portfolio…</Text>
      </View>
    );
  }

  if (portfolio?.status === "no_credentials") {
    return (
      <ScrollView
        style={sharedStyles.screen}
        contentContainerStyle={sharedStyles.screenContent}
        {...automaticKeyboardInsets}
      >
        <View style={sharedStyles.card}>
          <Text style={styles.notConnectedTitle}>No portfolio credentials</Text>
          <Text style={sharedStyles.muted}>
            {portfolio.message ??
              "Add Airtable and Schwab credentials in the Tasky web app to enable this view."}
          </Text>
        </View>
      </ScrollView>
    );
  }

  if (!portfolio || portfolio.status !== "ok") {
    return (
      <ScrollView
        style={sharedStyles.screen}
        contentContainerStyle={sharedStyles.screenContent}
        {...automaticKeyboardInsets}
      >
        <Text style={sharedStyles.error}>
          {portfolio?.message ?? error ?? "Portfolio data unavailable."}
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={sharedStyles.screen}
      contentContainerStyle={sharedStyles.screenContent}
      {...automaticKeyboardInsets}
    >
      <SummaryStrip
        summary={portfolio.summary}
        onRefresh={() => {
          void refreshPortfolio();
          void refreshHistory();
        }}
        onSync={() => void handleSyncPrices()}
        isLoading={isLoading}
        isSyncing={isSyncing}
        canSync={taskyEnabled}
      />
      <PortfolioHistoryChart
        points={priceHistory?.status === "ok" ? priceHistory.points : []}
        holdings={portfolio.holdings}
        startDate={priceHistory?.startDate ?? null}
        isLoading={isHistoryLoading && !priceHistory}
        error={historyError}
      />
      {syncFeedback ? (
        <SyncFeedbackBanner
          feedback={syncFeedback}
          onDismiss={() => setSyncFeedback(null)}
        />
      ) : null}
      <MoversCard holdings={portfolio.holdings} />
      <View style={styles.holdingsHeader}>
        <Text style={sharedStyles.sectionTitle}>Holdings</Text>
        <Text style={styles.holdingsHint}>Tap a column to sort</Text>
      </View>
      <HoldingsTable
        holdings={sortedHoldings}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={handleSort}
      />
      {error ? <Text style={sharedStyles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    borderRadius: radius.lg,
    backgroundColor: colors.secondarySystemGroupedBackground,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  summaryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  summaryHeaderText: {
    flex: 1,
    gap: spacing.xs,
  },
  summaryValue: {
    fontSize: 32,
    fontWeight: "800",
    color: colors.label,
    fontVariant: ["tabular-nums"],
  },
  summaryActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  syncButton: {
    minHeight: 36,
    minWidth: 96,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.tertiarySystemGroupedBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  syncButtonText: {
    fontSize: fontSize.small,
    fontWeight: "700",
    color: colors.systemBlue,
  },
  refreshButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.tertiarySystemGroupedBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  actionDisabled: {
    opacity: 0.4,
  },
  refreshIcon: {
    fontSize: 20,
    color: colors.systemBlue,
  },
  feedbackBanner: {
    borderRadius: radius.lg,
    backgroundColor: colors.secondarySystemGroupedBackground,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xs,
    borderLeftWidth: 4,
  },
  feedbackHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  feedbackTitle: {
    fontSize: fontSize.small,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  feedbackDismiss: {
    fontSize: fontSize.small,
    fontWeight: "600",
    color: colors.secondaryLabel,
  },
  feedbackMessage: {
    fontSize: fontSize.body,
    color: colors.label,
    lineHeight: 21,
  },
  summaryStats: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.md,
  },
  summaryDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
  summaryStat: {
    flex: 1,
    gap: 2,
  },
  summaryStatLabel: {
    fontSize: fontSize.micro,
    color: colors.secondaryLabel,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontWeight: "600",
  },
  summaryStatPrimary: {
    fontSize: fontSize.subhead,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  summaryStatSecondary: {
    fontSize: fontSize.caption,
    fontVariant: ["tabular-nums"],
  },
  moversCard: {
    gap: spacing.sm,
  },
  moversRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  moverPanel: {
    flex: 1,
    backgroundColor: colors.secondarySystemGroupedBackground,
    padding: spacing.md,
    borderRadius: radius.lg,
    gap: 2,
  },
  moverLabel: {
    fontSize: fontSize.micro,
    color: colors.secondaryLabel,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontWeight: "600",
  },
  moverTicker: {
    fontSize: fontSize.bodyLg,
    fontWeight: "800",
    color: colors.label,
    marginTop: spacing.xs,
  },
  moverDelta: {
    fontSize: fontSize.subhead,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  holdingsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.xs,
  },
  holdingsHint: {
    fontSize: fontSize.caption,
    color: colors.tertiaryLabel,
  },
  tableScrollContent: {
    flexGrow: 1,
  },
  tableCard: {
    borderRadius: radius.xl,
    backgroundColor: colors.secondarySystemGroupedBackground,
    overflow: "hidden",
  },
  tableHeader: {
    backgroundColor: colors.tertiarySystemGroupedBackground,
    paddingVertical: spacing.sm,
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  tableDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginLeft: spacing.md,
  },
  cell: {
    paddingHorizontal: spacing.xs,
  },
  cellRight: {
    textAlign: "right",
  },
  headerCellText: {
    fontSize: fontSize.micro,
    fontWeight: "700",
    color: colors.secondaryLabel,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  headerCellActive: {
    color: colors.label,
  },
  cellPrimary: {
    fontSize: fontSize.small,
    fontWeight: "600",
    color: colors.label,
    fontVariant: ["tabular-nums"],
  },
  cellMeta: {
    fontSize: fontSize.micro,
    color: colors.tertiaryLabel,
    fontVariant: ["tabular-nums"],
    marginTop: 2,
  },
  tickerText: {
    fontSize: fontSize.body,
    fontWeight: "800",
    color: colors.label,
  },
  companyText: {
    fontSize: fontSize.micro,
    color: colors.tertiaryLabel,
    marginTop: 2,
  },
  centerColumn: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  notConnectedTitle: {
    fontSize: fontSize.subhead,
    fontWeight: "700",
    color: colors.label,
  },
  linkButton: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.systemBlue,
    borderRadius: radius.md,
  },
  linkButtonText: {
    color: "white",
    fontWeight: "700",
    fontSize: fontSize.body,
  },
});
