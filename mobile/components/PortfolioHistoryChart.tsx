import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from "react-native";
import { matchFont } from "@shopify/react-native-skia";
import { CartesianChart, StackedArea } from "victory-native";
import {
  buildHistoricalChartData,
  sortTickersByLatestValue,
  type HoldingShares,
  type PriceHistoryPoint,
} from "tasky-convex/lib/portfolioHistory";
import {
  colors,
  fontSize,
  radius,
  sharedStyles,
  spacing,
  tone,
} from "@/lib/theme";

const TICKER_COLORS = [
  "#6366f1",
  "#059669",
  "#dc2626",
  "#f59e0b",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
  "#f97316",
  "#14b8a6",
];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatSignedCurrency(value: number): string {
  const formatted = formatCurrency(Math.abs(value));
  return `${value >= 0 ? "+" : "-"}${formatted}`;
}

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatShortDate(value: string | null): string {
  if (!value) return "Start";
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric" },
  );
}

function colorForTicker(ticker: string, allTickers: string[]): string {
  const index = Math.max(0, allTickers.indexOf(ticker));
  return TICKER_COLORS[index % TICKER_COLORS.length] ?? TICKER_COLORS[0];
}

function nextSelectedTickers(
  current: Set<string>,
  ticker: string,
  allTickers: string[],
): Set<string> {
  const allSelected =
    current.size === allTickers.length &&
    allTickers.every((item) => current.has(item));
  if (allSelected) {
    return new Set([ticker]);
  }
  if (current.size === 1 && current.has(ticker)) {
    return new Set(allTickers);
  }
  const next = new Set(current);
  if (next.has(ticker)) {
    next.delete(ticker);
  } else {
    next.add(ticker);
  }
  return next.size === 0 ? new Set(allTickers) : next;
}

type ChartRow = {
  timestamp: number;
} & Record<string, number>;

