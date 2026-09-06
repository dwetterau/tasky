import type { FunctionReturnType } from "convex/server";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  taskyApi,
  useTaskyAction,
  useTaskyAuth,
  useTaskyMutation,
  useTaskyQuery,
} from "@/lib/tasky";
import { SignalRow } from "@/components/SignalRow";
import {
  createSignalIdempotencyKey,
  getSignalPeriodBounds,
  SIGNAL_SOON_WINDOW_MS,
  type SignalDashboardItem,
  useSignalClock,
} from "@/lib/signals";
import {
  colors,
  fontSize,
  radius,
  sharedStyles,
  spacing,
  tone,
} from "@/lib/theme";

type PortfolioSnapshot = FunctionReturnType<
  typeof taskyApi.portfolio.getSnapshot
>;
type Task = FunctionReturnType<typeof taskyApi.tasks.list>[number];

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatSignedCurrency(value: number): string {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.abs(value));
  return `${value >= 0 ? "+" : "-"}${formatted}`;
}

function CardChevron() {
  return <Text style={styles.chevron}>{"›"}</Text>;
}

function CardHeader({
  title,
  accent,
  subtitle,
  trailing,
}: {
  title: string;
  accent?: string;
  subtitle?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <View style={styles.cardHeader}>
      <View style={styles.cardHeaderText}>
        <View style={styles.cardTitleRow}>
          {accent ? (
            <View style={[styles.cardAccent, { backgroundColor: accent }]} />
          ) : null}
          <Text style={styles.cardTitle}>{title}</Text>
        </View>
        {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
      </View>
      {trailing ?? <CardChevron />}
    </View>
  );
}

function SignalsCard() {
  const router = useRouter();
  const taskyAuth = useTaskyAuth();
  const now = useSignalClock();
  const periodBounds = getSignalPeriodBounds(now);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const taskyEnabled =
    taskyAuth.isAuthenticated && taskyAuth.convexAuthenticated;
  const signals = useTaskyQuery(
    taskyApi.signals.listDashboard,
    taskyEnabled
      ? {
          now,
          soonWindowMs: SIGNAL_SOON_WINDOW_MS,
          periodBounds,
        }
      : "skip",
  );
  const recordSignal = useTaskyMutation(taskyApi.signals.record);
  const dueCount =
    signals.data?.filter((signal) => signal.evaluation.attention === "due")
      .length ?? 0;
  const needsAttention = (signals.data ?? [])
    .filter((signal) => signal.evaluation.attention !== "ok")
    .slice(0, 3);

  const openSignal = (signalId: string) => {
    router.push({
      pathname: "/signal_history_page",
      params: { signalId },
    } as unknown as Href);
  };

  const handleQuickAction = async (signal: SignalDashboardItem) => {
    if (
      signal.model.kind === "inventory" ||
      (signal.model.measurementFields?.length ?? 0) > 0
    ) {
      openSignal(signal.id);
      return;
    }
    setSavingId(signal.id);
    setError(null);
    try {
      await recordSignal({
        signalId: signal.id,
        idempotencyKey: createSignalIdempotencyKey("home-activity"),
        operation: { type: "activity.occurred" },
        soonWindowMs: SIGNAL_SOON_WINDOW_MS,
        periodBounds,
      });
    } catch (recordError) {
      setError(
        recordError instanceof Error
          ? recordError.message
          : "Failed to record activity",
      );
    } finally {
      setSavingId(null);
    }
  };

  if (!taskyAuth.isAuthenticated) {
    return (
      <TouchableOpacity
        style={[sharedStyles.card, styles.signalsCard]}
        activeOpacity={0.85}
        onPress={() => router.push("/settings_page")}
      >
        <CardHeader
          title="Needs attention"
          subtitle="Connect Tasky to add life signals"
          trailing={<Text style={styles.connectLink}>Connect</Text>}
        />
      </TouchableOpacity>
    );
  }

  return (
    <View style={[sharedStyles.card, styles.signalsCard]}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => router.push("/signals_page" as Href)}
      >
        <CardHeader
          title="Needs attention"
          subtitle={
            !taskyEnabled || signals.isLoading
              ? "Loading signals…"
              : dueCount > 0
                ? `${dueCount} signal${dueCount === 1 ? "" : "s"} due`
                : needsAttention.length > 0
                  ? `${needsAttention.length} coming up`
                  : "Everything is on track"
          }
        />
      </TouchableOpacity>
      {!taskyEnabled || signals.isLoading ? (
        <View style={sharedStyles.inlineLoading}>
          <ActivityIndicator />
        </View>
      ) : needsAttention.length === 0 ? (
        <TouchableOpacity onPress={() => router.push("/signals_page" as Href)}>
          <Text style={styles.allOnTrack}>
            {signals.data?.length
              ? "No signals need attention."
              : "Add your first activity or inventory signal."}
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.signalList}>
          {needsAttention.map((signal, index) => (
            <View key={signal.id}>
              {index > 0 ? <View style={styles.signalDivider} /> : null}
              <SignalRow
                signal={signal}
                now={now}
                compact
                onPress={() => openSignal(signal.id)}
                onQuickAction={() => void handleQuickAction(signal)}
                quickActionLabel={
                  signal.model.kind === "activity"
                    ? (signal.model.measurementFields?.length ?? 0) > 0
                      ? "Log"
                      : "Done"
                    : "Update"
                }
                isSaving={savingId === signal.id}
              />
            </View>
          ))}
        </View>
      )}
      {error || signals.error ? (
        <Text style={sharedStyles.error}>{error ?? signals.error}</Text>
      ) : null}
    </View>
  );
}

