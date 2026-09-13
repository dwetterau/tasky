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
import type { TaskyTag, TaskyTagId } from "@/lib/taskyTags";
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
type GoalMode = "members" | "times";
type DraftMember =
  | { type: "signal"; signalId: SignalId; role: MemberRole }
  | { type: "scorecard"; scorecardId: ScorecardId; role: MemberRole };

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

function memberKey(member: DraftMember): string {
  return member.type === "scorecard"
    ? `scorecard:${member.scorecardId}`
    : `signal:${member.signalId}`;
}

function tagSubtreeIds(
  selected: TaskyTagId[],
  tags: TaskyTag[],
): Set<string> {
  const byId = new Map(tags.map((tag) => [String(tag._id), tag] as const));
  const ids = new Set<string>();
  for (const tagId of selected) {
    ids.add(String(tagId));
    const tag = byId.get(String(tagId));
    for (const childId of tag?.childrenRecursive ?? []) {
      ids.add(String(childId));
    }
  }
  return ids;
}

function sharesSelectedTag(
  itemTagIds: readonly string[],
  allowed: Set<string>,
): boolean {
  return itemTagIds.some((tagId) => allowed.has(String(tagId)));
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
  const [goalMode, setGoalMode] = useState<GoalMode>("members");
  const [goalCount, setGoalCount] = useState("0");
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
    if (scorecard.data.targetCount !== undefined) {
      setGoalMode("times");
      setGoalCount(String(scorecard.data.targetCount));
    } else {
      setGoalMode("members");
      setGoalCount(String(scorecard.data.optionalQuota));
    }
  }, [scorecard.data]);

  const optionalCount = members.filter(
    (member) => member.role === "optional",
  ).length;
  const parsedGoal = Number.parseInt(goalCount, 10);
  const goalValid =
    Number.isInteger(parsedGoal) &&
    (goalMode === "times"
      ? parsedGoal >= 1
      : parsedGoal >= 0 && parsedGoal <= optionalCount);
  const canSave =
    name.trim().length > 0 && members.length > 0 && goalValid;

  const memberIds = useMemo(
    () => new Set(members.map(memberKey)),
    [members],
  );

  const allowedTagIds = useMemo(
    () => tagSubtreeIds(tagIds, tags.data ?? []),
    [tagIds, tags.data],
  );

  const visibleSignals = useMemo(() => {
    const listed = signals.data ?? [];
    if (tagIds.length === 0) {
      return listed;
    }
    return listed.filter(
      (signal) =>
        memberIds.has(`signal:${signal.id}`) ||
        sharesSelectedTag(signal.tagIds, allowedTagIds),
    );
  }, [allowedTagIds, memberIds, signals.data, tagIds.length]);

  const otherScorecards = useMemo(() => {
    const listed = (scorecards.data ?? []).filter(
      (card) => card.id !== scorecardId,
    );
    if (tagIds.length === 0) {
      return listed;
    }
    return listed.filter(
      (card) =>
        memberIds.has(`scorecard:${card.id}`) ||
        sharesSelectedTag(card.tagIds, allowedTagIds),
    );
  }, [allowedTagIds, memberIds, scorecardId, scorecards.data, tagIds.length]);

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

  const changeGoalMode = (next: GoalMode) => {
    setGoalMode(next);
    if (next === "times") {
      const current = Number.parseInt(goalCount, 10);
      if (!Number.isInteger(current) || current < 1) {
        setGoalCount("1");
      }
    }
  };

  const handleSave = async () => {
    if (!canSave) {
      setError(
        "Add a name, at least one member, and a valid completion goal.",
      );
      return;
    }
    const optionalQuota = goalMode === "members" ? parsedGoal : 0;
    const targetCount = goalMode === "times" ? parsedGoal : null;
    setSaving(true);
    setError(null);
    try {
      if (scorecardId) {
        await updateScorecard({
          scorecardId,
          name: name.trim(),
          tagIds,
          members,
          optionalQuota,
          targetCount,
        });
      } else {
        await createScorecard({
          name: name.trim(),
          tagIds,
          members,
          optionalQuota,
          ...(targetCount !== null ? { targetCount } : {}),
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
            Required members must all be done. Optional members help fill the
            goal below.
          </Text>
          {visibleSignals.map((signal) => {
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
          {visibleSignals.length === 0 ? (
            <Text style={sharedStyles.muted}>
              {tagIds.length > 0
                ? "No signals match these tags."
                : "Create a signal first."}
            </Text>
          ) : null}
        </View>

        <View style={sharedStyles.card}>
          <Text style={styles.label}>Scorecards</Text>
          <Text style={sharedStyles.muted}>
            A nested scorecard is one member. It uses its own goal to decide
            when it is complete and how many times it contributes.
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
              {tagIds.length > 0
                ? "No scorecards match these tags."
                : scorecardId
                  ? "No other scorecards to nest."
                  : "Create another scorecard to nest it here."}
            </Text>
          ) : null}
        </View>

        <View style={sharedStyles.card}>
          <Text style={styles.label}>Done when</Text>
          <Segmented
            value={goalMode}
            onChange={changeGoalMode}
            options={[
              { value: "members", label: "Members" },
              { value: "times", label: "Times" },
            ]}
          />
          {goalMode === "members" ? (
            <Text style={sharedStyles.muted}>
              Count finished optional members, not how many times they happened.
              Required members must still all be done. 0 means optionals never
              block the card.
            </Text>
          ) : (
            <Text style={sharedStyles.muted}>
              Count times, not finished members. A signal adds its occurrences
              this period; a nested card adds its own count. Required members
              must still all be done.
            </Text>
          )}
          <TextInput
            style={styles.input}
            value={goalCount}
            onChangeText={setGoalCount}
            keyboardType="number-pad"
            placeholder={goalMode === "times" ? "1" : "0"}
          />
          {goalMode === "members" ? (
            <Text style={sharedStyles.muted}>
              {optionalCount} optional member{optionalCount === 1 ? "" : "s"}{" "}
              selected
            </Text>
          ) : null}
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
});
