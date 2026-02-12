import { type TaskStatus, type TaskPriority, taskStatusValues, taskPriorityValues } from "../../../convex/schema";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Tag } from "../../components/TagSelector";

export type { TaskStatus, TaskPriority };
export { taskStatusValues, taskPriorityValues };

export const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  not_started: { label: "Not Started", color: "#6b7280" },
  in_progress: { label: "In Progress", color: "#3b82f6" },
  blocked: { label: "Blocked", color: "#ef4444" },
  closed: { label: "Closed", color: "#22c55e" },
};

export const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string }> = {
  triage: { label: "Triage", color: "#6b7280" },
  low: { label: "Low", color: "#22c55e" },
  medium: { label: "Medium", color: "#f59e0b" },
  high: { label: "High", color: "#ef4444" },
};

export const STATUS_ORDER: TaskStatus[] = [...taskStatusValues];
export const PRIORITY_ORDER: TaskPriority[] = [...taskPriorityValues];

// Priority weight for sorting (higher number = higher priority = shown first)
// Triage (un-prioritized) is treated as highest priority so it appears first and gets attention
export const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  triage: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// Status weight for sorting (lower number = shown first in priority view)
export const STATUS_WEIGHT: Record<TaskStatus, number> = {
  not_started: 0,
  in_progress: 1,
  blocked: 2,
  closed: 3,
};

export type KanbanMode = "status" | "priority";

export type TaskForEdit = {
  _id: Id<"tasks">;
  content: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string;
  tags: Tag[];
};
