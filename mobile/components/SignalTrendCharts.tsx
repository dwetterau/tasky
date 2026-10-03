import { matchFont } from "@shopify/react-native-skia";
import { useMemo } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { Bar, CartesianChart, Line, Scatter } from "victory-native";
import { formatSignalQuantity } from "@/lib/signals";
import {
  buildSignalTrendSeries,
  type SignalTrendSeries,
} from "@/lib/signalTrends";
import type { SignalDashboardItem, SignalEntry } from "@/lib/signals";
import { colors, fontSize, radius, spacing } from "@/lib/theme";

type ChartRow = {
  timestamp: number;
  value: number;
};

function formatAxisDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function TrendChart({ series }: { series: SignalTrendSeries }) {
  const dark = useColorScheme() === "dark";
  const axisColor = dark ? "#3a3a3c" : "#e5e7eb";
  const labelColor = dark ? "#8e8e93" : "#6b7280";
  const font = useMemo(
    () =>
      matchFont({
        fontFamily: Platform.OS === "ios" ? "Helvetica" : "sans-serif",
        fontSize: 10,
      }),
    [],
  );
  const latest = series.points.at(-1);
  const firstTimestamp = series.points[0]?.timestamp ?? 0;
  const lastTimestamp = latest?.timestamp ?? firstTimestamp;
  const halfDay = 12 * 60 * 60 * 1000;
  const xDomain: [number, number] =
    firstTimestamp === lastTimestamp
      ? [firstTimestamp - halfDay, lastTimestamp + halfDay]
      : [firstTimestamp, lastTimestamp];
  const minValue = series.points.reduce(
    (minimum, point) => Math.min(minimum, point.value),
    Number.POSITIVE_INFINITY,
  );
  const maxValue = series.points.reduce(
    (maximum, point) => Math.max(maximum, point.value),
    Number.NEGATIVE_INFINITY,
  );
  const yDomain: [number, number] | undefined =
    series.kind === "bar"
      ? [0, Math.max(maxValue, 1)]
      : minValue === maxValue
        ? [
            Math.max(0, minValue - Math.max(Math.abs(minValue) * 0.1, 1)),
            maxValue + Math.max(Math.abs(maxValue) * 0.1, 1),
          ]
        : undefined;
  const chartData: ChartRow[] = series.points;

  return (
    <View
      style={styles.chartCard}
      accessible
      accessibilityLabel={`${series.title} trend. Latest ${formatSignalQuantity(
        latest?.value ?? 0,
      )} ${series.unit}.`}
    >
      <View style={styles.chartHeader}>
        <View style={styles.chartHeading}>
          <Text style={styles.chartTitle}>{series.title}</Text>
          <Text style={styles.chartHint}>
            {series.lowerIsBetter
              ? "Lower is faster"
              : `Measured in ${series.unit}`}
          </Text>
        </View>
        {latest ? (
          <Text style={styles.latestValue}>
            {formatSignalQuantity(latest.value)}{" "}
            <Text style={styles.latestUnit}>{series.unit}</Text>
          </Text>
        ) : null}
      </View>

      <View style={styles.chart}>
        <CartesianChart
          data={chartData}
          xKey="timestamp"
          yKeys={["value"]}
          padding={{ left: 4, right: 8, top: 12, bottom: 4 }}
          domainPadding={{ top: 12 }}
          domain={{
            x: xDomain,
            ...(yDomain ? { y: yDomain } : {}),
          }}
          xAxis={{
            font,
            tickCount: 3,
            lineColor: axisColor,
            lineWidth: 0,
            labelColor,
            formatXLabel: formatAxisDate,
          }}
          yAxis={[
            {
              font,
              tickCount: 4,
              lineColor: axisColor,
              labelColor,
              formatYLabel: formatSignalQuantity,
            },
          ]}
        >
          {({ points, chartBounds }) =>
            series.kind === "bar" ? (
              <Bar
                points={points.value}
                chartBounds={chartBounds}
                color={series.color}
                barWidth={series.points.length <= 10 ? 24 : undefined}
                roundedCorners={{ topLeft: 4, topRight: 4 }}
              />
            ) : (
              <>
                <Line
                  points={points.value}
                  color={series.color}
                  strokeWidth={2.5}
                  curveType="monotoneX"
                />
                {series.points.length <= 12 ? (
                  <Scatter
                    points={points.value}
                    color={series.color}
                    radius={3}
                  />
                ) : null}
              </>
            )
          }
        </CartesianChart>
      </View>
    </View>
  );
}

export function SignalTrendCharts({
  signal,
  entries,
}: {
  signal: SignalDashboardItem;
  entries: SignalEntry[];
}) {
  const series = useMemo(
    () => buildSignalTrendSeries(signal, entries),
    [entries, signal],
  );
  if (series.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Trends</Text>
        <Text style={styles.sectionHint}>
          Based on the {entries.length} most recently loaded{" "}
          {entries.length === 1 ? "entry" : "entries"}
        </Text>
      </View>
      {series.map((item) => (
        <TrendChart key={item.id} series={item} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
  },
  sectionHeader: {
    gap: 2,
    paddingHorizontal: spacing.xs,
  },
  sectionTitle: {
    color: colors.secondaryLabel,
    fontSize: fontSize.caption,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  sectionHint: {
    color: colors.tertiaryLabel,
    fontSize: fontSize.micro,
  },
  chartCard: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.secondarySystemGroupedBackground,
  },
  chartHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  chartHeading: {
    flex: 1,
    gap: 2,
  },
  chartTitle: {
    color: colors.label,
    fontSize: fontSize.body,
    fontWeight: "700",
  },
  chartHint: {
    color: colors.tertiaryLabel,
    fontSize: fontSize.caption,
  },
  latestValue: {
    color: colors.label,
    fontSize: fontSize.body,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  latestUnit: {
    color: colors.secondaryLabel,
    fontWeight: "400",
  },
  chart: {
    height: 210,
  },
});