export function PortfolioHistoryChart({
  points,
  holdings,
  startDate,
  isLoading,
  error,
}: {
  points: PriceHistoryPoint[];
  holdings: HoldingShares[];
  startDate: string | null;
  isLoading: boolean;
  error: string | null;
}) {
  const colorScheme = useColorScheme();
  const chipsScrollRef = useRef<ScrollView>(null);
  const dark = colorScheme === "dark";
  const axisColor = dark ? "#3a3a3c" : "#e5e7eb";
  const labelColor = dark ? "#8e8e93" : "#6b7280";
  const holdingTickers = useMemo(
    () => holdings.map((holding) => holding.ticker),
    [holdings],
  );
  const [selectedTickers, setSelectedTickers] = useState<Set<string>>(
    () => new Set(holdingTickers),
  );

  useEffect(() => {
    setSelectedTickers((prev) => {
      if (prev.size > 0) return prev;
      return new Set(holdingTickers);
    });
  }, [holdingTickers]);

  const chartPoints = useMemo(
    () => buildHistoricalChartData(points, holdings, selectedTickers),
    [points, holdings, selectedTickers],
  );
  const stackedTickers = useMemo(
    () => sortTickersByLatestValue(selectedTickers, chartPoints),
    [selectedTickers, chartPoints],
  );
  const chartData = useMemo<ChartRow[]>(
    () =>
      chartPoints.map((point) => {
        const [year, month, day] = point.date.split("-").map(Number);
        const row: ChartRow = {
          timestamp: new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).getTime(),
        };
        for (const ticker of stackedTickers) {
          row[ticker] = point.tickerValues[ticker] ?? 0;
        }
        return row;
      }),
    [chartPoints, stackedTickers],
  );
  const font = useMemo(
    () =>
      matchFont({
        fontFamily: Platform.OS === "ios" ? "Helvetica" : "sans-serif",
        fontSize: 10,
      }),
    [],
  );

  const startValue = chartPoints[0]?.total ?? 0;
  const endValue = chartPoints[chartPoints.length - 1]?.total ?? 0;
  const change = endValue - startValue;
  const changePercent = startValue > 0 ? (change / startValue) * 100 : 0;
  const yMax = chartPoints.reduce(
    (max, point) => Math.max(max, point.total),
    0,
  );

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        <Text style={styles.headerHint}>
          {startDate ? `Since ${formatShortDate(startDate)}` : "Value over time"}
        </Text>
      </View>

      {holdingTickers.length > 0 ? (
        <ScrollView
          ref={chipsScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          onContentSizeChange={() => {
            chipsScrollRef.current?.scrollToEnd({ animated: false });
          }}
        >
          {holdingTickers.map((ticker) => {
            const selected = selectedTickers.has(ticker);
            const color = colorForTicker(ticker, holdingTickers);
            return (
              <TouchableOpacity
                key={ticker}
                onPress={() =>
                  setSelectedTickers((prev) =>
                    nextSelectedTickers(prev, ticker, holdingTickers),
                  )
                }
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? color : "transparent",
                    borderColor: selected ? color : (colors.separator as never),
                  },
                ]}
                hitSlop={4}
              >
                <Text
                  style={[
                    styles.chipText,
                    {
                      color: selected
                        ? "#ffffff"
                        : (colors.secondaryLabel as never),
                    },
                  ]}
                >
                  {ticker}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : null}

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={sharedStyles.muted}>Loading price history…</Text>
        </View>
      ) : error ? (
        <Text style={sharedStyles.error}>{error}</Text>
      ) : chartData.length === 0 ? (
        <Text style={sharedStyles.muted}>
          No historical prices yet. Sync prices to fetch the series used by this
          chart.
        </Text>
      ) : (
        <View style={styles.chart}>
          <CartesianChart
            data={chartData}
            xKey="timestamp"
            yKeys={stackedTickers}
            padding={{ left: 8, right: 8, top: 12, bottom: 4 }}
            domainPadding={{ top: 12 }}
            domain={{ y: [0, yMax] }}
            xAxis={{
              font,
              tickCount: 3,
              lineColor: axisColor,
              lineWidth: 0,
              labelColor,
              formatXLabel: (value) =>
                new Date(value).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                }),
            }}
            yAxis={[
              {
                font,
                tickCount: 4,
                lineColor: axisColor,
                labelColor,
                formatYLabel: (value) =>
                  value >= 1000
                    ? `$${(value / 1000).toFixed(0)}k`
                    : `$${value.toFixed(0)}`,
              },
            ]}
          >
            {({ points: seriesPoints, chartBounds }) => (
              <StackedArea
                points={stackedTickers.map((ticker) => seriesPoints[ticker])}
                y0={chartBounds.bottom}
                colors={stackedTickers.map((ticker) =>
                  colorForTicker(ticker, holdingTickers),
                )}
                curveType="linear"
              />
            )}
          </CartesianChart>
        </View>
      )}

      {chartPoints.length > 0 ? (
        <View style={styles.stats}>
          <HistoryStat
            label={`Start (${formatShortDate(chartPoints[0]?.date ?? startDate)})`}
            value={formatCurrency(startValue)}
          />
          <HistoryStat label="Latest" value={formatCurrency(endValue)} />
          <HistoryStat
            label="Change"
            value={`${formatSignedCurrency(change)} (${formatPercent(changePercent)})`}
            toneValue={change}
          />
          <HistoryStat label="Days" value={`${chartPoints.length}`} />
        </View>
      ) : null}
    </View>
  );
}

function HistoryStat({
  label,
  value,
  toneValue,
}: {
  label: string;
  value: string;
  toneValue?: number;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text
        style={[
          styles.statValue,
          toneValue !== undefined
            ? { color: tone(toneValue) as unknown as string }
            : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.secondarySystemGroupedBackground,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: fontSize.caption,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: colors.secondaryLabel,
    textTransform: "uppercase",
  },
  headerHint: {
    fontSize: fontSize.caption,
    color: colors.tertiaryLabel,
  },
  chips: {
    flexDirection: "row-reverse",
    flexGrow: 1,
    gap: spacing.sm,
    paddingVertical: 2,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  chipText: {
    fontSize: fontSize.caption,
    fontWeight: "700",
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 160,
  },
  chart: {
    height: 220,
  },
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  stat: {
    width: "47%",
    gap: 2,
  },
  statLabel: {
    fontSize: fontSize.micro,
    color: colors.secondaryLabel,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    fontWeight: "600",
  },
  statValue: {
    fontSize: fontSize.small,
    fontWeight: "700",
    color: colors.label,
    fontVariant: ["tabular-nums"],
  },
});
