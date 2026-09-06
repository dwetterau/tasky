import type { FunctionArgs } from "convex/server";
import { type Href, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardDismissBar } from "@/components/KeyboardDoneAccessory";
import { PillButton } from "@/components/PillButton";
import { TaskyTagPicker } from "@/components/TaskyTagPicker";
import { automaticKeyboardInsets, iosHeaderTextItems } from "@/lib/headerItems";
import {
  ACTIVITY_MEASUREMENT_OPTIONS,
  getSignalPeriodBounds,
  SIGNAL_SOON_WINDOW_MS,
  type ActivityMeasurementField,
  useSignalClock,
} from "@/lib/signals";
import type { TaskyTagId } from "@/lib/taskyTags";
import {
  taskyApi,
  useTaskyAuth,
  useTaskyMutation,
  useTaskyQuery,
} from "@/lib/tasky";
import { colors, fontSize, radius, sharedStyles, spacing } from "@/lib/theme";

type SignalId = FunctionArgs<typeof taskyApi.signals.get>["signalId"];
type SignalKind = "activity" | "inventory";
type ActivityGoalMode = "tracking" | "daily" | "weekly" | "monthly";
type ActivityPeriod = "day" | "week" | "month";

function periodForGoalMode(
  mode: Exclude<ActivityGoalMode, "tracking">,
): ActivityPeriod {
  if (mode === "daily") return "day";
  if (mode === "weekly") return "week";
  return "month";
}

function goalModeForPeriod(
  period: ActivityPeriod,
): Exclude<ActivityGoalMode, "tracking"> {
  if (period === "day") return "daily";
  if (period === "week") return "weekly";
  return "monthly";
}

type InventoryComparison = "atOrBelow" | "atOrAbove";

