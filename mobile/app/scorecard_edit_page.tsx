import type { FunctionArgs } from "convex/server";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { PillButton } from "@/components/PillButton";
import { TaskyTagPicker } from "@/components/TaskyTagPicker";
import { automaticKeyboardInsets } from "@/lib/headerItems";
import {
  getSignalPeriodBounds,
  SIGNAL_SOON_WINDOW_MS,
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

type ScorecardId = FunctionArgs<typeof taskyApi.scorecards.get>["scorecardId"];
type SignalId = FunctionArgs<typeof taskyApi.signals.get>["signalId"];
type MemberRole = "required" | "optional";

export default function ScorecardEditPage() {
  const router = useRouter();
  const params = useLocalSearchParams<{ scorecardId?: string }>();
  const rawScorecardId = Array.isArray(params.scorecardId)
    ? params.scorecardId[0]
    : params.scorecardId;
  const scorecardId = rawScorecardId as ScorecardId | undefined;
  const taskyAuth = useTaskyAuth();
  const now = useSignalClock();
  const periodBounds = getSignalPeriodBounds(now);
  const taskyEnabled =
    taskyAuth.isAuthenticated && taskyAuth.convexAuthenticated;

  const [name, setName] = useState("");
  const [tagIds, setTagIds] = useState<TaskyTagId[]>([]);
  const [members, setMembers] = useState<
    Array<{ signalId: SignalId; role: MemberRole }>
  >([]);
  const [optionalQuota, setOptionalQuota] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
  const tags = useTaskyQuery(taskyApi.tags.list, taskyEnabled ? {} : "skip");
  const createScorecard = useTaskyMutation(taskyApi.scorecards.create);
  const updateScorecard = useTaskyMutation(taskyApi.scorecards.update);
  const setArchived = useTaskyMutation(taskyApi.scorecards.setArchived);

  useEffect(() => {
    if (!scorecard.data) {
      return;
    }
    setName(scorecard.data.name);
    setTagIds(scorecard.data.tagIds);
    setMembers(
      scorecard.data.members.map((member) => ({
        signalId: member.signalId,
        role: member.role,
      })),
    );
    setOptionalQuota(String(scorecard.data.optionalQuota));
  }, [scorecard.data]);

  const optionalCount = members.filter(
    (member) => member.role === "optional",
  ).length;
  const parsedQuota = Number.parseInt(optionalQuota, 10);
  const canSave =
    name.trim().length > 0 &&
    members.length > 0 &&
    Number.isInteger(parsedQuota) &&
    parsedQuota >= 0 &&
    parsedQuota <= optionalCount;

  const memberIds = useMemo(
    () => new Set(members.map((member) => member.signalId)),
    [members],
  );

  const toggleMember = (signalId: SignalId) => {
    setMembers((current) => {
      if (current.some((member) => member.signalId === signalId)) {
        return current.filter((member) => member.signalId !== signalId);
      }
      return [...current, { signalId, role: "required" }];
    });
  };

  const setRole = (signalId: SignalId, role: MemberRole) => {
    setMembers((current) =>
      current.map((member) =>
        member.signalId === signalId ? { ...member, role } : member,
      ),
    );
  };

  const handleSave = async () => {
    if (!canSave) {
      setError("Add a name, at least one signal, and a valid optional quota.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (scorecardId) {
        await updateScorecard({
          scorecardId,
          name: name.trim(),
          tagIds,
          members,
          optionalQuota: parsedQuota,
        });
      } else {
        await createScorecard({
          name: name.trim(),
          tagIds,
          members,
          optionalQuota: parsedQuota,
        });
      }
      router.back();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Failed to save",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = () => {
    if (!scorecardId) {
      return;
    }
    Alert.alert("Archive scorecard?", "You can restore it later from Tasky.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Archive",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await setArchived({ scorecardId, archived: true });
              router.back();
            } catch (archiveError) {
              setError(
                archiveError instanceof Error
                  ? archiveError.message
                  : "Failed to archive",
              );
            }
          })();
        },
      },
    ]);
  };

  if (!taskyAuth.isAuthenticated) {
    return (
      <View style={[sharedStyles.screen, styles.center]}>
        <Text style={sharedStyles.muted}>Connect Tasky to edit scorecards.</Text>
      </View>
    );
  }

  if (scorecardId && scorecard.data === undefined && !scorecard.error) {
    return (
      <View style={[sharedStyles.screen, styles.center]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: scorecardId ? "Edit Scorecard" : "New Scorecard",
        }}
      />
      <ScrollView
        style={sharedStyles.screen}
        contentContainerStyle={sharedStyles.screenContent}
        {...automaticKeyboardInsets}
      >
        <View style={sharedStyles.card}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Exercise"
            placeholderTextColor={colors.tertiaryLabel}
          />
        </View>

        <View style={sharedStyles.card}>
          <Text style={styles.label}>Tags</Text>
          <TaskyTagPicker
            tags={tags.data ?? []}
            selectedTagIds={tagIds}
            onChange={setTagIds}
            isLoading={tags.isLoading}
          />
        </View>

        <View style={sharedStyles.card}>
          <Text style={styles.label}>Signals</Text>
          <Text style={sharedStyles.muted}>
            Required signals must all be done. Optional signals can fill a quota.
          </Text>
          {(signals.data ?? []).map((signal) => {
            const selected = memberIds.has(signal.id);
            const member = members.find((item) => item.signalId === signal.id);
            return (
              <View key={signal.id} style={styles.signalRow}>
                <TouchableOpacity
                  style={styles.signalToggle}
                  onPress={() => toggleMember(signal.id)}
                >
                  <Text style={styles.signalName}>{signal.name}</Text>
                  <Text style={styles.signalMeta}>
                    {selected ? "Added" : "Add"}
                  </Text>
                </TouchableOpacity>
                {selected && member ? (
                  <View style={styles.roleRow}>
                    <Text style={styles.roleLabel}>Optional</Text>
                    <Switch
                      value={member.role === "optional"}
                      onValueChange={(value) =>
                        setRole(signal.id, value ? "optional" : "required")
                      }
                    />
                  </View>
                ) : null}
              </View>
            );
          })}
          {(signals.data ?? []).length === 0 ? (
            <Text style={sharedStyles.muted}>Create a signal first.</Text>
          ) : null}
        </View>

        <View style={sharedStyles.card}>
          <Text style={styles.label}>Optional quota</Text>
          <Text style={sharedStyles.muted}>
            How many optional signals must be fully done. 0 means optionals never
            block completion.
          </Text>
          <TextInput
            style={styles.input}
            value={optionalQuota}
            onChangeText={setOptionalQuota}
            keyboardType="number-pad"
          />
          <Text style={sharedStyles.muted}>
            {optionalCount} optional signal{optionalCount === 1 ? "" : "s"}{" "}
            selected
          </Text>
        </View>

        {error ? <Text style={sharedStyles.error}>{error}</Text> : null}

        <PillButton
          variant="primary"
          label={scorecardId ? "Save" : "Create"}
          onPress={() => void handleSave()}
          loading={saving}
          disabled={!canSave}
        />
        {scorecardId ? (
          <PillButton
            variant="destructive"
            label="Archive"
            onPress={handleArchive}
          />
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
  label: {
    color: colors.label,
    fontSize: fontSize.small,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  input: {
    borderRadius: radius.md,
    backgroundColor: colors.tertiarySystemGroupedBackground,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.label,
    fontSize: fontSize.body,
  },
  signalRow: {
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    gap: spacing.sm,
  },
  signalToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  signalName: {
    color: colors.label,
    fontSize: fontSize.body,
    fontWeight: "600",
    flex: 1,
  },
  signalMeta: {
    color: colors.systemBlue,
    fontSize: fontSize.small,
    fontWeight: "600",
  },
  roleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  roleLabel: {
    color: colors.secondaryLabel,
    fontSize: fontSize.small,
  },
});
