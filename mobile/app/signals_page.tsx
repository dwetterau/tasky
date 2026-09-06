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
import { automaticKeyboardInsets, iosHeaderTextItems } from "@/lib/headerItems";
import {
  createSignalIdempotencyKey,
  getSignalPeriodBounds,
  SIGNAL_SOON_WINDOW_MS,
  type SignalDashboardItem,
  useSignalClock,
} from "@/lib/signals";
import { sortTaskyTags, taskyTagPath, type TaskyTagId } from "@/lib/taskyTags";
import {
  taskyApi,
  useTaskyAuth,
  useTaskyMutation,
  useTaskyQuery,
} from "@/lib/tasky";
import { colors, fontSize, radius, sharedStyles, spacing } from "@/lib/theme";

type SignalAttention = SignalDashboardItem["evaluation"]["attention"];

const ATTENTION_ORDER: SignalAttention[] = ["due", "soon", "unknown", "ok"];
const ATTENTION_TITLES: Record<SignalAttention, string> = {
  due: "Due",
  soon: "Coming up",
  unknown: "New",
  ok: "On track",
};

function signalDetailsRoute(signalId: string) {
  return {
    pathname: "/signal_history_page" as const,
    params: { signalId },
  } as unknown as Href;
}

export default function SignalsPage() {
  const router = useRouter();
  const taskyAuth = useTaskyAuth();
  const now = useSignalClock();
  const periodBounds = getSignalPeriodBounds(now);
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
  const orderedTags = useMemo(
    () => sortTaskyTags(tags.data ?? []),
    [tags.data],
  );
  const tagsById = useMemo(
    () =>
      new Map((tags.data ?? []).map((tag) => [String(tag._id), tag] as const)),
    [tags.data],
  );
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
        {orderedTags.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            <TouchableOpacity
              style={[
                styles.filterChip,
                selectedTagId === null && styles.filterChipSelected,
              ]}
              onPress={() => setSelectedTagId(null)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  selectedTagId === null && styles.filterChipTextSelected,
                ]}
              >
                All
              </Text>
            </TouchableOpacity>
            {orderedTags.map((tag) => {
              const selected = selectedTagId === tag._id;
              return (
                <TouchableOpacity
                  key={tag._id}
                  style={[
                    styles.filterChip,
                    selected && styles.filterChipSelected,
                  ]}
                  onPress={() => setSelectedTagId(tag._id)}
                >
                  <View
                    style={[
                      styles.filterDot,
                      {
                        backgroundColor: tag.color ?? colors.systemGray,
                      },
                    ]}
                  />
                  <Text
                    style={[
                      styles.filterChipText,
                      selected && styles.filterChipTextSelected,
                    ]}
                  >
                    {taskyTagPath(tag, tagsById)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}

        {!taskyEnabled || signals.isLoading ? (
          <View style={sharedStyles.inlineLoading}>
            <ActivityIndicator />
            <Text style={sharedStyles.muted}>Loading signals…</Text>
          </View>
        ) : grouped.length === 0 ? (
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
        ) : (
          grouped.map((attentionGroup) => (
            <View key={attentionGroup.attention} style={styles.attentionGroup}>
              <Text style={sharedStyles.sectionTitle}>
                {ATTENTION_TITLES[attentionGroup.attention]}
              </Text>
              <View style={styles.listCard}>
                {attentionGroup.items.map((signal, index) => (
                  <View key={signal.id}>
                    {index > 0 ? <View style={styles.divider} /> : null}
                    <SignalRow
                      signal={signal}
                      now={now}
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
  attentionGroup: {
    gap: spacing.sm,
  },
  filterRow: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.secondarySystemGroupedBackground,
  },
  filterChipSelected: {
    backgroundColor: colors.systemBlue,
  },
  filterDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  filterChipText: {
    color: colors.secondaryLabel,
    fontSize: fontSize.small,
    fontWeight: "600",
  },
  filterChipTextSelected: {
    color: "white",
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
