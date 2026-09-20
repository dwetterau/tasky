import { type Href, Stack, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { PillButton } from "@/components/PillButton";
import { SignalRow } from "@/components/SignalRow";
import { TagFilterRow } from "@/components/TagFilterRow";
import { automaticKeyboardInsets, iosHeaderTextItems } from "@/lib/headerItems";
import {
  createSignalIdempotencyKey,
  getSignalPeriodBounds,
  loggedTodaySignals,
  SIGNAL_SOON_WINDOW_MS,
  type SignalDashboardItem,
  useSignalClock,
} from "@/lib/signals";
import { type TaskyTagId } from "@/lib/taskyTags";
import {
  taskyApi,
  useTaskyAuth,
  useTaskyMutation,
  useTaskyQuery,
} from "@/lib/tasky";
import { colors, fontSize, radius, sharedStyles, spacing } from "@/lib/theme";

type SignalAttention = SignalDashboardItem["evaluation"]["attention"];
type SignalsTab = "status" | "today";

const ATTENTION_ORDER: SignalAttention[] = ["due", "soon", "unknown", "ok"];
const ATTENTION_TITLES: Record<SignalAttention, string> = {
  due: "Due",
  soon: "Coming up",
  unknown: "Idle",
  ok: "On track",
};

function signalDetailsRoute(signalId: string) {
  return {
    pathname: "/signal_history_page" as const,
    params: { signalId },
  } as unknown as Href;
}

function SegmentedControl({
  value,
  options,
  onChange,
}: {
  value: SignalsTab;
  options: Array<{ value: SignalsTab; label: string; badge?: number }>;
  onChange: (next: SignalsTab) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <TouchableOpacity
            key={option.value}
            style={[styles.segmentItem, selected && styles.segmentItemActive]}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
          >
            <Text
              style={[
                styles.segmentLabel,
                selected && styles.segmentLabelActive,
              ]}
            >
              {option.label}
            </Text>
            {option.badge !== undefined && option.badge > 0 ? (
              <View
                style={[
                  styles.segmentBadge,
                  selected && styles.segmentBadgeActive,
                ]}
              >
                <Text
                  style={[
                    styles.segmentBadgeText,
                    selected && styles.segmentBadgeTextActive,
                  ]}
                >
                  {option.badge}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function SignalList({
  items,
  now,
  savingId,
  onOpen,
  onQuickAction,
}: {
  items: SignalDashboardItem[];
  now: number;
  savingId: string | null;
  onOpen: (signalId: string) => void;
  onQuickAction: (signal: SignalDashboardItem) => void;
}) {
  return (
    <View style={styles.listCard}>
      {items.map((signal, index) => (
        <View key={signal.id}>
          {index > 0 ? <View style={styles.divider} /> : null}
          <SignalRow
            signal={signal}
            now={now}
            onPress={() => onOpen(signal.id)}
            onQuickAction={() => onQuickAction(signal)}
            quickActionLabel={
              signal.model.kind === "activity" ? "Done" : "Update"
            }
            isSaving={savingId === signal.id}
          />
        </View>
      ))}
    </View>
  );
}

export default function SignalsPage() {
  const router = useRouter();
  const taskyAuth = useTaskyAuth();
  const now = useSignalClock();
  const periodBounds = getSignalPeriodBounds(now);
  const [tab, setTab] = useState<SignalsTab>("status");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<TaskyTagId | null>(null);
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
          ...(selectedTagId === null ? {} : { tagId: selectedTagId }),
        }
      : "skip",
  );
  const tags = useTaskyQuery(taskyApi.tags.list, taskyEnabled ? {} : "skip");
  const recordSignal = useTaskyMutation(taskyApi.signals.record);
  useEffect(() => {
    if (
      selectedTagId !== null &&
      tags.data &&
      !tags.data.some((tag) => tag._id === selectedTagId)
    ) {
      setSelectedTagId(null);
    }
  }, [selectedTagId, tags.data]);

  const grouped = useMemo(() => {
    const result: Array<{
      attention: SignalAttention;
      items: SignalDashboardItem[];
    }> = [];
    for (const attention of ATTENTION_ORDER) {
      const matching = (signals.data ?? []).filter(
        (signal) => signal.evaluation.attention === attention,
      );
      if (matching.length === 0) continue;
      result.push({
        attention,
        items: matching,
      });
    }
    return result;
  }, [signals.data]);
  const todayItems = useMemo(
    () => loggedTodaySignals(signals.data ?? [], periodBounds.day),
    [periodBounds.day, signals.data],
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
        idempotencyKey: createSignalIdempotencyKey("mobile-activity"),
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
        <View style={sharedStyles.card}>
          <Text style={styles.emptyTitle}>Connect Tasky</Text>
          <Text style={sharedStyles.muted}>
            Signals are stored in your Tasky account.
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

  const hasSignals = (signals.data ?? []).length > 0;
  const listProps = {
    now,
    savingId,
    onOpen: openSignal,
    onQuickAction: (signal: SignalDashboardItem) => {
      void handleQuickAction(signal);
    },
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push("/signal_edit_page" as Href)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Add signal"
            >
              <Text style={styles.headerAdd}>Add</Text>
            </TouchableOpacity>
          ),
          unstable_headerRightItems: () =>
            iosHeaderTextItems([
              {
                label: "Add",
                onPress: () => router.push("/signal_edit_page" as Href),
              },
            ]),
        }}
      />
      <ScrollView
        style={sharedStyles.screen}
        contentContainerStyle={sharedStyles.screenContent}
        {...automaticKeyboardInsets}
      >
        <TagFilterRow
          tags={tags.data ?? []}
          selectedTagId={selectedTagId}
          onChange={setSelectedTagId}
        />
        <SegmentedControl
          value={tab}
          onChange={setTab}
          options={[
            { value: "status", label: "Status" },
            { value: "today", label: "Today", badge: todayItems.length },
          ]}
        />

        {!taskyEnabled || signals.isLoading ? (
          <View style={sharedStyles.inlineLoading}>
            <ActivityIndicator />
            <Text style={sharedStyles.muted}>Loading signals…</Text>
          </View>
        ) : !hasSignals ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No signals yet</Text>
            <Text style={sharedStyles.muted}>
              Track a recurring activity or a running count.
            </Text>
            <PillButton
              variant="primary"
              label="Create signal"
              onPress={() => router.push("/signal_edit_page" as Href)}
            />
          </View>
        ) : tab === "today" ? (
          todayItems.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Nothing logged today</Text>
              <Text style={sharedStyles.muted}>
                Signals you record today will show up here.
              </Text>
            </View>
          ) : (
            <SignalList {...listProps} items={todayItems} />
          )
        ) : (
          grouped.map((attentionGroup) => (
            <View key={attentionGroup.attention} style={styles.attentionGroup}>
              <Text style={sharedStyles.sectionTitle}>
                {ATTENTION_TITLES[attentionGroup.attention]}
              </Text>
              <SignalList {...listProps} items={attentionGroup.items} />
            </View>
          ))
        )}

        {(error || taskyAuth.error || signals.error || tags.error) && (
          <Text style={sharedStyles.error}>
            {error ?? taskyAuth.error ?? signals.error ?? tags.error}
          </Text>
        )}
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
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.tertiarySystemGroupedBackground,
    borderRadius: radius.md,
    padding: 2,
    gap: 2,
  },
  segmentItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  segmentItemActive: {
    backgroundColor: colors.secondarySystemGroupedBackground,
  },
  segmentLabel: {
    fontSize: fontSize.body,
    color: colors.secondaryLabel,
    fontWeight: "600",
  },
  segmentLabelActive: {
    color: colors.label,
  },
  segmentBadge: {
    minWidth: 22,
    paddingHorizontal: 6,
    height: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.systemGray,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentBadgeActive: {
    backgroundColor: colors.systemBlue,
  },
  segmentBadgeText: {
    fontSize: fontSize.micro,
    fontWeight: "700",
    color: "white",
  },
  segmentBadgeTextActive: {
    color: "white",
  },
  attentionGroup: {
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
