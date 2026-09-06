import { useRouter } from "expo-router";
import type { FunctionReturnType } from "convex/server";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  taskyApi,
  useTaskyAuth,
  useTaskyMutation,
  useTaskyQuery,
} from "@/lib/tasky";
import { colors, fontSize, radius, sharedStyles, spacing } from "@/lib/theme";
import { automaticKeyboardInsets } from "@/lib/headerItems";

type Capture = FunctionReturnType<typeof taskyApi.captures.list>[number];
type Task = FunctionReturnType<typeof taskyApi.tasks.list>[number];
type TaskStatus = Task["status"];
type TaskPriority = Task["priority"];
type TaskTag = Task["tags"][number];

type Tab = "captures" | "tasks";

const STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  agent_running: "Agent running",
  blocked: "Blocked",
  closed: "Closed",
};

const STATUS_ORDER: TaskStatus[] = [
  "in_progress",
  "agent_running",
  "blocked",
  "not_started",
  "closed",
];

const STATUS_COLORS: Record<TaskStatus, unknown> = {
  not_started: colors.secondaryLabel,
  in_progress: colors.systemBlue,
  agent_running: colors.systemPurple,
  blocked: colors.systemOrange,
  closed: colors.systemGreen,
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  triage: "Triage",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const PRIORITY_COLORS: Record<TaskPriority, unknown> = {
  triage: colors.systemGray,
  low: colors.systemTeal,
  medium: colors.systemBlue,
  high: colors.systemOrange,
  urgent: colors.systemRed,
};

const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  triage: 4,
};

function getTaskFirstLine(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "(untitled task)";
  const newline = trimmed.indexOf("\n");
  return newline === -1 ? trimmed : trimmed.slice(0, newline);
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return "now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function SegmentedControl({
  value,
  options,
  onChange,
}: {
  value: Tab;
  options: Array<{ value: Tab; label: string; badge?: number }>;
  onChange: (next: Tab) => void;
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

function Checkbox({
  checked,
  onPress,
  disabled,
}: {
  checked: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.checkbox, checked && styles.checkboxChecked]}
      hitSlop={10}
    >
      {checked ? <Text style={styles.checkmark}>{"\u2713"}</Text> : null}
    </TouchableOpacity>
  );
}

function PriorityDot({ priority }: { priority: TaskPriority }) {
  return (
    <View
      style={[
        styles.priorityDot,
        {
          backgroundColor: PRIORITY_COLORS[priority] as unknown as string,
        },
      ]}
    />
  );
}

function StatusPill({ status }: { status: TaskStatus }) {
  return (
    <View
      style={[
        styles.statusPill,
        {
          borderColor: STATUS_COLORS[status] as unknown as string,
        },
      ]}
    >
      <Text
        style={[
          styles.statusPillText,
          { color: STATUS_COLORS[status] as unknown as string },
        ]}
      >
        {STATUS_LABELS[status]}
      </Text>
    </View>
  );
}

