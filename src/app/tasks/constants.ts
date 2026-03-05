import { type TaskStatus, type TaskPriority, taskStatusValues, taskPriorityValues } from "../../../convex/schema";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Tag } from "../../components/TagSelector";

export type { TaskStatus, TaskPriority };
export { taskStatusValues, taskPriorityValues };

export const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  not_started: { label: "Not Started", color: "#6b7280" },
  in_progress: { label: "In Progress", color: "#3b82f6" },
  agent_running: { label: "Agent Running", color: "#8b5cf6" },
  blocked: { label: "Blocked", color: "#ef4444" },
  closed: { label: "Closed", color: "#22c55e" },
};

export const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string }> = {
  triage: { label: "Triage", color: "#6b7280" },
  low: { label: "Low", color: "#22c55e" },
  medium: { label: "Medium", color: "#f59e0b" },
  high: { label: "High", color: "#ef4444" },
  urgent: { label: "Urgent", color: "#ec4899" },
};

export const STATUS_ORDER: TaskStatus[] = [...taskStatusValues];
export const PRIORITY_ORDER: TaskPriority[] = [...taskPriorityValues];

// Priority weight for sorting (higher number = higher priority = shown first)
export const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  triage: 5,
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// Status weight for sorting (lower number = shown first in priority view)
export const STATUS_WEIGHT: Record<TaskStatus, number> = {
  not_started: 0,
  in_progress: 1,
  agent_running: 2,
  blocked: 3,
  closed: 4,
};

export type KanbanMode = "status" | "priority";

export type AgentAttachment = {
  _id: Id<"agents">;
  taskId: Id<"tasks">;
  externalId: string;
  link: string;
  title: string;
  status: string;
  lastSyncedAt?: number;
};

export type PullRequestAttachment = {
  _id: Id<"pullRequests">;
  taskId: Id<"tasks">;
  url: string;
  githubState?: "OPEN" | "CLOSED" | "MERGED";
  isDraft?: boolean;
  isMerged?: boolean;
  lastSyncedAt?: number;
  normalized?: {
    domain: string;
    owner: string;
    repo: string;
    number: number;
  } | null;
};

export type TaskForEdit = {
  _id: Id<"tasks">;
  content: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string;
  tags: Tag[];
  agents: AgentAttachment[];
  pullRequests: PullRequestAttachment[];
};

export const CURSOR_ICON_VIEWBOX = "0 0 466.73 532.09";
export const CURSOR_ICON_PATH = "M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z";

export const PR_ICON_PATHS = {
  open: "M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z",
  merged: "M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z",
  closed: "M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97.97-.97a.748.748 0 0 1 1.265.332.75.75 0 0 1-.205.729l-.97.97.97.97a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-.97-.97-.97.97a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z",
  draft: "M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM14 7.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm0-4.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z",
} as const;

export function getAgentStatusInfo(status: string): { label: string; color: string } {
  const s = status.trim().toLowerCase();
  if (!s) return { label: "Unknown", color: "#9ca3af" };
  if (s === "finished") return { label: "Finished", color: "#22c55e" };
  if (s === "errored") return { label: "Errored", color: "#ef4444" };
  if (s === "running") return { label: "Running", color: "#3b82f6" };
  if (s === "creating") return { label: "Creating", color: "#3b82f6" };
  if (s === "archived") return { label: "Archived", color: "#9ca3af" };
  if (s === "expired") return { label: "Expired", color: "#9ca3af" };
  return { label: status, color: "#9ca3af" };
}

export function getPullRequestStatusInfo(pullRequest: PullRequestAttachment): {
  label: string;
  color: string;
  iconPath: string;
} {
  const githubState = String((pullRequest as { githubState?: unknown }).githubState ?? "").toUpperCase();
  if (pullRequest.isMerged || githubState === "MERGED") {
    return { label: "Merged", color: "#a78bfa", iconPath: PR_ICON_PATHS.merged };
  }
  if (githubState === "OPEN") {
    return { label: "Open", color: "#22c55e", iconPath: PR_ICON_PATHS.open };
  }
  if (pullRequest.isDraft) {
    return { label: "Draft", color: "#9ca3af", iconPath: PR_ICON_PATHS.draft };
  }
  if (githubState === "CLOSED") {
    return { label: "Closed", color: "#ef4444", iconPath: PR_ICON_PATHS.closed };
  }
  return { label: "Unknown", color: "#9ca3af", iconPath: PR_ICON_PATHS.open };
}

export function getPullRequestHref(url: string): string {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) ? url : `https://${url}`;
}
