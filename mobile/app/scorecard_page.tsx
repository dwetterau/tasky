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
import { SignalRow, statusDotColor } from "@/components/SignalRow";
import { automaticKeyboardInsets, iosHeaderTextItems } from "@/lib/headerItems";
import {
  createSignalIdempotencyKey,
  getSignalPeriodBounds,
  nestedScorecardDetail,
  scorecardHeadline,
  scorecardMemberDot,
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

function scorecardDetailRoute(scorecardId: string) {
  return {
    pathname: "/scorecard_page" as const,
    params: { scorecardId },
  } as unknown as Href;
}

function memberKey(member: ScorecardItem["members"][number]): string {
  return member.type === "scorecard" ? member.scorecardId : member.signalId;
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
      <TouchableOpacity style={styles.fallbackRow} onPress={onOpen}>
        <Text style={styles.fallbackTitle}>{member.name}</Text>
        <View style={styles.fallbackDetailRow}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: statusDotColor(scorecardMemberDot(member)) },
            ]}
          />
          <Text style={styles.fallbackDetail}>
            {nestedScorecardDetail(member)}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <SignalRow
      signal={signal}
      now={now}
      statusDot={scorecardMemberDot(member)}
      onPress={onOpen}
      onQuickAction={() => onQuickAction(signal)}
      quickActionLabel={
        signal.model.kind === "activity" ? "Done" : "Update"
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
  onOpen: (member: ScorecardItem["members"][number]) => void;
  onQuickAction: (signal: SignalDashboardItem) => void;
}) {
  if (members.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      {title ? <Text style={sharedStyles.sectionTitle}>{title}</Text> : null}
      <View style={styles.listCard}>
        {members.map((member, index) => (
          <View key={memberKey(member)}>
            {index > 0 ? <View style={styles.divider} /> : null}
            <MemberRow
              member={member}
              signal={
                member.type === "signal"
                  ? signalById.get(member.signalId)
                  : undefined
              }
              now={now}
              savingId={savingId}
              onOpen={() => onOpen(member)}
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

  const openMember = (member: ScorecardItem["members"][number]) => {
    if (member.type === "scorecard") {
      router.push(scorecardDetailRoute(member.scorecardId));
      return;
    }
    openSignal(member.signalId);
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

  const counted = card.targetCount !== undefined;
  const listedMembers = counted ? card.members : [...required, ...optional];

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
              {scorecardHeadline(card)}
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

        {counted ? (
          <MemberSection
            title=""
            members={listedMembers}
            signalById={signalById}
            now={now}
            savingId={savingId}
            onOpen={openMember}
            onQuickAction={(signal) => void handleQuickAction(signal)}
          />
        ) : (
          <>
            <MemberSection
              title={required.length > 0 ? "Required" : ""}
              members={required}
              signalById={signalById}
              now={now}
              savingId={savingId}
              onOpen={openMember}
              onQuickAction={(signal) => void handleQuickAction(signal)}
            />
            <MemberSection
              title=""
              members={optional}
              signalById={signalById}
              now={now}
              savingId={savingId}
              onOpen={openMember}
              onQuickAction={(signal) => void handleQuickAction(signal)}
            />
          </>
        )}

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
  fallbackDetailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
  },
  fallbackDetail: {
    color: colors.secondaryLabel,
    fontSize: fontSize.small,
  },
});
