import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { taskyApi, useTaskyMutation } from "@/lib/tasky";
import { colors, fontSize, radius, sharedStyles, spacing } from "@/lib/theme";

export type Task = FunctionReturnType<typeof taskyApi.tasks.list>[number];
export type TaskStatus = Task["status"];
export type TaskPriority = Task["priority"];
type TaskTag = Task["tags"][number];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  agent_running: "Agent running",
  blocked: "Blocked",
  closed: "Closed",
};

export const STATUS_ORDER: TaskStatus[] = [
  "in_progress",
  "agent_running",
  "blocked",
  "not_started",
  "closed",
];

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  triage: "Triage",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const PRIORITY_ORDER: TaskPriority[] = [
  "triage",
  "low",
  "medium",
  "high",
  "urgent",
];

export const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  triage: 4,
};

const STATUS_COLORS: Record<TaskStatus, unknown> = {
  not_started: colors.secondaryLabel,
  in_progress: colors.systemBlue,
  agent_running: colors.systemPurple,
  blocked: colors.systemOrange,
  closed: colors.systemGreen,
};

const PRIORITY_COLORS: Record<TaskPriority, unknown> = {
  triage: colors.systemGray,
  low: colors.systemTeal,
  medium: colors.systemBlue,
  high: colors.systemOrange,
  urgent: colors.systemRed,
};

export function getTaskFirstLine(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "(untitled task)";
  const newline = trimmed.indexOf("\n");
  return newline === -1 ? trimmed : trimmed.slice(0, newline);
}

export function sortOpenTasks(tasks: Task[]): Task[] {
  return [...tasks]
    .filter((task) => task.status !== "closed")
    .sort((left, right) => {
      const priorityDiff =
        PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return right._creationTime - left._creationTime;
    });
}

export function useTaskFieldUpdates(): {
  savingTaskId: string | null;
  error: string | null;
  updateStatus: (task: Task, status: TaskStatus) => Promise<void>;
  updatePriority: (task: Task, priority: TaskPriority) => Promise<void>;
} {
  const updateTaskStatus = useTaskyMutation(taskyApi.tasks.updateStatus);
  const updateTaskPriority = useTaskyMutation(taskyApi.tasks.updatePriority);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return {
    savingTaskId,
    error,
    updateStatus: async (task, status) => {
      if (task.status === status) return;
      setSavingTaskId(task._id);
      setError(null);
      try {
        await updateTaskStatus({ id: task._id, status });
      } catch (statusError) {
        setError(
          statusError instanceof Error
            ? statusError.message
            : "Failed to update status",
        );
      } finally {
        setSavingTaskId(null);
      }
    },
    updatePriority: async (task, priority) => {
      if (task.priority === priority) return;
      setSavingTaskId(task._id);
      setError(null);
      try {
        await updateTaskPriority({ id: task._id, priority });
      } catch (priorityError) {
        setError(
          priorityError instanceof Error
            ? priorityError.message
            : "Failed to update priority",
        );
      } finally {
        setSavingTaskId(null);
      }
    },
  };
}

function ChoiceChip({
  label,
  selected,
  color,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  color: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.choiceChip,
        selected && { backgroundColor: color, borderColor: color },
      ]}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
    >
      <Text
        style={[
          styles.choiceChipText,
          selected && styles.choiceChipTextSelected,
        ]}
      >
        {label}
      </Text>
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

export function TaskRow({
  task,
  expanded,
  isSaving,
  onToggle,
  onStatusChange,
  onPriorityChange,
}: {
  task: Task;
  expanded: boolean;
  isSaving: boolean;
  onToggle: () => void;
  onStatusChange: (status: TaskStatus) => void;
  onPriorityChange: (priority: TaskPriority) => void;
}) {
  const firstLine = getTaskFirstLine(task.content);
  const trimmedContent = task.content.trim();

  return (
    <View style={expanded ? styles.taskRowExpanded : undefined}>
      <TouchableOpacity
        style={styles.taskRow}
        activeOpacity={0.7}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={firstLine}
      >
        <PriorityDot priority={task.priority} />
        <View style={styles.taskMain}>
          <Text
            style={styles.taskTitle}
            numberOfLines={expanded ? undefined : 2}
          >
            {expanded ? trimmedContent || firstLine : firstLine}
          </Text>
          {!expanded ? (
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
          ) : null}
        </View>
        <View style={styles.taskTrailing}>
          <StatusPill status={task.status} />
          <Text style={styles.taskChevron}>{expanded ? "⌃" : "›"}</Text>
        </View>
      </TouchableOpacity>
      {expanded ? (
        <View style={styles.taskDetails}>
          {task.dueDate ? (
            <Text style={styles.taskDetailLabel}>Due {task.dueDate}</Text>
          ) : null}
          <View style={styles.taskMetaRow}>
            {task.tags.length === 0 ? (
              <Text style={styles.taskDetailMuted}>No tags</Text>
            ) : (
              task.tags.map((tag: TaskTag) => (
                <View key={tag._id} style={styles.tagChip}>
                  {tag.color ? (
                    <View
                      style={[styles.tagDot, { backgroundColor: tag.color }]}
                    />
                  ) : null}
                  <Text style={styles.tagChipText}>{tag.name}</Text>
                </View>
              ))
            )}
          </View>
          <View style={styles.taskField}>
            <Text style={styles.taskFieldLabel}>Status</Text>
            <View style={styles.choiceRow}>
              {STATUS_ORDER.map((status) => (
                <ChoiceChip
                  key={status}
                  label={STATUS_LABELS[status]}
                  selected={task.status === status}
                  color={STATUS_COLORS[status] as unknown as string}
                  disabled={isSaving}
                  onPress={() => onStatusChange(status)}
                />
              ))}
            </View>
          </View>
          <View style={styles.taskField}>
            <Text style={styles.taskFieldLabel}>Priority</Text>
            <View style={styles.choiceRow}>
              {PRIORITY_ORDER.map((priority) => (
                <ChoiceChip
                  key={priority}
                  label={PRIORITY_LABELS[priority]}
                  selected={task.priority === priority}
                  color={PRIORITY_COLORS[priority] as unknown as string}
                  disabled={isSaving}
                  onPress={() => onPriorityChange(priority)}
                />
              ))}
            </View>
          </View>
          {isSaving ? (
            <View style={styles.taskSaving}>
              <ActivityIndicator size="small" />
              <Text style={sharedStyles.muted}>Saving…</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  taskRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  taskRowExpanded: {
    paddingBottom: spacing.md,
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
  taskTrailing: {
    alignItems: "flex-end",
    gap: spacing.xs,
  },
  taskChevron: {
    fontSize: 18,
    fontWeight: "300",
    color: colors.tertiaryLabel,
    lineHeight: 20,
  },
  taskDetails: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  taskDetailLabel: {
    fontSize: fontSize.caption,
    color: colors.secondaryLabel,
  },
  taskDetailMuted: {
    fontSize: fontSize.caption,
    color: colors.tertiaryLabel,
  },
  taskField: {
    gap: spacing.sm,
  },
  taskFieldLabel: {
    fontSize: fontSize.caption,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: colors.secondaryLabel,
    textTransform: "uppercase",
  },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  choiceChip: {
    height: 32,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.tertiarySystemGroupedBackground,
  },
  choiceChipText: {
    fontSize: fontSize.small,
    fontWeight: "600",
    color: colors.secondaryLabel,
  },
  choiceChipTextSelected: {
    color: "white",
  },
  taskSaving: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    marginTop: 8,
  },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.tertiarySystemGroupedBackground,
  },
  tagDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
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
});
