import { useCallback, useMemo, useState } from "react";
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
import { matchFont, Rect } from "@shopify/react-native-skia";
import {
  CartesianChart,
  StackedArea,
  useChartPressState,
} from "victory-native";
import { runOnJS, useAnimatedReaction } from "react-native-reanimated";
import {
  colors,
  fontSize,
  radius,
  sharedStyles,
  spacing,
  tone,
} from "@/lib/theme";
import {
  buildHoldingSeries,
  holdingSeriesKey,
} from "@/lib/portfolioHistory";

const HOLDING_COLORS = [
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

function colorForHolding(key: string, allKeys: string[]): string {
  const index = Math.max(0, allKeys.indexOf(key));
  return HOLDING_COLORS[index % HOLDING_COLORS.length] ?? HOLDING_COLORS[0];
}

function nextSelectedHoldings(
  current: Set<string>,
  key: string,
  allKeys: string[],
): Set<string> {
  const allSelected =
    current.size === allKeys.length &&
    allKeys.every((item) => current.has(item));
  if (allSelected) {
    return new Set([key]);
  }
  if (current.size === 1 && current.has(key)) {
    return new Set(allKeys);
  }
  const next = new Set(current);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next.size === 0 ? new Set(allKeys) : next;
}

type ChartRow = {
  timestamp: number;
} & Record<string, number>;

type SnapshotHistoryPoint = {
  date: string;
  totalValue: number;
  totalCostBasis: number;
  holdings: {
    ticker: string;
    name: string;
    value: number;
    costBasis: number;
  }[];
};

export function PortfolioHistoryChart({
  points,
  startDate,
  isLoading,
  error,
}: {
  points: SnapshotHistoryPoint[];
  startDate: string | null;
  isLoading: boolean;
  error: string | null;
}) {
  const colorScheme = useColorScheme();
  const dark = colorScheme === "dark";
  const axisColor = dark ? "#3a3a3c" : "#e5e7eb";
  const labelColor = dark ? "#8e8e93" : "#6b7280";
  const holdings = useMemo(() => buildHoldingSeries(points), [points]);
  const holdingKeys = useMemo(
    () => holdings.map((holding) => holdingSeriesKey(holding.ticker)),
    [holdings],
  );
  const holdingLabels = useMemo(
    () =>
      new Map(
        holdings.map((holding) => [
          holdingSeriesKey(holding.ticker),
          holding.ticker || "Cash",
        ]),
      ),
    [holdings],
  );
  const [selectedHoldings, setSelectedHoldings] = useState<Set<string> | null>(
    null,
  );
  const activeHoldings = useMemo(
    () => selectedHoldings ?? new Set(holdingKeys),
    [holdingKeys, selectedHoldings],
  );

  const chartPoints = useMemo(
    () =>
      points.map((point) => {
        const selected = point.holdings.filter((holding) =>
          activeHoldings.has(holdingSeriesKey(holding.ticker)),
        );
        return {
          ...point,
          totalValue: selected.reduce((sum, holding) => sum + holding.value, 0),
          totalCostBasis: selected.reduce(
            (sum, holding) => sum + holding.costBasis,
            0,
          ),
        };
      }),
    [activeHoldings, points],
  );
  const stackedHoldings = useMemo(
    () => holdingKeys.filter((key) => activeHoldings.has(key)),
    [activeHoldings, holdingKeys],
  );
  const chartData = useMemo<ChartRow[]>(
    () =>
      chartPoints.map((point) => {
        const [year, month, day] = point.date.split("-").map(Number);
        const row: ChartRow = {
          timestamp: new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).getTime(),
        };
        for (const key of stackedHoldings) {
          row[key] =
            point.holdings.find(
              (holding) => holdingSeriesKey(holding.ticker) === key,
            )
              ?.value ?? 0;
        }
        return row;
      }),
    [chartPoints, stackedHoldings],
  );
  const pressInitialValues = useMemo(
    () => ({
      x: chartData[chartData.length - 1]?.timestamp ?? 0,
      y: Object.fromEntries(
        stackedHoldings.map((key) => [key, 0]),
      ) as Record<string, number>,
    }),
    [chartData, stackedHoldings],
  );
  const { state: pressState, isActive: isPressActive } =
    useChartPressState(pressInitialValues);
  const [inspection, setInspection] = useState<{
    index: number;
    chartData: ChartRow[];
  } | null>(null);
  const recordInspection = useCallback(
    (index: number) => setInspection({ index, chartData }),
    [chartData],
  );
  useAnimatedReaction(
    () => pressState.matchedIndex.value,
    (index, previousIndex) => {
      if (index >= 0 && index !== previousIndex) {
        runOnJS(recordInspection)(index);
      }
    },
    [pressState, recordInspection],
  );
  const font = useMemo(
    () =>
      matchFont({
        fontFamily: Platform.OS === "ios" ? "Helvetica" : "sans-serif",
        fontSize: 10,
      }),
    [],
  );

  const startValue = chartPoints[0]?.totalValue ?? 0;
  const endValue = chartPoints[chartPoints.length - 1]?.totalValue ?? 0;
  const latestCostBasis =
    chartPoints[chartPoints.length - 1]?.totalCostBasis ?? 0;
  const change = endValue - startValue;
  const changePercent = startValue > 0 ? (change / startValue) * 100 : 0;
  const yMax = chartPoints.reduce(
    (max, point) => Math.max(max, point.totalValue),
    0,
  );
  const inspectedIndex =
    inspection?.chartData === chartData ? inspection.index : null;
  const inspectedPoint =
    inspectedIndex === null ? null : (chartPoints[inspectedIndex] ?? null);
  const inspectedTimestamp =
    inspectedIndex === null ? null : (chartData[inspectedIndex]?.timestamp ?? null);
  const chartMidpoint =
    ((chartData[0]?.timestamp ?? 0) +
      (chartData[chartData.length - 1]?.timestamp ?? 0)) /
    2;
  const inspectionOnLeft =
    inspectedTimestamp !== null && inspectedTimestamp >= chartMidpoint;
  const previousInspectedPoint =
    inspectedIndex === null || inspectedIndex === 0
      ? null
      : (chartPoints[inspectedIndex - 1] ?? null);
  const inspectedDayPercent =
    inspectedPoint && previousInspectedPoint?.totalValue
      ? ((inspectedPoint.totalValue - previousInspectedPoint.totalValue) /
          previousInspectedPoint.totalValue) *
        100
      : null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        <Text style={styles.headerHint}>
          {startDate
            ? `Since ${formatShortDate(startDate)}`
            : "Value over time"}
        </Text>
      </View>

      {holdingKeys.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {holdingKeys.map((key) => {
            const selected = activeHoldings.has(key);
            const color = colorForHolding(key, holdingKeys);
            return (
              <TouchableOpacity
                key={key}
                onPress={() =>
                  setSelectedHoldings((prev) =>
                    nextSelectedHoldings(
                      prev ?? new Set(holdingKeys),
                      key,
                      holdingKeys,
                    ),
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
                  {holdingLabels.get(key) ?? key}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : null}

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={sharedStyles.muted}>Loading portfolio history…</Text>
        </View>
      ) : error ? (
        <Text style={sharedStyles.error}>{error}</Text>
      ) : chartData.length === 0 ? (
        <Text style={sharedStyles.muted}>
          No account snapshots yet. Sync this portfolio to create today&apos;s
          snapshot.
        </Text>
      ) : (
        <View style={styles.chart}>
          {inspectedPoint ? (
            <View
              pointerEvents="none"
              style={[
                styles.inspection,
                inspectionOnLeft
                  ? styles.inspectionLeft
                  : styles.inspectionRight,
              ]}
              accessible
              accessibilityLiveRegion="polite"
            >
              <Text style={styles.inspectionDate}>
                {formatShortDate(inspectedPoint.date)}
              </Text>
              <Text style={styles.inspectionValue}>
                {formatCurrency(inspectedPoint.totalValue)}
                {" · "}
                {inspectedDayPercent === null
                  ? "No prior day"
                  : `${formatPercent(inspectedDayPercent)} day`}
              </Text>
            </View>
          ) : null}
            <CartesianChart
              data={chartData}
              xKey="timestamp"
              yKeys={stackedHoldings}
              chartPressState={pressState}
              padding={{ left: 8, right: 8, top: 12, bottom: 4 }}
              domainPadding={{ top: 12 }}
              domain={{ y: [0, Math.max(yMax, 1)] }}
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
                <>
                  <StackedArea
                    points={stackedHoldings.map((key) => seriesPoints[key])}
                    y0={chartBounds.bottom}
                    colors={stackedHoldings.map((key) =>
                      colorForHolding(key, holdingKeys),
                    )}
                    curveType="linear"
                  />
                  {isPressActive || inspectedPoint ? (
                    <Rect
                      x={pressState.x.position}
                      y={chartBounds.top}
                      width={1}
                      height={chartBounds.bottom - chartBounds.top}
                      color={labelColor}
                      opacity={0.65}
                    />
                  ) : null}
                </>
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
          <HistoryStat
            label="Cost basis"
            value={formatCurrency(latestCostBasis)}
          />
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
    flexDirection: "row",
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
  inspection: {
    position: "absolute",
    top: spacing.xs,
    zIndex: 1,
    alignItems: "flex-end",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.secondarySystemGroupedBackground,
    gap: 2,
  },
  inspectionLeft: {
    left: spacing.sm,
  },
  inspectionRight: {
    right: spacing.sm,
  },
  inspectionDate: {
    fontSize: fontSize.caption,
    color: colors.secondaryLabel,
    fontWeight: "600",
  },
  inspectionValue: {
    fontSize: fontSize.small,
    color: colors.label,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
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
