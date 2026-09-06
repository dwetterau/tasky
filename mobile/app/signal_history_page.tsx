import DateTimePicker from "@react-native-community/datetimepicker";
import type { FunctionArgs } from "convex/server";
import { type Href, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { ActivityMeasurementsForm } from "@/components/ActivityMeasurementsForm";
import { KeyboardDismissBar } from "@/components/KeyboardDoneAccessory";
import { PillButton } from "@/components/PillButton";
import { SignalRow } from "@/components/SignalRow";
import { automaticKeyboardInsets, iosHeaderTextItems } from "@/lib/headerItems";
import {
  activityMeasurementDraftFromEntry,
  createSignalIdempotencyKey,
  emptyActivityMeasurementDraft,
  formatActivityMeasurements,
  formatSignalQuantity,
  getSignalPeriodBounds,
  parseActivityMeasurements,
  SIGNAL_SOON_WINDOW_MS,
  type ActivityMeasurementDraft,
  type SignalEntry,
  useSignalClock,
} from "@/lib/signals";
import {
  taskyApi,
  useTaskyAuth,
  useTaskyMutation,
  useTaskyQuery,
} from "@/lib/tasky";
import { colors, fontSize, radius, sharedStyles, spacing } from "@/lib/theme";

type SignalId = FunctionArgs<typeof taskyApi.signals.get>["signalId"];
type SignalEntryId = SignalEntry["id"];

function formatSigned(value: number): string {
  const formatted = formatSignalQuantity(Math.abs(value));
  return `${value >= 0 ? "+" : "-"}${formatted}`;
}

function entryTitle(entry: SignalEntry): string {
  switch (entry.operation.type) {
    case "activity.occurred":
      return "Activity recorded";
    case "inventory.adjusted":
      return `${formatSigned(entry.operation.amount)} adjustment`;
    case "inventory.set":
      return `Set to ${formatSignalQuantity(entry.operation.quantity)}`;
  }
}

function entryDetail(entry: SignalEntry): string | undefined {
  switch (entry.operation.type) {
    case "activity.occurred": {
      const details = [
        formatActivityMeasurements(entry.operation.measurements),
        entry.operation.note,
      ].filter((detail): detail is string => Boolean(detail));
      return details.length === 0 ? undefined : details.join("\n");
    }
    case "inventory.adjusted":
      return `Result: ${formatSignalQuantity(entry.operation.resultingQuantity)}`;
    case "inventory.set":
      return `Previously ${formatSignalQuantity(entry.operation.previousQuantity)}`;
  }
}

function parseLocalDateTime(value: string): number | null {
  const normalized = value.trim().replace(" ", "T");
  if (!normalized) return null;
  const parsed = new Date(normalized).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export default function SignalHistoryPage() {
  const router = useRouter();
  const params = useLocalSearchParams<{ signalId?: string }>();
  const rawSignalId = Array.isArray(params.signalId)
    ? params.signalId[0]
    : params.signalId;
  const signalId = rawSignalId as SignalId | undefined;
  const taskyAuth = useTaskyAuth();
  const taskyEnabled =
    taskyAuth.isAuthenticated && taskyAuth.convexAuthenticated;
  const now = useSignalClock();
  const periodBounds = getSignalPeriodBounds(now);
  const signal = useTaskyQuery(
    taskyApi.signals.get,
    taskyEnabled && signalId
      ? {
          signalId,
          now,
          soonWindowMs: SIGNAL_SOON_WINDOW_MS,
          periodBounds,
        }
      : "skip",
  );
  const history = useTaskyQuery(
    taskyApi.signals.history,
    taskyEnabled && signalId
      ? {
          signalId,
          paginationOpts: { numItems: 100, cursor: null },
        }
      : "skip",
  );
  const recordSignal = useTaskyMutation(taskyApi.signals.record);
  const updateActivityEntry = useTaskyMutation(
    taskyApi.signals.updateActivityEntry,
  );
  const deleteActivityEntry = useTaskyMutation(
    taskyApi.signals.deleteActivityEntry,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backdatedAt, setBackdatedAt] = useState("");
  const [backdatedDate, setBackdatedDate] = useState<Date>(() => new Date());
  const [activityNote, setActivityNote] = useState("");
  const [activityMeasurements, setActivityMeasurements] =
    useState<ActivityMeasurementDraft>(() => emptyActivityMeasurementDraft());
  const [editingEntryId, setEditingEntryId] = useState<SignalEntryId | null>(
    null,
  );
  const [editingNote, setEditingNote] = useState("");
  const [editingMeasurements, setEditingMeasurements] =
    useState<ActivityMeasurementDraft>(() => emptyActivityMeasurementDraft());
  const [inventoryValue, setInventoryValue] = useState("");
  const measurementFields =
    signal.data?.model.kind === "activity"
      ? signal.data.model.measurementFields ?? []
      : [];
  const latestMeasurementEntry = history.data?.page.find(
    (entry) =>
      entry.operation.type === "activity.occurred" &&
      entry.operation.measurements !== undefined,
  );
  const latestMeasurements =
    latestMeasurementEntry?.operation.type === "activity.occurred"
      ? latestMeasurementEntry.operation.measurements
      : undefined;
  const measurementPrefillKey =
    signal.data?.model.kind !== "activity"
      ? undefined
      : `${signalId}:${latestMeasurementEntry?.id ?? "none"}:${
          latestMeasurementEntry?.updatedAt ??
          latestMeasurementEntry?.recordedAt ??
          "none"
        }:${measurementFields.join(",")}`;
  const appliedMeasurementPrefillKey = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (
      signal.data?.model.kind === "inventory" &&
      inventoryValue.trim() === ""
    ) {
      const current =
        signal.data.evaluation.projectedQuantity ??
        signal.data.model.confirmedQuantity;
      setInventoryValue(formatSignalQuantity(current));
    }
  }, [inventoryValue, signal.data]);

  useEffect(() => {
    if (
      measurementPrefillKey === undefined ||
      measurementPrefillKey === appliedMeasurementPrefillKey.current
    ) {
      return;
    }
    appliedMeasurementPrefillKey.current = measurementPrefillKey;
    setActivityMeasurements(
      activityMeasurementDraftFromEntry(latestMeasurements),
    );
  }, [latestMeasurements, measurementPrefillKey]);

  const record = async (
    operation:
      | {
          type: "activity.occurred";
          occurredAt?: number;
          note?: string;
          measurements?: ReturnType<typeof parseActivityMeasurements>;
        }
      | {
          type: "inventory.adjusted";
          amount: number;
        }
      | {
          type: "inventory.set";
          quantity: number;
        },
  ) => {
    if (!signalId) return;
    setIsSaving(true);
    setError(null);
    try {
      await recordSignal({
        signalId,
        idempotencyKey: createSignalIdempotencyKey("mobile-signal"),
        operation,
        soonWindowMs: SIGNAL_SOON_WINDOW_MS,
        periodBounds,
      });
      setBackdatedAt("");
      setBackdatedDate(new Date());
      setActivityNote("");
      if (operation.type !== "activity.occurred") {
        setInventoryValue("");
      }
    } catch (recordError) {
      setError(
        recordError instanceof Error
          ? recordError.message
          : "Failed to record signal",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleActivityRecord = async (occurredAt?: number) => {
    try {
      const measurements = parseActivityMeasurements(
        measurementFields,
        activityMeasurements,
      );
      await record({
        type: "activity.occurred",
        occurredAt,
        note: activityNote.trim() || undefined,
        measurements,
      });
    } catch (measurementError) {
      setError(
        measurementError instanceof Error
          ? measurementError.message
          : "Invalid exercise measurements",
      );
    }
  };

  const handleBackdatedActivity = async () => {
    const occurredAt =
      Platform.OS === "ios"
        ? backdatedDate.getTime()
        : parseLocalDateTime(backdatedAt);
    if (occurredAt === null) {
      setError("Use a local date and time such as 2026-08-23 09:30");
      return;
    }
    if (occurredAt > Date.now()) {
      setError("Activity time cannot be in the future");
      return;
    }
    await handleActivityRecord(occurredAt);
  };

  const handleInventory = async (mode: "adjust" | "set") => {
    const value = Number(inventoryValue);
    if (!Number.isFinite(value)) {
      setError("Enter a valid number");
      return;
    }
    if (mode === "adjust") {
      if (value === 0) {
        setError("Adjustment must not be zero");
        return;
      }
      await record({ type: "inventory.adjusted", amount: value });
      return;
    }
    if (value < 0) {
      setError("Count must be zero or greater");
      return;
    }
    await record({ type: "inventory.set", quantity: value });
  };

  const beginEditingActivityEntry = (entry: SignalEntry) => {
    if (entry.operation.type !== "activity.occurred") {
      return;
    }
    setEditingEntryId(entry.id);
    setEditingNote(entry.operation.note ?? "");
    setEditingMeasurements(
      activityMeasurementDraftFromEntry(entry.operation.measurements),
    );
    setError(null);
  };

  const cancelEditingActivityEntry = () => {
    setEditingEntryId(null);
    setEditingNote("");
    setEditingMeasurements(emptyActivityMeasurementDraft());
  };

  const saveActivityEntry = async () => {
    if (!editingEntryId) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const measurements = parseActivityMeasurements(
        measurementFields,
        editingMeasurements,
      );
      await updateActivityEntry({
        entryId: editingEntryId,
        note: editingNote.trim() || null,
        measurements: measurements ?? null,
      });
      cancelEditingActivityEntry();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Failed to update activity",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDeleteActivityEntry = (entryId: SignalEntryId) => {
    Alert.alert(
      "Delete activity entry?",
      "This removes the occurrence from history and goal progress.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setIsSaving(true);
              setError(null);
              try {
                await deleteActivityEntry({ entryId });
                if (editingEntryId === entryId) {
                  cancelEditingActivityEntry();
                }
              } catch (deleteError) {
                setError(
                  deleteError instanceof Error
                    ? deleteError.message
                    : "Failed to delete activity",
                );
              } finally {
                setIsSaving(false);
              }
            })();
          },
        },
      ],
    );
  };

  if (!signalId) {
    return (
      <View style={[sharedStyles.screen, styles.center]}>
        <Text style={sharedStyles.error}>Signal ID is missing.</Text>
      </View>
    );
  }

  if (!taskyEnabled || signal.isLoading) {
    return (
      <View style={[sharedStyles.screen, styles.center]}>
        <ActivityIndicator />
        <Text style={sharedStyles.muted}>Loading signal…</Text>
      </View>
    );
  }

  if (!signal.data) {
    return (
      <View style={[sharedStyles.screen, styles.center]}>
        <Text style={styles.emptyTitle}>Signal not found</Text>
        <Text style={sharedStyles.muted}>
          It may have been removed or belong to another account.
        </Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: signal.data.name,
          headerRight: () => (
            <TouchableOpacity
              onPress={() =>
                router.push({
                  pathname: "/signal_edit_page",
                  params: { signalId },
                } as unknown as Href)
              }
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Edit signal"
            >
              <Text style={styles.headerEdit}>Edit</Text>
            </TouchableOpacity>
          ),
          unstable_headerRightItems: () =>
            iosHeaderTextItems([
              {
                label: "Edit",
                onPress: () =>
                  router.push({
                    pathname: "/signal_edit_page",
                    params: { signalId },
                  } as unknown as Href),
              },
            ]),
        }}
      />
      <View style={sharedStyles.screen}>
        <ScrollView
          style={sharedStyles.screen}
          contentContainerStyle={[
            sharedStyles.screenContent,
            styles.pageContent,
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={
            Platform.OS === "ios" ? "interactive" : "on-drag"
          }
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          {...automaticKeyboardInsets}
        >
          <View style={styles.detailCard}>
            <SignalRow
              signal={signal.data}
              now={now}
              compact
              showsDisclosure={false}
              onPress={() => undefined}
            />
            {signal.data.model.kind === "inventory" ? (
              <Text style={styles.confirmedText}>
                Last confirmed{" "}
                {new Date(signal.data.model.confirmedAt).toLocaleString()}
              </Text>
            ) : null}
          </View>

          <View style={styles.section}>
            <Text style={sharedStyles.sectionTitle}>Record</Text>
            {signal.data.model.kind === "activity" ? (
              <View style={styles.actionCard}>
                {latestMeasurements && latestMeasurementEntry ? (
                  <View style={styles.previousMeasurements}>
                    <Text style={styles.previousLabel}>Most recent</Text>
                    <Text style={styles.previousValue}>
                      {formatActivityMeasurements(latestMeasurements)}
                    </Text>
                    <Text style={styles.previousDate}>
                      {new Date(
                        latestMeasurementEntry.effectiveAt,
                      ).toLocaleString()}
                    </Text>
                  </View>
                ) : null}
                <ActivityMeasurementsForm
                  fields={measurementFields}
                  value={activityMeasurements}
                  onChange={setActivityMeasurements}
                  disabled={isSaving}
                />
                <TextInput
                  style={styles.input}
                  value={activityNote}
                  onChangeText={setActivityNote}
                  placeholder="Optional note"
                  placeholderTextColor={colors.tertiaryLabel}
                  returnKeyType="done"
                />
                <PillButton
                  variant="primary"
                  label="Done now"
                  onPress={() => void handleActivityRecord()}
                  loading={isSaving}
                />
                <View style={styles.divider} />
                <Text style={styles.fieldLabel}>Earlier time</Text>
                <View style={styles.inlineRow}>
                  {Platform.OS === "ios" ? (
                    <>
                      <DateTimePicker
                        value={backdatedDate}
                        mode="datetime"
                        display="compact"
                        maximumDate={new Date()}
                        onChange={(_event, date) => {
                          if (date) setBackdatedDate(date);
                        }}
                      />
                      <View style={styles.inlineSpacer} />
                    </>
                  ) : (
                    <TextInput
                      style={[styles.input, styles.inlineInput]}
                      value={backdatedAt}
                      onChangeText={setBackdatedAt}
                      placeholder="YYYY-MM-DD HH:mm"
                      placeholderTextColor={colors.tertiaryLabel}
                      autoCapitalize="none"
                    />
                  )}
                  <PillButton
                    variant="tinted"
                    label="Record"
                    onPress={() => void handleBackdatedActivity()}
                    disabled={isSaving}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.actionCard}>
                <Text style={styles.fieldLabel}>
                  Adjustment or count ({signal.data.model.unit})
                </Text>
                <TextInput
                  style={styles.input}
                  value={inventoryValue}
                  onChangeText={setInventoryValue}
                  placeholder="-1, +30, or exact count"
                  placeholderTextColor={colors.tertiaryLabel}
                  keyboardType="numbers-and-punctuation"
                />
                <View style={styles.buttonRow}>
                  <PillButton
                    variant="tinted"
                    label="Adjust by"
                    onPress={() => void handleInventory("adjust")}
                    disabled={isSaving}
                    style={styles.rowButton}
                  />
                  <PillButton
                    variant="primary"
                    label="Set count"
                    onPress={() => void handleInventory("set")}
                    loading={isSaving}
                    style={styles.rowButton}
                  />
                </View>
              </View>
            )}
          </View>

          {error || signal.error || history.error ? (
            <Text style={sharedStyles.error}>
              {error ?? signal.error ?? history.error}
            </Text>
          ) : null}

          <View style={styles.section}>
            <Text style={sharedStyles.sectionTitle}>History</Text>
            {history.isLoading ? (
              <View style={sharedStyles.inlineLoading}>
                <ActivityIndicator />
                <Text style={sharedStyles.muted}>Loading history…</Text>
              </View>
            ) : (history.data?.page.length ?? 0) === 0 ? (
              <View style={styles.emptyHistory}>
                <Text style={sharedStyles.muted}>No entries yet.</Text>
              </View>
            ) : (
              <View style={styles.historyCard}>
                {history.data?.page.map((entry, index) => (
                  <View key={entry.id}>
                    {index > 0 ? <View style={styles.divider} /> : null}
                    <View style={styles.historyRow}>
                      <View style={styles.historyMain}>
                        <Text style={styles.historyTitle}>
                          {entryTitle(entry)}
                        </Text>
                        {entryDetail(entry) ? (
                          <Text style={styles.historyDetail}>
                            {entryDetail(entry)}
                          </Text>
                        ) : null}
                        <Text style={styles.historyDate}>
                          {new Date(entry.effectiveAt).toLocaleString()}
                        </Text>
                      </View>
                      <View style={styles.historyActions}>
                        <Text style={styles.source}>{entry.source}</Text>
                        {entry.operation.type === "activity.occurred" ? (
                          <TouchableOpacity
                            onPress={() => beginEditingActivityEntry(entry)}
                            hitSlop={8}
                          >
                            <Text style={styles.editEntryText}>Edit</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </View>
                    {editingEntryId === entry.id &&
                    entry.operation.type === "activity.occurred" ? (
                      <View style={styles.editEntryCard}>
                        <Text style={styles.fieldLabel}>Edit entry</Text>
                        <ActivityMeasurementsForm
                          fields={measurementFields}
                          value={editingMeasurements}
                          onChange={setEditingMeasurements}
                          disabled={isSaving}
                        />
                        <TextInput
                          style={styles.input}
                          value={editingNote}
                          onChangeText={setEditingNote}
                          placeholder="Optional note"
                          placeholderTextColor={colors.tertiaryLabel}
                          returnKeyType="done"
                        />
                        <View style={styles.buttonRow}>
                          <PillButton
                            variant="tinted"
                            label="Cancel"
                            onPress={cancelEditingActivityEntry}
                            disabled={isSaving}
                            style={styles.rowButton}
                          />
                          <PillButton
                            variant="primary"
                            label="Save"
                            onPress={() => void saveActivityEntry()}
                            loading={isSaving}
                            style={styles.rowButton}
                          />
                        </View>
                        <PillButton
                          variant="destructive"
                          label="Delete entry"
                          onPress={() => confirmDeleteActivityEntry(entry.id)}
                          disabled={isSaving}
                        />
                      </View>
                    ) : null}
                  </View>
                ))}
                {history.data && !history.data.isDone ? (
                  <Text style={styles.historyLimit}>
                    Showing the latest 100 entries
                  </Text>
                ) : null}
              </View>
            )}
          </View>
        </ScrollView>
        <KeyboardDismissBar />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  headerEdit: {
    color: colors.systemBlue,
    fontSize: fontSize.bodyLg,
    fontWeight: "600",
  },
  emptyTitle: {
    color: colors.label,
    fontSize: fontSize.subhead,
    fontWeight: "700",
  },
  pageContent: {
    paddingBottom: 120,
  },
  detailCard: {
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.secondarySystemGroupedBackground,
  },
  confirmedText: {
    paddingBottom: spacing.md,
    color: colors.tertiaryLabel,
    fontSize: fontSize.caption,
  },
  section: {
    gap: spacing.sm,
  },
  actionCard: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.secondarySystemGroupedBackground,
  },
  previousMeasurements: {
    gap: 2,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  previousLabel: {
    color: colors.secondaryLabel,
    fontSize: fontSize.caption,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  previousValue: {
    color: colors.label,
    fontSize: fontSize.body,
    fontWeight: "600",
  },
  previousDate: {
    color: colors.tertiaryLabel,
    fontSize: fontSize.caption,
  },
  fieldLabel: {
    color: colors.secondaryLabel,
    fontSize: fontSize.small,
    fontWeight: "600",
  },
  input: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.tertiarySystemGroupedBackground,
    color: colors.label,
    fontSize: fontSize.body,
  },
  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  inlineInput: {
    flex: 1,
  },
  inlineSpacer: {
    flex: 1,
  },
  buttonRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  rowButton: {
    flex: 1,
  },
  historyCard: {
    overflow: "hidden",
    borderRadius: radius.lg,
    backgroundColor: colors.secondarySystemGroupedBackground,
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  historyMain: {
    flex: 1,
    gap: 2,
  },
  historyActions: {
    alignItems: "flex-end",
    gap: spacing.sm,
  },
  historyTitle: {
    color: colors.label,
    fontSize: fontSize.body,
    fontWeight: "600",
  },
  historyDetail: {
    color: colors.secondaryLabel,
    fontSize: fontSize.small,
  },
  historyDate: {
    color: colors.tertiaryLabel,
    fontSize: fontSize.caption,
  },
  source: {
    color: colors.tertiaryLabel,
    fontSize: fontSize.micro,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  editEntryText: {
    color: colors.systemBlue,
    fontSize: fontSize.small,
    fontWeight: "600",
  },
  editEntryCard: {
    gap: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.tertiarySystemGroupedBackground,
  },
  historyLimit: {
    padding: spacing.md,
    color: colors.tertiaryLabel,
    fontSize: fontSize.caption,
    textAlign: "center",
  },
  emptyHistory: {
    alignItems: "center",
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.secondarySystemGroupedBackground,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
});