function CaptureRow({
  capture,
  isEditing,
  editingText,
  isSaving,
  onStartEdit,
  onCancelEdit,
  onChangeText,
  onSave,
  onDismiss,
}: {
  capture: Capture;
  isEditing: boolean;
  editingText: string;
  isSaving: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onChangeText: (text: string) => void;
  onSave: () => void;
  onDismiss: () => void;
}) {
  if (isEditing) {
    return (
      <View style={styles.todoRowEditing}>
        <TextInput
          style={styles.editInput}
          value={editingText}
          onChangeText={onChangeText}
          placeholder="Capture text"
          placeholderTextColor={colors.tertiaryLabel as unknown as string}
          autoFocus
          multiline
        />
        <View style={styles.editActions}>
          <TouchableOpacity onPress={onCancelEdit} disabled={isSaving}>
            <Text style={styles.secondaryAction}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onSave}
            disabled={isSaving || !editingText.trim()}
          >
            <Text
              style={[
                styles.primaryAction,
                (isSaving || !editingText.trim()) && styles.actionDisabled,
              ]}
            >
              {isSaving ? "Saving…" : "Save"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.todoRow}>
      <Checkbox checked={false} onPress={onDismiss} disabled={isSaving} />
      <TouchableOpacity
        style={styles.todoTextWrap}
        onPress={onStartEdit}
        onLongPress={onStartEdit}
        activeOpacity={0.6}
      >
        <Text style={styles.todoText}>{capture.text}</Text>
        <Text style={styles.todoMeta}>
          {formatRelative(capture._creationTime)}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function TaskRow({ task }: { task: Task }) {
  return (
    <View style={styles.taskRow}>
      <PriorityDot priority={task.priority} />
      <View style={styles.taskMain}>
        <Text style={styles.taskTitle} numberOfLines={2}>
          {getTaskFirstLine(task.content)}
        </Text>
        <View style={styles.taskMetaRow}>
          {task.priority !== "triage" ? (
            <Text style={styles.taskMetaLabel}>
              {PRIORITY_LABELS[task.priority]}
            </Text>
          ) : null}
          {task.dueDate ? (
            <Text style={styles.taskMetaLabel}>Due {task.dueDate}</Text>
          ) : null}
          {task.tags.slice(0, 3).map((tag: TaskTag) => (
            <View key={tag._id} style={styles.tagChip}>
              <Text style={styles.tagChipText}>{tag.name}</Text>
            </View>
          ))}
        </View>
      </View>
      <StatusPill status={task.status} />
    </View>
  );
}

function NotConnected({
  onConnect,
  isConnecting,
  isPending,
}: {
  onConnect: () => void;
  isConnecting: boolean;
  isPending: boolean;
}) {
  const router = useRouter();
  return (
    <View style={sharedStyles.card}>
      <Text style={styles.cardTitle}>Tasky not connected</Text>
      <Text style={sharedStyles.muted}>
        Connect Tasky in Settings to view captures and tasks here.
      </Text>
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => router.push("/settings_page")}
        >
          <Text style={styles.secondaryButtonText}>Open Settings</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.primaryButton,
            (isConnecting || isPending) && styles.actionDisabled,
          ]}
          onPress={onConnect}
          disabled={isConnecting || isPending}
        >
          <Text style={styles.primaryButtonText}>
            {isConnecting ? "Connecting…" : "Connect Tasky"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function TaskyCapturesPage() {
  const taskyAuth = useTaskyAuth();
  const [tab, setTab] = useState<Tab>("captures");
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const taskyEnabled =
    taskyAuth.isAuthenticated && taskyAuth.convexAuthenticated;
  const captures = useTaskyQuery(
    taskyApi.captures.list,
    taskyEnabled ? { includeCompleted: false } : "skip",
  );
  const closedAfter = useMemo(() => Date.now() - 32 * 24 * 60 * 60 * 1000, []);
  const tasks = useTaskyQuery(
    taskyApi.tasks.list,
    taskyEnabled ? { closedAfter } : "skip",
  );

  const createCapture = useTaskyMutation(taskyApi.captures.create);
  const updateCapture = useTaskyMutation(taskyApi.captures.update);
  const toggleCapture = useTaskyMutation(taskyApi.captures.toggle);

  const sortedCaptures: Capture[] = captures.data ?? [];
  const openTasks = useMemo<Task[]>(
    () => (tasks.data ?? []).filter((task: Task) => task.status !== "closed"),
    [tasks.data],
  );

  const groupedTasks = useMemo(() => {
    const byStatus = new Map<TaskStatus, Task[]>();
    for (const task of openTasks) {
      const bucket = byStatus.get(task.status) ?? [];
      bucket.push(task);
      byStatus.set(task.status, bucket);
    }
    for (const list of byStatus.values()) {
      list.sort((a, b) => {
        const priorityDiff =
          PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return b._creationTime - a._creationTime;
      });
    }
    return STATUS_ORDER.filter((status) => byStatus.has(status)).map(
      (status) => ({
        status,
        items: byStatus.get(status)!,
      }),
    );
  }, [openTasks]);

  const handleConnect = async () => {
    setIsConnecting(true);
    setError(null);
    try {
      await taskyAuth.connect();
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Failed to connect Tasky",
      );
    } finally {
      setIsConnecting(false);
    }
  };

  const handleCreate = async () => {
    const text = draft.trim();
    if (!text) return;
    setIsSaving(true);
    setError(null);
    try {
      await createCapture({ text });
      setDraft("");
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Failed to create capture",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const startEditing = (capture: Capture) => {
    setEditingId(capture._id);
    setEditingText(capture.text);
    setError(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingText("");
  };

  const handleSaveEdit = async (capture: Capture) => {
    const text = editingText.trim();
    if (!text) return;
    setIsSaving(true);
    setError(null);
    try {
      await updateCapture({ id: capture._id, text });
      cancelEditing();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Failed to update capture",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDismiss = async (capture: Capture) => {
    setIsSaving(true);
    setError(null);
    try {
      await toggleCapture({ id: capture._id });
      if (editingId === capture._id) {
        cancelEditing();
      }
    } catch (dismissError) {
      setError(
        dismissError instanceof Error
          ? dismissError.message
          : "Failed to dismiss capture",
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (!taskyAuth.isAuthenticated) {
    return (
      <ScrollView
        style={sharedStyles.screen}
        contentContainerStyle={sharedStyles.screenContent}
        {...automaticKeyboardInsets}
      >
        <NotConnected
          onConnect={() => void handleConnect()}
          isConnecting={isConnecting}
          isPending={taskyAuth.isPending}
        />
        {(error || taskyAuth.error) && (
          <Text style={sharedStyles.error}>{error ?? taskyAuth.error}</Text>
        )}
      </ScrollView>
    );
  }

  if (!taskyEnabled) {
    return (
      <View style={[sharedStyles.screen, styles.centerColumn]}>
        <ActivityIndicator />
        <Text style={sharedStyles.muted}>Preparing Tasky…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={sharedStyles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={sharedStyles.screen}
        contentContainerStyle={[
          sharedStyles.screenContent,
          { paddingTop: spacing.md },
        ]}
        keyboardShouldPersistTaps="handled"
        {...automaticKeyboardInsets}
      >
        <SegmentedControl
          value={tab}
          onChange={setTab}
          options={[
            {
              value: "captures",
              label: "Captures",
              badge: sortedCaptures.length,
            },
            { value: "tasks", label: "Tasks", badge: openTasks.length },
          ]}
        />

        {tab === "captures" ? (
          <>
            <View style={styles.composer}>
              <TextInput
                style={styles.composerInput}
                value={draft}
                onChangeText={setDraft}
                placeholder="Capture something quick…"
                placeholderTextColor={colors.tertiaryLabel as unknown as string}
                multiline
                blurOnSubmit
                returnKeyType="done"
                onSubmitEditing={() => void handleCreate()}
              />
              <TouchableOpacity
                style={[
                  styles.composerButton,
                  (!draft.trim() || isSaving) && styles.actionDisabled,
                ]}
                onPress={() => void handleCreate()}
                disabled={!draft.trim() || isSaving}
              >
                <Text style={styles.composerButtonText}>
                  {isSaving ? "Saving…" : "Add"}
                </Text>
              </TouchableOpacity>
            </View>

            {captures.isLoading ? (
              <View style={sharedStyles.inlineLoading}>
                <ActivityIndicator />
                <Text style={sharedStyles.muted}>Loading captures…</Text>
              </View>
            ) : sortedCaptures.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>Inbox zero</Text>
                <Text style={sharedStyles.muted}>
                  Quick-capture anything above. Captures sync to Tasky so you
                  can triage them later.
                </Text>
              </View>
            ) : (
              <View style={styles.listCard}>
                {sortedCaptures.map((capture: Capture, index: number) => (
                  <View key={capture._id}>
                    {index > 0 ? <View style={styles.listDivider} /> : null}
                    <CaptureRow
                      capture={capture}
                      isEditing={editingId === capture._id}
                      editingText={editingText}
                      isSaving={isSaving}
                      onStartEdit={() => startEditing(capture)}
                      onCancelEdit={cancelEditing}
                      onChangeText={setEditingText}
                      onSave={() => void handleSaveEdit(capture)}
                      onDismiss={() => void handleDismiss(capture)}
                    />
                  </View>
                ))}
              </View>
            )}
          </>
        ) : tasks.isLoading ? (
          <View style={sharedStyles.inlineLoading}>
            <ActivityIndicator />
            <Text style={sharedStyles.muted}>Loading tasks…</Text>
          </View>
        ) : openTasks.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No open tasks</Text>
            <Text style={sharedStyles.muted}>
              You&rsquo;re all caught up. New tasks land here as you triage
              captures from the web app.
            </Text>
          </View>
        ) : (
          groupedTasks.map((group) => (
            <View key={group.status} style={styles.taskGroup}>
              <View style={styles.taskGroupHeader}>
                <Text style={styles.taskGroupTitle}>
                  {STATUS_LABELS[group.status]}
                </Text>
                <Text style={styles.taskGroupCount}>{group.items.length}</Text>
              </View>
              <View style={styles.listCard}>
                {group.items.map((task, index) => (
                  <View key={task._id}>
                    {index > 0 ? <View style={styles.listDivider} /> : null}
                    <TaskRow task={task} />
                  </View>
                ))}
              </View>
            </View>
          ))
        )}

        {(error || taskyAuth.error || captures.error || tasks.error) && (
          <Text style={sharedStyles.error}>
            {error ?? taskyAuth.error ?? captures.error ?? tasks.error}
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
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
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    backgroundColor: colors.secondarySystemGroupedBackground,
    borderRadius: radius.lg,
    padding: spacing.sm,
  },
  composerInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: fontSize.body,
    color: colors.label,
  },
  composerButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.systemBlue,
    borderRadius: radius.md,
  },
  composerButtonText: {
    color: "white",
    fontWeight: "700",
    fontSize: fontSize.body,
  },
  actionDisabled: {
    opacity: 0.4,
  },
  listCard: {
    borderRadius: radius.lg,
    backgroundColor: colors.secondarySystemGroupedBackground,
    overflow: "hidden",
  },
  listDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginLeft: spacing.xl + 22,
  },
  todoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  todoRowEditing: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  todoTextWrap: {
    flex: 1,
    gap: 2,
  },
  todoText: {
    fontSize: fontSize.body,
    color: colors.label,
    lineHeight: 21,
  },
  todoMeta: {
    fontSize: fontSize.caption,
    color: colors.tertiaryLabel,
  },
  checkbox: {
    width: 22,
    height: 22,
    marginTop: 2,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.systemGray,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: colors.systemBlue,
    borderColor: colors.systemBlue,
  },
  checkmark: {
    color: "white",
    fontSize: 14,
    fontWeight: "700",
  },
  editInput: {
    minHeight: 60,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.separator,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: fontSize.body,
    color: colors.label,
    backgroundColor: colors.systemBackground,
  },
  editActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.lg,
  },
  primaryAction: {
    fontSize: fontSize.body,
    fontWeight: "700",
    color: colors.systemBlue,
  },
  secondaryAction: {
    fontSize: fontSize.body,
    color: colors.secondaryLabel,
  },
  taskGroup: {
    gap: spacing.sm,
  },
  taskGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
  },
  taskGroupTitle: {
    fontSize: fontSize.caption,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: colors.secondaryLabel,
    textTransform: "uppercase",
  },
  taskGroupCount: {
    fontSize: fontSize.caption,
    color: colors.tertiaryLabel,
    fontVariant: ["tabular-nums"],
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  taskMain: {
    flex: 1,
    gap: spacing.xs,
  },
  taskTitle: {
    fontSize: fontSize.body,
    color: colors.label,
    lineHeight: 21,
  },
  taskMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  taskMetaLabel: {
    fontSize: fontSize.caption,
    color: colors.secondaryLabel,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    marginTop: 8,
  },
  tagChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.tertiarySystemGroupedBackground,
  },
  tagChipText: {
    fontSize: fontSize.micro,
    color: colors.secondaryLabel,
    fontWeight: "600",
  },
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  statusPillText: {
    fontSize: fontSize.micro,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  emptyState: {
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: fontSize.subhead,
    fontWeight: "700",
    color: colors.label,
  },
  centerColumn: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  cardTitle: {
    fontSize: fontSize.subhead,
    fontWeight: "700",
    color: colors.label,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  primaryButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.systemBlue,
  },
  primaryButtonText: {
    color: "white",
    fontWeight: "700",
    fontSize: fontSize.body,
  },
  secondaryButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.tertiarySystemGroupedBackground,
  },
  secondaryButtonText: {
    color: colors.label,
    fontWeight: "600",
    fontSize: fontSize.body,
  },
});