function NumberField({
  label,
  value,
  onChangeText,
  placeholder,
  disabled,
  allowNegative = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  allowNegative?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, disabled && styles.disabledInput]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.tertiaryLabel}
        keyboardType={
          allowNegative && Platform.OS === "ios"
            ? "numbers-and-punctuation"
            : "decimal-pad"
        }
        editable={!disabled}
      />
    </View>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <TouchableOpacity
            key={option.value}
            style={[styles.segment, selected && styles.segmentSelected]}
            onPress={() => onChange(option.value)}
            activeOpacity={0.8}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.segmentText,
                selected && styles.segmentTextSelected,
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function SignalEditPage() {
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
  const tags = useTaskyQuery(taskyApi.tags.list, taskyEnabled ? {} : "skip");
  const createActivity = useTaskyMutation(taskyApi.signals.createActivity);
  const createInventory = useTaskyMutation(taskyApi.signals.createInventory);
  const updateActivity = useTaskyMutation(taskyApi.signals.updateActivity);
  const updateInventory = useTaskyMutation(taskyApi.signals.updateInventory);
  const setArchived = useTaskyMutation(taskyApi.signals.setArchived);

  const initialized = useRef(false);
  const [kind, setKind] = useState<SignalKind>("activity");
  const [name, setName] = useState("");
  const [tagIds, setTagIds] = useState<TaskyTagId[]>([]);
  const [activityGoalMode, setActivityGoalMode] =
    useState<ActivityGoalMode>("tracking");
  const [targetCount, setTargetCount] = useState("1");
  const [measurementFields, setMeasurementFields] = useState<
    ActivityMeasurementField[]
  >([]);
  const [unit, setUnit] = useState("");
  const [initialQuantity, setInitialQuantity] = useState("");
  const [thresholdValue, setThresholdValue] = useState("");
  const [comparison, setComparison] =
    useState<InventoryComparison>("atOrBelow");
  const [flowEnabled, setFlowEnabled] = useState(false);
  const [flowAmount, setFlowAmount] = useState("");
  const [flowEveryDays, setFlowEveryDays] = useState("1");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signal.data || initialized.current) return;
    initialized.current = true;
    setName(signal.data.name);
    setTagIds(signal.data.tagIds);
    setKind(signal.data.model.kind);
    if (signal.data.model.kind === "activity") {
      const target = signal.data.model.target;
      setMeasurementFields(signal.data.model.measurementFields ?? []);
      if (target?.type === "period") {
        setActivityGoalMode(goalModeForPeriod(target.period));
        setTargetCount(String(target.targetCount));
      } else {
        setActivityGoalMode("tracking");
      }
      return;
    }
    setUnit(signal.data.model.unit);
    setInitialQuantity(String(signal.data.model.confirmedQuantity));
    setThresholdValue(String(signal.data.model.threshold.value));
    setComparison(signal.data.model.threshold.comparison);
    setFlowEnabled(signal.data.model.flow !== undefined);
    setFlowAmount(String(signal.data.model.flow?.amount ?? ""));
    setFlowEveryDays(String(signal.data.model.flow?.everyDays ?? 1));
  }, [signal.data]);

  const handleSave = async () => {
    const normalizedName = name.trim();
    if (!normalizedName) {
      setError("Name is required");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      if (kind === "activity") {
        let target:
          | {
              type: "period";
              period: ActivityPeriod;
              targetCount: number;
            }
          | undefined;
        if (activityGoalMode !== "tracking") {
          const parsedTargetCount = Number(targetCount);
          if (!Number.isInteger(parsedTargetCount) || parsedTargetCount < 0) {
            throw new Error(
              "Completion target must be a whole number, 0 or greater",
            );
          }
          target = {
            type: "period",
            period: periodForGoalMode(activityGoalMode),
            targetCount: parsedTargetCount,
          };
        }
        if (signalId) {
          await updateActivity({
            signalId,
            name: normalizedName,
            tagIds,
            target: target ?? null,
            measurementFields,
          });
          router.back();
          return;
        }
        const createdId = await createActivity({
          name: normalizedName,
          tagIds,
          target,
          measurementFields,
        });
        if (createdId) {
          router.replace({
            pathname: "/signal_history_page",
            params: { signalId: createdId },
          } as unknown as Href);
        }
        return;
      }

      const normalizedUnit = unit.trim();
      const parsedQuantity = Number(initialQuantity);
      const parsedThreshold = Number(thresholdValue);
      if (!normalizedUnit) {
        throw new Error("Unit is required");
      }
      if (
        (!signalId &&
          (!Number.isFinite(parsedQuantity) || parsedQuantity < 0)) ||
        !Number.isFinite(parsedThreshold) ||
        parsedThreshold < 0
      ) {
        throw new Error("Quantity and threshold must be zero or greater");
      }
      let flow:
        | {
            amount: number;
            everyDays: number;
          }
        | undefined;
      if (flowEnabled) {
        const amount = Number(flowAmount);
        const everyDays = Number(flowEveryDays);
        if (
          !Number.isFinite(amount) ||
          amount === 0 ||
          !Number.isFinite(everyDays) ||
          everyDays <= 0
        ) {
          throw new Error(
            "Scheduled amount must be non-zero and interval must be positive",
          );
        }
        flow = { amount, everyDays };
      }

      if (signalId) {
        await updateInventory({
          signalId,
          name: normalizedName,
          tagIds,
          unit: normalizedUnit,
          threshold: {
            value: parsedThreshold,
            comparison,
          },
          flow: flowEnabled ? flow : null,
        });
        router.back();
        return;
      }
      const createdId = await createInventory({
        name: normalizedName,
        tagIds,
        unit: normalizedUnit,
        initialQuantity: parsedQuantity,
        threshold: {
          value: parsedThreshold,
          comparison,
        },
        flow,
      });
      if (createdId) {
        router.replace({
          pathname: "/signal_history_page",
          params: { signalId: createdId },
        } as unknown as Href);
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save signal",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchive = () => {
    if (!signalId) return;
    Alert.alert(
      "Archive signal?",
      "Its history will be kept, but it will leave the dashboard.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setIsSaving(true);
              setError(null);
              try {
                await setArchived({ signalId, archived: true });
                router.dismissTo("/signals_page" as Href);
              } catch (archiveError) {
                setError(
                  archiveError instanceof Error
                    ? archiveError.message
                    : "Failed to archive signal",
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

  if (!taskyEnabled) {
    return (
      <View style={[sharedStyles.screen, styles.center]}>
        <ActivityIndicator />
        <Text style={sharedStyles.muted}>Preparing Tasky…</Text>
      </View>
    );
  }

  if (signalId && signal.isLoading) {
    return (
      <View style={[sharedStyles.screen, styles.center]}>
        <ActivityIndicator />
        <Text style={sharedStyles.muted}>Loading signal…</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerRight:
            Platform.OS === "ios"
              ? () => (
                  <TouchableOpacity
                    style={styles.headerAction}
                    onPress={() => {
                      Keyboard.dismiss();
                      void handleSave();
                    }}
                    disabled={isSaving}
                    hitSlop={8}
                  >
                    {isSaving ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Text style={styles.headerActionText}>
                        {signalId ? "Save" : "Create"}
                      </Text>
                    )}
                  </TouchableOpacity>
                )
              : undefined,
          unstable_headerRightItems: () =>
            iosHeaderTextItems([
              {
                label: signalId ? "Save" : "Create",
                variant: "done",
                disabled: isSaving,
                onPress: () => {
                  Keyboard.dismiss();
                  void handleSave();
                },
              },
            ]),
        }}
      />
      <View style={sharedStyles.screen}>
        <ScrollView
          style={sharedStyles.screen}
          contentContainerStyle={[
            sharedStyles.screenContent,
            styles.formContent,
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={
            Platform.OS === "ios" ? "interactive" : "on-drag"
          }
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          {...automaticKeyboardInsets}
        >
          <View style={styles.card}>
            <View style={styles.field}>
              <Text style={styles.label}>Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder={kind === "activity" ? "Run" : "Prescription name"}
                placeholderTextColor={colors.tertiaryLabel}
                returnKeyType="done"
              />
            </View>
            <TaskyTagPicker
              tags={tags.data ?? []}
              selectedTagIds={tagIds}
              onChange={setTagIds}
              isLoading={tags.isLoading}
            />
          </View>

          {!signalId ? (
            <View style={styles.section}>
              <Text style={sharedStyles.sectionTitle}>Type</Text>
              <Segmented
                value={kind}
                onChange={setKind}
                options={[
                  { value: "activity", label: "Activity" },
                  { value: "inventory", label: "Inventory" },
                ]}
              />
            </View>
          ) : null}

          {kind === "activity" ? (
            <>
              <View style={styles.section}>
                <Text style={sharedStyles.sectionTitle}>Goal</Text>
                <View style={styles.card}>
                  <Segmented
                    value={activityGoalMode}
                    onChange={setActivityGoalMode}
                    options={[
                      { value: "tracking", label: "None" },
                      { value: "daily", label: "Daily" },
                      { value: "weekly", label: "Weekly" },
                      { value: "monthly", label: "Monthly" },
                    ]}
                  />
                  {activityGoalMode !== "tracking" ? (
                    <>
                      <NumberField
                        label={`Completions per ${periodForGoalMode(activityGoalMode)}`}
                        value={targetCount}
                        onChangeText={setTargetCount}
                        placeholder="1"
                      />
                      <Text style={sharedStyles.muted}>
                        0 keeps the {periodForGoalMode(activityGoalMode)} window
                        without making this signal due.
                      </Text>
                    </>
                  ) : null}
                </View>
              </View>

              <View style={styles.section}>
                <Text style={sharedStyles.sectionTitle}>Measurements</Text>
                <View style={styles.card}>
                  <View style={styles.chipRow}>
                    {ACTIVITY_MEASUREMENT_OPTIONS.map((option) => {
                      const enabled = measurementFields.includes(option.field);
                      return (
                        <TouchableOpacity
                          key={option.field}
                          style={[styles.chip, enabled && styles.chipSelected]}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityState={{ selected: enabled }}
                          onPress={() =>
                            setMeasurementFields((current) =>
                              enabled
                                ? current.filter(
                                    (field) => field !== option.field,
                                  )
                                : [...current, option.field],
                            )
                          }
                        >
                          <Text
                            style={[
                              styles.chipText,
                              enabled && styles.chipTextSelected,
                            ]}
                          >
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </View>
            </>
          ) : (
            <>
              <View style={styles.section}>
                <Text style={sharedStyles.sectionTitle}>Inventory</Text>
                <View style={styles.card}>
                  <View style={styles.field}>
                    <Text style={styles.label}>Unit</Text>
                    <TextInput
                      style={styles.input}
                      value={unit}
                      onChangeText={setUnit}
                      placeholder="pills"
                      placeholderTextColor={colors.tertiaryLabel}
                      returnKeyType="done"
                    />
                  </View>
                  <NumberField
                    label={
                      signalId
                        ? "Current confirmed quantity"
                        : "Starting quantity"
                    }
                    value={initialQuantity}
                    onChangeText={setInitialQuantity}
                    placeholder="60"
                    disabled={Boolean(signalId)}
                  />
                  <NumberField
                    label="Alert when quantity is…"
                    value={thresholdValue}
                    onChangeText={setThresholdValue}
                    placeholder="14"
                  />
                  <Segmented
                    value={comparison}
                    onChange={setComparison}
                    options={[
                      { value: "atOrBelow", label: "At or below" },
                      { value: "atOrAbove", label: "At or above" },
                    ]}
                  />
                </View>
              </View>

              <View style={styles.section}>
                <Text style={sharedStyles.sectionTitle}>Scheduled flow</Text>
                <View style={styles.card}>
                  <View style={styles.switchRow}>
                    <Text style={styles.switchLabel}>
                      Change automatically over time
                    </Text>
                    <Switch
                      value={flowEnabled}
                      onValueChange={setFlowEnabled}
                    />
                  </View>
                  {flowEnabled ? (
                    <>
                      <NumberField
                        label="Amount each interval"
                        value={flowAmount}
                        onChangeText={setFlowAmount}
                        placeholder="-1 drains, +1 fills"
                        allowNegative
                      />
                      <NumberField
                        label="Every days"
                        value={flowEveryDays}
                        onChangeText={setFlowEveryDays}
                        placeholder="1"
                      />
                    </>
                  ) : null}
                </View>
              </View>
            </>
          )}

          {error || signal.error || tags.error ? (
            <Text style={sharedStyles.error}>
              {error ?? signal.error ?? tags.error}
            </Text>
          ) : null}

          {Platform.OS !== "ios" ? (
            <PillButton
              variant="primary"
              label={signalId ? "Save changes" : "Create signal"}
              onPress={() => void handleSave()}
              loading={isSaving}
            />
          ) : null}

          {signalId ? (
            <PillButton
              variant="destructive"
              label="Archive signal"
              onPress={handleArchive}
              disabled={isSaving}
            />
          ) : null}
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
  },
  headerAction: {
    minWidth: 52,
    minHeight: 32,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  headerActionText: {
    color: colors.systemBlue,
    fontSize: fontSize.bodyLg,
    fontWeight: "600",
  },
  formContent: {
    paddingBottom: 160,
  },
  section: {
    gap: spacing.sm,
  },
  card: {
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.secondarySystemGroupedBackground,
  },
  field: {
    gap: spacing.xs + 2,
  },
  label: {
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
  disabledInput: {
    color: colors.secondaryLabel,
    opacity: 0.6,
  },
  segmented: {
    flexDirection: "row",
    height: 36,
    padding: 2,
    borderRadius: radius.md,
    backgroundColor: colors.tertiarySystemGroupedBackground,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md - 2,
  },
  segmentSelected: {
    backgroundColor: colors.secondarySystemGroupedBackground,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  segmentText: {
    color: colors.secondaryLabel,
    fontSize: fontSize.small,
    fontWeight: "600",
  },
  segmentTextSelected: {
    color: colors.label,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  switchLabel: {
    flex: 1,
    color: colors.label,
    fontSize: fontSize.body,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  chip: {
    height: 32,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.tertiarySystemGroupedBackground,
  },
  chipSelected: {
    backgroundColor: colors.systemBlue,
  },
  chipText: {
    color: colors.secondaryLabel,
    fontSize: fontSize.small,
    fontWeight: "600",
  },
  chipTextSelected: {
    color: "white",
  },
});
