import type { FunctionReturnType } from "convex/server";
import { type Href, useRouter } from "expo-router";
import { briefingPayloadSchema } from "@tasky/home-feed/widgets";
import { useCallback, useEffect, useMemo, useState } from "react";
import Markdown, {
  type RenderRules,
} from "react-native-markdown-display";
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
  getSignalQueryTime,
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

const briefingMarkdownRules: RenderRules = {
  image: () => null,
};

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

function BriefingCard() {
  const taskyAuth = useTaskyAuth();
  const taskyEnabled =
    taskyAuth.isAuthenticated && taskyAuth.convexAuthenticated;
  const latest = useTaskyQuery(
    taskyApi.widgetData.latest,
    taskyEnabled ? { kind: "briefing" } : "skip",
  );
  const briefing = useMemo(() => {
    if (!latest.data) return null;
    try {
      return briefingPayloadSchema.safeParse(JSON.parse(latest.data.dataJson));
    } catch {
      return null;
    }
  }, [latest.data]);

  if (!taskyEnabled || latest.isLoading || !briefing?.success) return null;

  const published = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(latest.data!.createdAt);

  return (
    <View style={[sharedStyles.card, styles.briefingCard]}>
      <CardHeader
        title="Briefing"
        trailing={<Text style={styles.briefingTime}>{published}</Text>}
      />
      <Markdown
        style={markdownStyles}
        rules={briefingMarkdownRules}
        onLinkPress={(url) => /^https?:\/\//i.test(url)}
      >
        {briefing.data.markdown}
      </Markdown>
    </View>
  );
}

function SignalsCard() {
  const router = useRouter();
  const taskyAuth = useTaskyAuth();
  const now = useSignalClock();
  const queryNow = getSignalQueryTime(now);
  const periodBounds = getSignalPeriodBounds(queryNow);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const taskyEnabled =
    taskyAuth.isAuthenticated && taskyAuth.convexAuthenticated;
  const signals = useTaskyQuery(
    taskyApi.signals.listDashboard,
    taskyEnabled
      ? {
          now: queryNow,
          soonWindowMs: SIGNAL_SOON_WINDOW_MS,
          periodBounds,
        }
      : "skip",
  );
  const recordSignal = useTaskyMutation(taskyApi.signals.record);
  const weightSignals = (signals.data ?? []).filter(
    (signal) => signal.name === "Weight",
  );
  const weightSignal =
    weightSignals.length === 1 ? weightSignals[0] : undefined;
  const showScaleCard =
    weightSignal?.model.kind === "activity" &&
    weightSignal.model.measurementFields?.length === 1 &&
    weightSignal.model.measurementFields[0] === "weight" &&
    !weightSignal.evaluation.isComplete;
  const actionableSignals = (signals.data ?? [])
    .filter(
      (signal) =>
        (signal.actionability.tier === "overdue" ||
          signal.actionability.tier === "ready") &&
        (!showScaleCard || signal.id !== weightSignal?.id),
    )
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
          title="Signals"
          trailing={<Text style={styles.connectLink}>Connect</Text>}
        />
      </TouchableOpacity>
    );
  }

  return (
    <>
      <View style={[sharedStyles.card, styles.signalsCard]}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => router.push("/signals_page" as Href)}
        >
          <CardHeader title="Signals" />
        </TouchableOpacity>
        {!taskyEnabled || signals.isLoading ? (
          <View style={sharedStyles.inlineLoading}>
            <ActivityIndicator />
          </View>
        ) : actionableSignals.length === 0 ? (
          <TouchableOpacity
            onPress={() => router.push("/signals_page" as Href)}
          >
            <Text style={styles.allOnTrack}>
              {signals.data?.length
                ? showScaleCard
                  ? "No other signals need attention."
                  : "No signals need attention."
                : "Add your first activity or inventory signal."}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.signalList}>
            {actionableSignals.map((signal, index) => (
              <View key={signal.id}>
                {index > 0 ? <View style={styles.signalDivider} /> : null}
                <SignalRow
                  signal={signal}
                  now={now}
                  compact
                  onPress={() => openSignal(signal.id)}
                  onQuickAction={() => void handleQuickAction(signal)}
                  quickActionLabel={
                    signal.model.kind === "activity" ? "Done" : "Update"
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
      {showScaleCard ? <ScaleCard /> : null}
    </>
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
  const queryNow = getSignalQueryTime(now);
  const periodBounds = getSignalPeriodBounds(queryNow);
  const taskyEnabled =
    taskyAuth.isAuthenticated && taskyAuth.convexAuthenticated;
  const scorecards = useTaskyQuery(
    taskyApi.scorecards.list,
    taskyEnabled
      ? {
          now: queryNow,
          soonWindowMs: SIGNAL_SOON_WINDOW_MS,
          periodBounds,
        }
      : "skip",
  );
  const items = useMemo(() => {
    const listed = scorecards.data ?? [];
    const nestedIds = new Set(
      listed.flatMap((scorecard) =>
        scorecard.members.flatMap((member) =>
          member.type === "scorecard" ? [member.scorecardId] : [],
        ),
      ),
    );
    return listed.filter((scorecard) => !nestedIds.has(scorecard.id));
  }, [scorecards.data]);

  if (!taskyAuth.isAuthenticated) {
    return (
      <TouchableOpacity
        style={[sharedStyles.card, styles.heroCard]}
        activeOpacity={0.85}
        onPress={() => router.push("/settings_page")}
      >
        <CardHeader
          title="Scorecards"
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
        <CardHeader title="Scorecards" />
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
                        : scorecard.evaluation.attention === "due"
                          ? colors.systemRed
                          : scorecard.evaluation.attention === "soon"
                            ? colors.systemOrange
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

function ScaleCard() {
  const router = useRouter();

  return (
    <TouchableOpacity
      style={sharedStyles.card}
      activeOpacity={0.85}
      onPress={() => router.push("/scale_page" as Href)}
    >
      <CardHeader
        title="Weight"
        subtitle="Connect your scale and log a weigh-in"
      />
    </TouchableOpacity>
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
          title="Tasks"
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
        title="Tasks"
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
                <Text style={sharedStyles.muted}>
                  Daily change needs a prior snapshot
                </Text>
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
        <BriefingCard />
        <TodayCard />
        <SignalsCard />
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

const markdownStyles = StyleSheet.create({
  body: {
    color: colors.label,
    fontSize: fontSize.body,
    lineHeight: 22,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: spacing.md,
  },
  heading1: {
    color: colors.label,
    fontSize: fontSize.subhead,
    fontWeight: "800",
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  heading2: {
    color: colors.label,
    fontSize: fontSize.body,
    fontWeight: "800",
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  heading3: {
    color: colors.label,
    fontSize: fontSize.body,
    fontWeight: "700",
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  bullet_list: {
    marginBottom: spacing.md,
  },
  ordered_list: {
    marginBottom: spacing.md,
  },
  link: {
    color: colors.systemBlue,
  },
  blockquote: {
    backgroundColor: colors.tertiarySystemGroupedBackground,
    borderLeftColor: colors.separator,
    borderLeftWidth: 3,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  code_inline: {
    color: colors.label,
    backgroundColor: colors.tertiarySystemGroupedBackground,
  },
  fence: {
    color: colors.label,
    backgroundColor: colors.tertiarySystemGroupedBackground,
  },
});

const styles = StyleSheet.create({
  briefingCard: {
    paddingBottom: spacing.sm,
  },
  briefingTime: {
    color: colors.secondaryLabel,
    fontSize: fontSize.caption,
  },
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
    width: 112,
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
