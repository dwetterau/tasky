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
type DraftMember =
  | { type: "signal"; signalId: SignalId; role: MemberRole }
  | { type: "scorecard"; scorecardId: ScorecardId; role: MemberRole };

function memberKey(member: DraftMember): string {
  return member.type === "scorecard"
    ? `scorecard:${member.scorecardId}`
    : `signal:${member.signalId}`;
}

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
  const [members, setMembers] = useState<DraftMember[]>([]);
  const [optionalQuota, setOptionalQuota] = useState("0");
  const [targetCount, setTargetCount] = useState("");
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
      scorecard.data.members.map((member) =>
        member.type === "scorecard"
          ? {
              type: "scorecard" as const,
              scorecardId: member.scorecardId,
              role: member.role,
            }
          : {
              type: "signal" as const,
              signalId: member.signalId,
              role: member.role,
            },
      ),
    );
    setOptionalQuota(String(scorecard.data.optionalQuota));
    setTargetCount(
      scorecard.data.targetCount !== undefined
        ? String(scorecard.data.targetCount)
        : "",
    );
  }, [scorecard.data]);

  const optionalCount = members.filter(
    (member) => member.role === "optional",
  ).length;
  const parsedQuota = Number.parseInt(optionalQuota, 10);
  const trimmedTarget = targetCount.trim();
  const parsedTarget = Number.parseInt(trimmedTarget, 10);
  const targetValid =
    trimmedTarget.length === 0 ||
    (Number.isInteger(parsedTarget) && parsedTarget >= 1);
  const canSave =
    name.trim().length > 0 &&
    members.length > 0 &&
    Number.isInteger(parsedQuota) &&
    parsedQuota >= 0 &&
    parsedQuota <= optionalCount &&
    targetValid;

  const memberIds = useMemo(
    () => new Set(members.map(memberKey)),
    [members],
  );

  const otherScorecards = useMemo(
    () =>
      (scorecards.data ?? []).filter((card) => card.id !== scorecardId),
    [scorecardId, scorecards.data],
  );

  const toggleSignal = (signalId: SignalId) => {
    const key = `signal:${signalId}`;
    setMembers((current) => {
      if (current.some((member) => memberKey(member) === key)) {
        return current.filter((member) => memberKey(member) !== key);
      }
      return [...current, { type: "signal", signalId, role: "required" }];
    });
  };

  const toggleScorecard = (childId: ScorecardId) => {
    const key = `scorecard:${childId}`;
    setMembers((current) => {
      if (current.some((member) => memberKey(member) === key)) {
        return current.filter((member) => memberKey(member) !== key);
      }
      return [
        ...current,
        { type: "scorecard", scorecardId: childId, role: "required" },
      ];
    });
  };

  const setRole = (key: string, role: MemberRole) => {
    setMembers((current) =>
      current.map((member) =>
        memberKey(member) === key ? { ...member, role } : member,
      ),
    );
  };

  const handleSave = async () => {
    if (!canSave) {
      setError(
        "Add a name, at least one member, and a valid optional quota or session target.",
      );
      return;
    }
    const nextTargetCount =
      trimmedTarget.length === 0 ? null : parsedTarget;
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
          targetCount: nextTargetCount,
        });
      } else {
        await createScorecard({
          name: name.trim(),
          tagIds,
          members,
          optionalQuota: parsedQuota,
          ...(nextTargetCount !== null ? { targetCount: nextTargetCount } : {}),
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
            Required members must all be done. Optional members can fill a quota.
          </Text>
          {(signals.data ?? []).map((signal) => {
            const key = `signal:${signal.id}`;
            const selected = memberIds.has(key);
            const member = members.find((item) => memberKey(item) === key);
            return (
              <View key={signal.id} style={styles.signalRow}>
                <TouchableOpacity
                  style={styles.signalToggle}
                  onPress={() => toggleSignal(signal.id)}
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
                        setRole(key, value ? "optional" : "required")
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
          <Text style={styles.label}>Scorecards</Text>
          <Text style={sharedStyles.muted}>
            A nested scorecard counts as one member. Its own optional quota
            decides when it is complete.
          </Text>
          {otherScorecards.map((card) => {
            const key = `scorecard:${card.id}`;
            const selected = memberIds.has(key);
            const member = members.find((item) => memberKey(item) === key);
            return (
              <View key={card.id} style={styles.signalRow}>
                <TouchableOpacity
                  style={styles.signalToggle}
                  onPress={() => toggleScorecard(card.id)}
                >
                  <Text style={styles.signalName}>{card.name}</Text>
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
                        setRole(key, value ? "optional" : "required")
                      }
                    />
                  </View>
                ) : null}
              </View>
            );
          })}
          {otherScorecards.length === 0 ? (
            <Text style={sharedStyles.muted}>
              {scorecardId
                ? "No other scorecards to nest."
                : "Create another scorecard to nest it here."}
            </Text>
          ) : null}
        </View>

        <View style={sharedStyles.card}>
          <Text style={styles.label}>Optional quota</Text>
          <Text style={sharedStyles.muted}>
            How many optional members must be fully done. 0 means optionals never
            block completion.
          </Text>
          <TextInput
            style={styles.input}
            value={optionalQuota}
            onChangeText={setOptionalQuota}
            keyboardType="number-pad"
          />
          <Text style={sharedStyles.muted}>
            {optionalCount} optional member{optionalCount === 1 ? "" : "s"}{" "}
            selected
          </Text>
        </View>

        <View style={sharedStyles.card}>
          <Text style={styles.label}>Session target</Text>
          <Text style={sharedStyles.muted}>
            Sum member occurrences (and nested card counts) toward this goal.
            Leave empty to use optional quota instead.
          </Text>
          <TextInput
            style={styles.input}
            value={targetCount}
            onChangeText={setTargetCount}
            keyboardType="number-pad"
            placeholder="None"
          />
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
