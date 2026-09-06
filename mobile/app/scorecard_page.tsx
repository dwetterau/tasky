import type { FunctionArgs } from "convex/server";
import { type Href, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SignalRow } from "@/components/SignalRow";
import { automaticKeyboardInsets, iosHeaderTextItems } from "@/lib/headerItems";
import {
  createSignalIdempotencyKey,
  getSignalPeriodBounds,
  SIGNAL_SOON_WINDOW_MS,
  type ScorecardItem,
  type SignalDashboardItem,
  useSignalClock,
} from "@/lib/signals";
import { taskyApi, useTaskyAuth, useTaskyMutation, useTaskyQuery } from "@/lib/tasky";
import { colors, fontSize, radius, sharedStyles, spacing } from "@/lib/theme";

type ScorecardId = FunctionArgs<typeof taskyApi.scorecards.get>["scorecardId"];

function signalDetailsRoute(signalId: string) {
  return {
    pathname: "/signal_history_page" as const,
    params: { signalId },
  } as unknown as Href;
}

function scorecardEditRoute(scorecardId: string) {
  return {
    pathname: "/scorecard_edit_page" as const,
    params: { scorecardId },
  } as unknown as Href;
}

function formatPercent(ratio: number): string {
  return `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
}

function sortMembers(
  members: ScorecardItem["members"],
  role: "required" | "optional",
) {
  return members
    .filter((member) => member.role === role)
    .slice()
    .sort((left, right) => {
      if (left.evaluation.isComplete === right.evaluation.isComplete) {
        return 0;
      }
      return left.evaluation.isComplete ? 1 : -1;
    });
}

function MemberRow({
  member,
  signal,
  now,
  savingId,
  onOpen,
  onQuickAction,
}: {
  member: ScorecardItem["members"][number];
  signal: SignalDashboardItem | undefined;
  now: number;
  savingId: string | null;
  onOpen: () => void;
  onQuickAction: (signal: SignalDashboardItem) => void;
}) {
  if (!signal) {
    return (
      <View style={styles.fallbackRow}>
        <Text style={styles.fallbackTitle}>{member.name}</Text>
        <Text style={styles.fallbackDetail}>
          {member.evaluation.reason ??
            (member.evaluation.isComplete ? "Done" : "Not complete")}
        </Text>
      </View>
    );
  }

  return (
    <SignalRow
      signal={signal}
      now={now}
      onPress={onOpen}
      onQuickAction={() => onQuickAction(signal)}
      quickActionLabel={
        signal.model.kind === "activity"
          ? (signal.model.measurementFields?.length ?? 0) > 0
            ? "Log"
            : "Done"
          : "Update"
      }
      isSaving={savingId === signal.id}
    />
  );
}

function MemberSection({
  title,
  members,
  signalById,
  now,
  savingId,
  onOpen,
  onQuickAction,
}: {
  title: string;
  members: ScorecardItem["members"];
  signalById: Map<string, SignalDashboardItem>;
  now: number;
  savingId: string | null;
  onOpen: (signalId: string) => void;
  onQuickAction: (signal: SignalDashboardItem) => void;
}) {
  if (members.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <Text style={sharedStyles.sectionTitle}>{title}</Text>
      <View style={styles.listCard}>
        {members.map((member, index) => (
          <View key={member.signalId}>
            {index > 0 ? <View style={styles.divider} /> : null}
            <MemberRow
              member={member}
              signal={signalById.get(member.signalId)}
              now={now}
              savingId={savingId}
              onOpen={() => onOpen(member.signalId)}
              onQuickAction={onQuickAction}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

export default function ScorecardPage() {
  const router = useRouter();
  const params = useLocalSearchParams<{ scorecardId?: string }>();
  const rawScorecardId = Array.isArray(params.scorecardId)
    ? params.scorecardId[0]
    : params.scorecardId;
  const scorecardId = rawScorecardId as ScorecardId | undefined;
  const taskyAuth = useTaskyAuth();
  const now = useSignalClock();
  const periodBounds = getSignalPeriodBounds(now);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const taskyEnabled =
    taskyAuth.isAuthenticated && taskyAuth.convexAuthenticated;

  const scorecard = useTaskyQuery(
    taskyApi.scorecards.get,
    taskyEnabled && scorecardId
      ? {
          scorecardId,
          now,
          soonWindowMs: SIGNAL_SOON_WINDOW_MS,
          periodBounds,
        }
      : "skip",
  );
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

  const signalById = useMemo(
    () =>
      new Map((signals.data ?? []).map((signal) => [signal.id, signal] as const)),
    [signals.data],
  );
  const required = useMemo(
    () => sortMembers(scorecard.data?.members ?? [], "required"),
    [scorecard.data?.members],
  );
  const optional = useMemo(
    () => sortMembers(scorecard.data?.members ?? [], "optional"),
    [scorecard.data?.members],
  );

  const openSignal = (signalId: string) => {
    router.push(signalDetailsRoute(signalId));
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
        idempotencyKey: createSignalIdempotencyKey("scorecard-activity"),
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
      <View style={[sharedStyles.screen, styles.center]}>
        <Text style={sharedStyles.muted}>Connect Tasky to view scorecards.</Text>
      </View>
    );
  }

  if (!scorecardId || (scorecard.data === undefined && !scorecard.error)) {
    return (
      <View style={[sharedStyles.screen, styles.center]}>
        <ActivityIndicator />
      </View>
    );
  }

  const card = scorecard.data;
  if (!card) {
    return (
      <View style={[sharedStyles.screen, styles.center]}>
        <Text style={sharedStyles.error}>
          {scorecard.error ?? "Scorecard not found"}
        </Text>
      </View>
    );
  }

  const quota = card.optionalQuota;
  const blocking =
    quota > 0
      ? `${card.evaluation.optionalDoneCount} of ${quota} optionals`
      : undefined;

  return (
    <>
      <Stack.Screen
        options={{
          title: card.name,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push(scorecardEditRoute(card.id))}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Edit scorecard"
            >
              <Text style={styles.headerAction}>Edit</Text>
            </TouchableOpacity>
          ),
          unstable_headerRightItems: () =>
            iosHeaderTextItems([
              {
                label: "Edit",
                onPress: () => router.push(scorecardEditRoute(card.id)),
              },
            ]),
        }}
      />
      <ScrollView
        style={sharedStyles.screen}
        contentContainerStyle={sharedStyles.screenContent}
        {...automaticKeyboardInsets}
      >
        <View style={sharedStyles.card}>
          <View style={styles.summaryHeader}>
            <Text style={styles.summaryStatus}>
              {card.evaluation.isComplete ? "Done" : (blocking ?? "Not done")}
            </Text>
            <Text style={styles.percent}>
              {formatPercent(card.evaluation.ratio)}
            </Text>
          </View>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                {
                  width: `${Math.min(100, Math.max(0, card.evaluation.ratio * 100))}%`,
                  backgroundColor: card.evaluation.isComplete
                    ? colors.systemGreen
                    : colors.systemBlue,
                },
              ]}
            />
          </View>
        </View>

        <MemberSection
          title="Required"
          members={required}
          signalById={signalById}
          now={now}
          savingId={savingId}
          onOpen={openSignal}
          onQuickAction={(signal) => void handleQuickAction(signal)}
        />
        <MemberSection
          title={
            optional.length > 0
              ? `Optional · ${optional.filter((member) => member.evaluation.isComplete).length} of ${optional.length} done`
              : "Optional"
          }
          members={optional}
          signalById={signalById}
          now={now}
          savingId={savingId}
          onOpen={openSignal}
          onQuickAction={(signal) => void handleQuickAction(signal)}
        />

        {error || scorecard.error || signals.error ? (
          <Text style={sharedStyles.error}>
            {error ?? scorecard.error ?? signals.error}
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    padding: spacing.xl,
    justifyContent: "center",
    alignItems: "center",
  },
  headerAction: {
    color: colors.systemBlue,
    fontSize: fontSize.bodyLg,
    fontWeight: "600",
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  summaryStatus: {
    color: colors.label,
    fontSize: fontSize.subhead,
    fontWeight: "700",
  },
  percent: {
    color: colors.secondaryLabel,
    fontSize: fontSize.small,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
  },
  track: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.tertiarySystemGroupedBackground,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: radius.pill,
  },
  section: {
    gap: spacing.sm,
  },
  listCard: {
    overflow: "hidden",
    borderRadius: radius.lg,
    backgroundColor: colors.secondarySystemGroupedBackground,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.lg,
    backgroundColor: colors.separator,
  },
  fallbackRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  fallbackTitle: {
    color: colors.label,
    fontSize: fontSize.body,
    fontWeight: "600",
  },
  fallbackDetail: {
    color: colors.secondaryLabel,
    fontSize: fontSize.small,
  },
});
