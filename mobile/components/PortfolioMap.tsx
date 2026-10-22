import { useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  layoutTreemap,
  portfolioReturnColor,
  PORTFOLIO_RETURN_COLORS,
} from "@/lib/portfolioMap";
import {
  colors,
  fontSize,
  radius,
  sharedStyles,
  spacing,
} from "@/lib/theme";

type Horizon = "1d" | "1w" | "1m" | "3m" | "ytd" | "total";

type MapHolding = {
  id: string;
  ticker: string;
  companyName: string;
  shares: number;
  currentPrice: number | null;
  currentValue: number;
  gainLossPercent: number;
  dayReturn?: number | null;
  dayReturnPercent?: number | null;
};

type HistoryPoint = {
  date: string;
  holdings: {
    ticker: string;
    quantity: number;
    value: number;
  }[];
};

type MapEntry = {
  holding: MapHolding;
  returnPercent: number | null;
};

const HORIZONS: { value: Horizon; label: string }[] = [
  { value: "1d", label: "1D" },
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "ytd", label: "YTD" },
  { value: "total", label: "Total" },
];

const LEGEND_COLORS = [
  PORTFOLIO_RETURN_COLORS.lossStrong,
  PORTFOLIO_RETURN_COLORS.lossMedium,
  PORTFOLIO_RETURN_COLORS.lossMild,
  PORTFOLIO_RETURN_COLORS.flat,
  PORTFOLIO_RETURN_COLORS.gainMild,
  PORTFOLIO_RETURN_COLORS.gainMedium,
  PORTFOLIO_RETURN_COLORS.gainStrong,
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

function formatReturnLabel(
  returnPercent: number | null,
  horizon: Horizon,
  dayReturn: number | null | undefined,
): string {
  const percentLabel = formatPercent(returnPercent);
  if (horizon !== "1d" || returnPercent === null || dayReturn == null) {
    return percentLabel;
  }
  return `${percentLabel} (${formatCompactSignedCurrency(dayReturn)})`;
}

function shiftDate(
  date: string,
  horizon: Exclude<Horizon, "1d" | "total">,
): string {
  const shifted = new Date(`${date}T12:00:00.000Z`);
  if (horizon === "1w") shifted.setUTCDate(shifted.getUTCDate() - 7);
  if (horizon === "1m") shifted.setUTCMonth(shifted.getUTCMonth() - 1);
  if (horizon === "3m") shifted.setUTCMonth(shifted.getUTCMonth() - 3);
  if (horizon === "ytd") shifted.setUTCMonth(0, 1);
  return shifted.toISOString().slice(0, 10);
}

export function PortfolioMap({
  holdings,
  totalValue,
  latestPriceDate,
  historyPoints,
  isHistoryLoading,
  historyError,
  viewToggle,
}: {
  holdings: MapHolding[];
  totalValue: number;
  latestPriceDate: string | null;
  historyPoints: HistoryPoint[];
  isHistoryLoading: boolean;
  historyError: string | null;
  viewToggle: ReactNode;
}) {
  const [horizon, setHorizon] = useState<Horizon>("1d");
  const [mapWidth, setMapWidth] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const mapHeight =
    mapWidth > 0 ? Math.max(400, Math.min(520, mapWidth * 1.25)) : 440;

  const baselinePoint = useMemo(() => {
    if (
      horizon === "1d" ||
      horizon === "total" ||
      historyPoints.length === 0
    ) {
      return null;
    }
    const latestDate =
      latestPriceDate ?? historyPoints[historyPoints.length - 1]!.date;
    const targetDate = shiftDate(latestDate, horizon);
    return (
      historyPoints.filter((point) => point.date <= targetDate).at(-1) ?? null
    );
  }, [historyPoints, horizon, latestPriceDate]);

  const entries = useMemo<MapEntry[]>(() => {
    const baselineByTicker = new Map(
      baselinePoint?.holdings.map((holding) => [
        holding.ticker.trim().toUpperCase(),
        holding,
      ]) ?? [],
    );
    return holdings
      .filter((holding) => holding.currentValue > 0)
      .map((holding) => {
        let returnPercent: number | null;
        if (horizon === "1d") {
          returnPercent = holding.dayReturnPercent ?? null;
        } else if (horizon === "total") {
          returnPercent = holding.gainLossPercent;
        } else if (!holding.ticker) {
          returnPercent = 0;
        } else {
          const baseline = baselineByTicker.get(holding.ticker);
          const currentPrice =
            holding.currentPrice ??
            (holding.shares > 0
              ? holding.currentValue / holding.shares
              : null);
          const baselinePrice =
            baseline && baseline.quantity > 0
              ? baseline.value / baseline.quantity
              : null;
          returnPercent =
            currentPrice !== null && baselinePrice !== null && baselinePrice > 0
              ? ((currentPrice - baselinePrice) / baselinePrice) * 100
              : null;
        }
        return { holding, returnPercent };
      })
      .sort(
        (a, b) =>
          b.holding.currentValue - a.holding.currentValue ||
          a.holding.ticker.localeCompare(b.holding.ticker),
      );
  }, [baselinePoint, holdings, horizon]);

  const layout = useMemo(
    () =>
      layoutTreemap(
        entries.map((entry) => ({
          item: entry,
          value: entry.holding.currentValue,
        })),
        mapWidth,
        mapHeight,
      ),
    [entries, mapHeight, mapWidth],
  );
  const selectedEntry =
    entries.find((entry) => entry.holding.id === selectedId) ?? entries[0];
  const needsHistory = horizon !== "1d" && horizon !== "total";

  const handleLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setMapWidth((current) => (Math.abs(current - width) > 1 ? width : current));
  };

  return (
    <View style={styles.card}>
      {viewToggle}
      <View style={styles.header}>
        <Text style={styles.title}>Map</Text>
        {needsHistory && isHistoryLoading ? (
          <View style={styles.loadingHistory}>
            <ActivityIndicator size="small" />
            <Text style={styles.loadingHistoryText}>History</Text>
          </View>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizons}
      >
        {HORIZONS.map((option) => {
          const selected = option.value === horizon;
          return (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.horizon,
                selected && styles.horizonSelected,
              ]}
              onPress={() => setHorizon(option.value)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
            >
              <Text
                style={[
                  styles.horizonText,
                  selected && styles.horizonTextSelected,
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View>
        <View style={styles.legendColors}>
          {LEGEND_COLORS.map((color) => (
            <View
              key={color}
              style={[styles.legendColor, { backgroundColor: color }]}
            />
          ))}
        </View>
        <View style={styles.legendLabels}>
          <Text style={styles.legendLabel}>{"< -5%"}</Text>
          <Text style={styles.legendLabel}>Flat ±0.1%</Text>
          <Text style={styles.legendLabel}>{"> 5%"}</Text>
        </View>
      </View>

      <View
        style={[styles.map, { height: mapHeight }]}
        onLayout={handleLayout}
      >
        {layout.map(({ item, x, y, width, height }) => {
          const ticker = item.holding.ticker || "Cash";
          const returnLabel = formatReturnLabel(
            item.returnPercent,
            horizon,
            item.holding.dayReturn,
          );
          const valueLabel = formatCurrency(item.holding.currentValue);
          const showTicker =
            width >= Math.max(42, ticker.length * 8 + 14) && height >= 24;
          const showReturn =
            showTicker &&
            width >= returnLabel.length * 5.25 + 14 &&
            height >= 45;
          const showValue =
            showReturn && width >= valueLabel.length * 6 + 14 && height >= 66;
          const selected = selectedEntry?.holding.id === item.holding.id;
          return (
            <TouchableOpacity
              key={item.holding.id}
              activeOpacity={0.82}
              hitSlop={4}
              onPress={() => setSelectedId(item.holding.id)}
              accessibilityRole="button"
              accessibilityLabel={`${ticker}, ${valueLabel}, ${returnLabel}`}
              style={[
                styles.tile,
                {
                  left: x + 0.5,
                  top: y + 0.5,
                  width: Math.max(0, width - 1),
                  height: Math.max(0, height - 1),
                  backgroundColor: portfolioReturnColor(item.returnPercent),
                },
                selected && styles.tileSelected,
              ]}
            >
              {showTicker ? (
                <Text
                  style={styles.tileTicker}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                >
                  {ticker}
                </Text>
              ) : null}
              {showReturn ? (
                <Text
                  style={styles.tileReturn}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                >
                  {returnLabel}
                </Text>
              ) : null}
              {showValue ? (
                <Text style={styles.tileValue} numberOfLines={1}>
                  {valueLabel}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>

      {needsHistory && historyError ? (
        <Text style={sharedStyles.error}>{historyError}</Text>
      ) : null}

      {selectedEntry ? (
        <View style={styles.details}>
          <View style={styles.detailHeading}>
            <Text style={styles.detailTicker}>
              {selectedEntry.holding.ticker || "Cash"}
            </Text>
            <Text style={styles.detailName} numberOfLines={1}>
              {selectedEntry.holding.companyName}
            </Text>
          </View>
          <View style={styles.detailGrid}>
            <Detail
              label="Value"
              value={formatCurrency(selectedEntry.holding.currentValue)}
            />
            <Detail
              label="Per share"
              value={formatSharePrice(selectedEntry.holding.currentPrice)}
            />
            <Detail
              label="Allocation"
              value={
                totalValue > 0
                  ? `${((selectedEntry.holding.currentValue / totalValue) * 100).toFixed(2)}%`
                  : "—"
              }
            />
            <Detail
              label="Return"
              value={formatReturnLabel(
                selectedEntry.returnPercent,
                horizon,
                selectedEntry.holding.dayReturn,
              )}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.secondarySystemGroupedBackground,
    padding: spacing.md,
    gap: spacing.md,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
  },
  title: {
    fontSize: fontSize.caption,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: colors.secondaryLabel,
    textTransform: "uppercase",
  },
  loadingHistory: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  loadingHistoryText: {
    fontSize: fontSize.micro,
    color: colors.tertiaryLabel,
  },
  horizons: {
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  horizon: {
    minWidth: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.tertiarySystemGroupedBackground,
    alignItems: "center",
  },
  horizonSelected: {
    backgroundColor: colors.systemBlue,
  },
  horizonText: {
    fontSize: fontSize.caption,
    fontWeight: "700",
    color: colors.secondaryLabel,
  },
  horizonTextSelected: {
    color: "#ffffff",
  },
  legendColors: {
    flexDirection: "row",
    height: 8,
    overflow: "hidden",
    borderRadius: radius.sm,
  },
  legendColor: {
    flex: 1,
  },
  legendLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.xs,
  },
  legendLabel: {
    fontSize: fontSize.micro,
    color: colors.tertiaryLabel,
  },
  map: {
    position: "relative",
    width: "100%",
    overflow: "hidden",
    borderRadius: radius.sm,
    backgroundColor: colors.systemGroupedBackground,
  },
  tile: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.systemGroupedBackground,
  },
  tileSelected: {
    borderWidth: 1.5,
    borderColor: "#ffffff",
  },
  tileTicker: {
    color: "#ffffff",
    fontSize: fontSize.body,
    fontWeight: "800",
    textAlign: "center",
  },
  tileReturn: {
    marginTop: 2,
    color: "rgba(255,255,255,0.92)",
    fontSize: fontSize.caption,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  tileValue: {
    marginTop: 2,
    color: "rgba(255,255,255,0.72)",
    fontSize: fontSize.micro,
    fontVariant: ["tabular-nums"],
  },
  details: {
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    gap: spacing.md,
  },
  detailHeading: {
    minWidth: 0,
  },
  detailTicker: {
    color: colors.label,
    fontSize: fontSize.subhead,
    fontWeight: "800",
  },
  detailName: {
    marginTop: 2,
    color: colors.secondaryLabel,
    fontSize: fontSize.caption,
  },
  detailGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  detail: {
    width: "46%",
    gap: 2,
  },
  detailLabel: {
    fontSize: fontSize.micro,
    color: colors.secondaryLabel,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  detailValue: {
    fontSize: fontSize.small,
    fontWeight: "700",
    color: colors.label,
    fontVariant: ["tabular-nums"],
  },
});