function scorecardDetailRoute(scorecardId: string) {
  return {
    pathname: "/scorecard_page" as const,
    params: { scorecardId },
  } as unknown as Href;
}

function TodayCard() {
  const router = useRouter();
  const taskyAuth = useTaskyAuth();
  const now = useSignalClock();
  const periodBounds = getSignalPeriodBounds(now);
  const taskyEnabled =
    taskyAuth.isAuthenticated && taskyAuth.convexAuthenticated;
  const scorecards = useTaskyQuery(
    taskyApi.scorecards.list,
    taskyEnabled
      ? {
          now,
          soonWindowMs: SIGNAL_SOON_WINDOW_MS,
          periodBounds,
        }
      : "skip",
  );
  const items = scorecards.data ?? [];

  if (!taskyAuth.isAuthenticated) {
    return (
      <TouchableOpacity
        style={[sharedStyles.card, styles.heroCard]}
        activeOpacity={0.85}
        onPress={() => router.push("/settings_page")}
      >
        <CardHeader
          title="Today"
          trailing={<Text style={styles.connectLink}>Connect</Text>}
        />
      </TouchableOpacity>
    );
  }

  return (
    <View style={[sharedStyles.card, styles.heroCard]}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => router.push("/scorecards_page" as Href)}
      >
        <CardHeader title="Today" />
      </TouchableOpacity>
      {!taskyEnabled || scorecards.isLoading ? (
        <View style={sharedStyles.inlineLoading}>
          <ActivityIndicator />
        </View>
      ) : (
        <View style={styles.dailiesBars}>
          {items.map((scorecard) => (
            <TouchableOpacity
              key={scorecard.id}
              style={styles.dailiesBarRow}
              activeOpacity={0.7}
              onPress={() => router.push(scorecardDetailRoute(scorecard.id))}
            >
              <Text style={styles.dailiesBarLabel} numberOfLines={1}>
                {scorecard.name}
              </Text>
              <View style={styles.dailiesBarTrack}>
                <View
                  style={[
                    styles.dailiesBarFill,
                    {
                      backgroundColor: scorecard.evaluation.isComplete
                        ? colors.systemGreen
                        : (scorecard.tags[0]?.color ?? colors.systemBlue),
                      width: `${Math.min(100, Math.max(0, scorecard.evaluation.ratio * 100))}%`,
                    },
                  ]}
                />
              </View>
              <Text style={styles.dailiesBarValue}>
                {Math.round(
                  Math.min(1, Math.max(0, scorecard.evaluation.ratio)) * 100,
                )}
                %
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {scorecards.error ? (
        <Text style={sharedStyles.error}>{scorecards.error}</Text>
      ) : null}
    </View>
  );
}

function TaskyCard() {
  const router = useRouter();
  const taskyAuth = useTaskyAuth();
  const taskyEnabled =
    taskyAuth.isAuthenticated && taskyAuth.convexAuthenticated;

  const closedAfter = useMemo(() => Date.now() - 32 * 24 * 60 * 60 * 1000, []);
  const captures = useTaskyQuery(
    taskyApi.captures.list,
    taskyEnabled ? { includeCompleted: false } : "skip",
  );
  const tasks = useTaskyQuery(
    taskyApi.tasks.list,
    taskyEnabled ? { closedAfter } : "skip",
  );

  const captureCount = captures.data?.length ?? 0;
  const openTasks = useMemo<Task[]>(
    () => (tasks.data ?? []).filter((task: Task) => task.status !== "closed"),
    [tasks.data],
  );
  const urgentCount = useMemo(
    () =>
      openTasks.filter(
        (task: Task) => task.priority === "urgent" || task.priority === "high",
      ).length,
    [openTasks],
  );

  if (!taskyAuth.isAuthenticated) {
    return (
      <TouchableOpacity
        style={sharedStyles.card}
        activeOpacity={0.85}
        onPress={() => router.push("/settings_page")}
      >
        <CardHeader
          title="Tasky"
          subtitle="Connect to see your captures and tasks"
          trailing={<Text style={styles.connectLink}>Connect</Text>}
        />
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={sharedStyles.card}
      activeOpacity={0.85}
      onPress={() => router.push("/tasky_captures_page")}
    >
      <CardHeader
        title="Tasky"
        subtitle={
          !taskyEnabled
            ? "Refreshing session…"
            : captureCount === 0 && openTasks.length === 0
              ? "Inbox zero"
              : `${captureCount} capture${captureCount === 1 ? "" : "s"} · ${openTasks.length} task${openTasks.length === 1 ? "" : "s"} open`
        }
      />
      {!taskyEnabled ? (
        <View style={sharedStyles.inlineLoading}>
          <ActivityIndicator />
        </View>
      ) : (
        <View style={styles.statsRow}>
          <Stat
            label="Captures"
            value={captureCount}
            tone={captureCount > 0 ? colors.systemBlue : colors.secondaryLabel}
          />
          <Stat
            label="Open tasks"
            value={openTasks.length}
            tone={openTasks.length > 0 ? colors.label : colors.secondaryLabel}
          />
          <Stat
            label="High/Urgent"
            value={urgentCount}
            tone={urgentCount > 0 ? colors.systemRed : colors.secondaryLabel}
          />
        </View>
      )}
    </TouchableOpacity>
  );
}

function PortfolioCard() {
  const router = useRouter();
  const taskyAuth = useTaskyAuth();
  const taskyEnabled =
    taskyAuth.isAuthenticated && taskyAuth.convexAuthenticated;
  const getPortfolioSnapshot = useTaskyAction(taskyApi.portfolio.getSnapshot);
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    void refreshPortfolio();
  }, [refreshPortfolio]);

  if (!taskyAuth.isAuthenticated) {
    return null;
  }

  const renderBody = () => {
    if (!taskyEnabled || (isLoading && !portfolio)) {
      return (
        <View style={sharedStyles.inlineLoading}>
          <ActivityIndicator />
          <Text style={sharedStyles.muted}>Loading portfolio…</Text>
        </View>
      );
    }
    if (portfolio?.status === "ok") {
      const { summary } = portfolio;
      const dayHas = summary.dayReturn !== null;
      return (
        <View style={styles.portfolioBody}>
          <View style={styles.statsRow}>
            {dayHas ? (
              <>
                <Stat
                  label="Today"
                  value={formatSignedCurrency(summary.dayReturn!)}
                  tone={tone(summary.dayReturn!)}
                />
                <Stat
                  label="Today %"
                  value={
                    summary.dayReturnPercent !== null
                      ? formatPercent(summary.dayReturnPercent)
                      : "n/a"
                  }
                  tone={tone(summary.dayReturn!)}
                />
              </>
            ) : (
              <View style={styles.portfolioEmptyDay}>
                <Text style={sharedStyles.muted}>No price data today</Text>
              </View>
            )}
            <Stat
              label="Overall"
              value={formatPercent(summary.gainLossPercent)}
              tone={tone(summary.gainLoss)}
            />
          </View>
        </View>
      );
    }
    if (portfolio?.status === "no_credentials") {
      return (
        <TouchableOpacity onPress={() => router.push("/settings_page")}>
          <Text style={sharedStyles.muted}>
            Add Airtable + Schwab credentials in Tasky settings to enable this
            view.
          </Text>
        </TouchableOpacity>
      );
    }
    return (
      <Text style={sharedStyles.error}>
        {portfolio?.message ?? error ?? "Portfolio data unavailable."}
      </Text>
    );
  };

  return (
    <TouchableOpacity
      style={sharedStyles.card}
      activeOpacity={0.85}
      onPress={() => router.push("/portfolio_page")}
    >
      <CardHeader title="Portfolio" />
      {renderBody()}
    </TouchableOpacity>
  );
}

function Stat({
  label,
  value,
  tone: valueColor,
}: {
  label: string;
  value: string | number;
  tone?: unknown;
}) {
  return (
    <View style={styles.statItem}>
      <Text
        style={[
          styles.statValue,
          valueColor ? { color: valueColor as unknown as string } : undefined,
        ]}
      >
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function FloatingSettingsButton() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      style={[
        styles.floatingSettings,
        {
          left: spacing.xl,
          bottom: insets.bottom + spacing.lg,
        },
      ]}
      onPress={() => router.push("/settings_page")}
      hitSlop={8}
    >
      <Text style={styles.floatingSettingsIcon}>{"\u2699"}</Text>
    </TouchableOpacity>
  );
}

export default function HomePage() {
  const insets = useSafeAreaInsets();
  return (
    <View style={sharedStyles.screen}>
      <ScrollView
        style={sharedStyles.screen}
        contentContainerStyle={[
          sharedStyles.screenContent,
          {
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.xxl + 56,
          },
        ]}
      >
        <SignalsCard />
        <TodayCard />
        <TaskyCard />
        <PortfolioCard />
      </ScrollView>
      <FloatingSettingsButton />
    </View>
  );
}

// Kept for the entry/login screen so we don't break its import.
export const HOME_PAGE_STYLES = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.systemGroupedBackground,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  entryTitle: {
    fontSize: fontSize.display,
    fontWeight: "800",
    color: colors.label,
    marginBottom: spacing.md,
  },
});

const styles = StyleSheet.create({
  signalsCard: {
    paddingBottom: spacing.sm,
  },
  signalList: {
    overflow: "hidden",
  },
  signalDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.xl,
    backgroundColor: colors.separator,
  },
  allOnTrack: {
    paddingVertical: spacing.md,
    color: colors.secondaryLabel,
    fontSize: fontSize.small,
    textAlign: "center",
  },
  heroCard: {
    paddingBottom: spacing.lg,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  cardHeaderText: {
    flex: 1,
    gap: spacing.xs,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  cardAccent: {
    width: 4,
    height: 18,
    borderRadius: radius.sm,
  },
  cardTitle: {
    fontSize: fontSize.heading,
    fontWeight: "800",
    color: colors.label,
  },
  cardSubtitle: {
    fontSize: fontSize.small,
    color: colors.secondaryLabel,
  },
  chevron: {
    fontSize: 26,
    fontWeight: "300",
    color: colors.tertiaryLabel,
    marginLeft: spacing.sm,
  },
  connectLink: {
    fontSize: fontSize.body,
    fontWeight: "700",
    color: colors.systemBlue,
  },
  dailiesBars: {
    gap: spacing.sm,
  },
  dailiesBarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  dailiesBarLabel: {
    width: 70,
    fontSize: fontSize.small,
    fontWeight: "600",
    color: colors.label,
  },
  dailiesBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.tertiarySystemGroupedBackground,
    overflow: "hidden",
  },
  dailiesBarFill: {
    height: "100%",
    borderRadius: radius.pill,
  },
  dailiesBarValue: {
    width: 44,
    textAlign: "right",
    fontSize: fontSize.caption,
    fontVariant: ["tabular-nums"],
    color: colors.secondaryLabel,
  },
  statsRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  statItem: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.tertiarySystemGroupedBackground,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  statValue: {
    fontSize: fontSize.subhead,
    fontWeight: "700",
    color: colors.label,
    fontVariant: ["tabular-nums"],
  },
  statLabel: {
    fontSize: fontSize.micro,
    color: colors.secondaryLabel,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  portfolioBody: {
    gap: spacing.md,
  },
  portfolioEmptyDay: {
    flex: 2,
    justifyContent: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.tertiarySystemGroupedBackground,
    borderRadius: radius.md,
  },
  floatingSettings: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.secondarySystemGroupedBackground,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  floatingSettingsIcon: {
    fontSize: 22,
    color: colors.label,
  },
});
