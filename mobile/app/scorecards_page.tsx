import { type Href, Stack, useRouter } from "expo-router";
import { useMemo } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { PillButton } from "@/components/PillButton";
import { automaticKeyboardInsets, iosHeaderTextItems } from "@/lib/headerItems";
import {
  getSignalPeriodBounds,
  memberContributionCount,
  scorecardHeadline,
  SIGNAL_SOON_WINDOW_MS,
  type ScorecardItem,
  useSignalClock,
} from "@/lib/signals";
import { taskyApi, useTaskyAuth, useTaskyQuery } from "@/lib/tasky";
import { colors, fontSize, radius, sharedStyles, spacing } from "@/lib/theme";

function scorecardEditRoute(scorecardId?: string) {
  return {
    pathname: "/scorecard_edit_page" as const,
    params: scorecardId ? { scorecardId } : {},
  } as unknown as Href;
}

function scorecardDetailRoute(scorecardId: string) {
  return {
    pathname: "/scorecard_page" as const,
    params: { scorecardId },
  } as unknown as Href;
}

function formatPercent(ratio: number): string {
  return `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
}

function ScorecardRow({ scorecard }: { scorecard: ScorecardItem }) {
  const router = useRouter();
  const headline = scorecardHeadline(scorecard);
  const counted = scorecard.targetCount !== undefined;
  const members = counted
    ? scorecard.members
    : scorecard.members.filter((member) => member.role === "required");
  const extras = counted
    ? []
    : scorecard.members.filter((member) => member.role === "optional");
  const extraNames = extras
    .filter((member) => memberContributionCount(member) > 0)
    .map((member) => member.name)
    .join(" · ");

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.8}
      onPress={() => router.push(scorecardDetailRoute(scorecard.id))}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardTitle}>{scorecard.name}</Text>
          <Text style={styles.cardSubtitle}>{headline}</Text>
        </View>
        <Text style={styles.percent}>
          {formatPercent(scorecard.evaluation.ratio)}
        </Text>
      </View>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              width: `${Math.min(100, Math.max(0, scorecard.evaluation.ratio * 100))}%`,
              backgroundColor: scorecard.evaluation.isComplete
                ? colors.systemGreen
                : colors.systemBlue,
            },
          ]}
        />
      </View>
      {members.length > 0 ? (
        <View style={styles.members}>
          {members.map((member) => {
            const count = memberContributionCount(member);
            const done = counted ? count > 0 : member.evaluation.isComplete;
            return (
              <Text
                key={
                  member.type === "scorecard"
                    ? member.scorecardId
                    : member.signalId
                }
                style={[styles.member, done && styles.memberDone]}
              >
                {done ? "✓ " : "○ "}
                {member.name}
                {counted && count > 1 ? ` · ${count}` : ""}
              </Text>
            );
          })}
        </View>
      ) : extraNames ? (
        <Text style={styles.optionalNames} numberOfLines={2}>
          {extraNames}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

export default function ScorecardsPage() {
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
  const items = useMemo(() => scorecards.data ?? [], [scorecards.data]);

  if (!taskyAuth.isAuthenticated) {
    return (
      <View style={[sharedStyles.screen, styles.center]}>
        <View style={sharedStyles.card}>
          <Text style={styles.emptyTitle}>Connect Tasky</Text>
          <Text style={sharedStyles.muted}>
            Scorecards roll up your Tasky signals.
          </Text>
          <PillButton
            variant="primary"
            label="Open Settings"
            onPress={() => router.push("/settings_page")}
            style={styles.emptyButton}
          />
        </View>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push(scorecardEditRoute())}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Add scorecard"
            >
              <Text style={styles.headerAdd}>Add</Text>
            </TouchableOpacity>
          ),
          unstable_headerRightItems: () =>
            iosHeaderTextItems([
              {
                label: "Add",
                onPress: () => router.push(scorecardEditRoute()),
              },
            ]),
        }}
      />
      <ScrollView
        style={sharedStyles.screen}
        contentContainerStyle={sharedStyles.screenContent}
        {...automaticKeyboardInsets}
      >
        {!taskyEnabled || scorecards.isLoading ? (
          <View style={sharedStyles.inlineLoading}>
            <ActivityIndicator />
            <Text style={sharedStyles.muted}>Loading scorecards…</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No scorecards yet</Text>
            <Text style={sharedStyles.muted}>
              Group required and optional signals into a daily or weekly goal.
            </Text>
            <PillButton
              variant="primary"
              label="Create scorecard"
              onPress={() => router.push(scorecardEditRoute())}
            />
          </View>
        ) : (
          items.map((scorecard) => (
            <ScorecardRow key={scorecard.id} scorecard={scorecard} />
          ))
        )}
        {scorecards.error ? (
          <Text style={sharedStyles.error}>{scorecards.error}</Text>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    padding: spacing.xl,
    justifyContent: "center",
  },
  headerAdd: {
    color: colors.systemBlue,
    fontSize: fontSize.bodyLg,
    fontWeight: "600",
  },
  card: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.secondarySystemGroupedBackground,
    gap: spacing.sm,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  cardHeaderText: {
    flex: 1,
    gap: spacing.xs,
  },
  cardTitle: {
    color: colors.label,
    fontSize: fontSize.subhead,
    fontWeight: "700",
  },
  cardSubtitle: {
    color: colors.secondaryLabel,
    fontSize: fontSize.small,
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
  members: {
    gap: spacing.xs,
  },
  member: {
    color: colors.secondaryLabel,
    fontSize: fontSize.small,
  },
  memberDone: {
    color: colors.label,
  },
  optionalNames: {
    color: colors.tertiaryLabel,
    fontSize: fontSize.small,
  },
  emptyState: {
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
  },
  emptyTitle: {
    color: colors.label,
    fontSize: fontSize.subhead,
    fontWeight: "700",
  },
  emptyButton: {
    alignSelf: "flex-start",
  },
});
