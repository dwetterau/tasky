"use client";

import { useAction } from "convex/react";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { extractCursorAgentExternalId } from "../../../convex/cursorAgentUrl";
import { useTrackedMutation } from "@/lib/useTrackedMutation";
import { useAuthSession } from "@/lib/useAuthSession";
import {
  looksLikeGitHubPullRequestInput,
  normalizeGitHubPullRequestInput,
  tryParseGitHubPullRequestReference,
} from "@/lib/githubPullRequestUrls";
import { TagSelector, Tag } from "../../components/TagSelector";
import { StyledSelect, type SelectOption } from "../../components/StyledSelect";
import { MarkdownEditor } from "../../components/MarkdownEditor";
import {
  type TaskStatus,
  type TaskPriority,
  type TaskListArgs,
  type TaskForEdit,
  createTaskListArgs,
  STATUS_CONFIG,
  STATUS_ORDER,
  PRIORITY_CONFIG,
  PRIORITY_ORDER,
  CURSOR_ICON_VIEWBOX,
  CURSOR_ICON_PATH,
  LINEAR_ICON_VIEWBOX,
  LINEAR_ICON_PATH,
  getAgentStatusInfo,
  getLinearIssueStatusInfo,
  getPullRequestStatusInfo,
  getPullRequestHref,
} from "./constants";
import { ConfirmModal } from "../../components/ConfirmModal";
import {
  AGENT_ALREADY_ATTACHED_TO_TASK_ERROR,
  AGENT_ALREADY_LINKED_ERROR,
  getLinearIssueAttachmentErrorMessage,
  getAgentAttachmentErrorMessage,
  getPullRequestAttachmentErrorMessage,
} from "./attachmentErrors";
import { StartAgentModal } from "./StartAgentModal";

function UnsavedChangesModal({
  isOpen,
  onClose,
  onDiscard,
}: {
  isOpen: boolean;
  onClose: () => void;
  onDiscard: () => void;
}) {
  const mouseDownTargetRef = useRef<EventTarget | null>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-60 flex items-center justify-center p-4 cursor-default"
      onMouseDown={(e) => { mouseDownTargetRef.current = e.target; }}
      onClick={(e) => { if (e.target === mouseDownTargetRef.current) onClose(); }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      
      {/* Modal */}
      <div 
        className="relative bg-(--card-bg) border border-(--card-border) rounded-2xl p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold">Unsaved Changes</h3>
        </div>
        
        <p className="text-(--muted) mb-6">
          You have unsaved changes. Are you sure you want to discard them?
        </p>
        
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-(--muted) hover:text-foreground transition-colors rounded-lg hover:bg-(--card-border)"
          >
            Keep Editing
          </button>
          <button
            onClick={onDiscard}
            className="px-4 py-2 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors font-medium"
          >
            Discard Changes
          </button>
        </div>
      </div>
    </div>
  );
}

export type TaskSearchArgs = {
  searchText?: string;
  tagId?: Id<"tags">;
  noTag?: boolean;
};

const LAST_SELECTED_TAG_KEY = "tasky-last-selected-tag";

function normalizePullRequestUrl(input: string): string {
  return normalizeGitHubPullRequestInput(input);
}

function normalizeLinearIssueUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function getLinearIssueIdentifierLabel(input: string): string {
  const normalized = normalizeLinearIssueUrl(input);
  try {
    const parsed = new URL(normalized);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const identifier = parts[2]?.toUpperCase();
    return identifier || normalized;
  } catch {
    return normalized;
  }
}

const LINEAR_ISSUE_URL_PATTERN = /(?:https?:\/\/)?(?:www\.)?linear\.app\/[^/]+\/issue\/[A-Z0-9]+-\d+/i;

function looksLikeGitHubPrUrl(input: string): boolean {
  return looksLikeGitHubPullRequestInput(input);
}

function looksLikeLinearIssueUrl(input: string): boolean {
  return LINEAR_ISSUE_URL_PATTERN.test(input.trim());
}

export function TaskModal({
  isOpen,
  onClose,
  task,
  allTags,
  initialTagId,
  initialContent,
  initialPendingAgentIds,
  createdFromCaptureId,
  activeSearchArgs,
  listArgs,
  onTaskCreated,
  onAttachAgent,
  onRemoveAgent,
  onAttachPr,
  onRemovePr,
  onAttachLinearIssue,
  onRemoveLinearIssue,
}: {
  isOpen: boolean;
  onClose: () => void;
  task?: TaskForEdit | null;
  allTags: Tag[];
  initialTagId?: Id<"tags"> | null;
  initialContent?: string;
  initialPendingAgentIds?: string[];
  createdFromCaptureId?: Id<"captures">;
  activeSearchArgs?: TaskSearchArgs;
  listArgs?: TaskListArgs;
  onTaskCreated?: (result: {
    taskId: Id<"tasks">;
    createdAgents: Array<{
      agentId: Id<"agents">;
      externalId: string;
    }>;
  }) => Promise<void> | void;
  onAttachAgent?: (args: { taskId: Id<"tasks">; externalId: string }) => Promise<void> | void;
  onRemoveAgent?: (id: Id<"agents">) => void;
  onAttachPr?: (args: { taskId: Id<"tasks">; url: string }) => Promise<void> | void;
  onRemovePr?: (id: Id<"pullRequests">) => void;
  onAttachLinearIssue?: (args: { taskId: Id<"tasks">; url: string }) => Promise<void> | void;
  onRemoveLinearIssue?: (id: Id<"linearIssues">) => void;
}) {
  const isEditing = !!task;
  const [defaultListArgs] = useState<TaskListArgs>(() => createTaskListArgs());
  const effectiveListArgs = listArgs ?? defaultListArgs;

  const [content, setContent] = useState("");
  const [tagIds, setTagIds] = useState<Id<"tags">[]>([]);
  const [status, setStatus] = useState<TaskStatus>("not_started");
  const [priority, setPriority] = useState<TaskPriority>("triage");
  const [dueDate, setDueDate] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showUnsavedChanges, setShowUnsavedChanges] = useState(false);
  const [prInput, setPrInput] = useState("");
  const [linearIssueInput, setLinearIssueInput] = useState("");
  const [agentInput, setAgentInput] = useState("");
  const [agentAttachError, setAgentAttachError] = useState<string | null>(null);
  const [prAttachError, setPrAttachError] = useState<string | null>(null);
  const [linearIssueAttachError, setLinearIssueAttachError] = useState<string | null>(null);
  const [isAttachingAgent, setIsAttachingAgent] = useState(false);
  const [isAttachingPr, setIsAttachingPr] = useState(false);
  const [isAttachingLinearIssue, setIsAttachingLinearIssue] = useState(false);
  const [pendingAgentExternalIds, setPendingAgentExternalIds] = useState<string[]>([]);
  const [pendingPullRequestUrls, setPendingPullRequestUrls] = useState<string[]>([]);
  const [pendingLinearIssueUrls, setPendingLinearIssueUrls] = useState<string[]>([]);
  const [showStartAgentModal, setShowStartAgentModal] = useState(false);
  const [isLaunchingStartedAgent, setIsLaunchingStartedAgent] = useState(false);
  const mouseDownTargetRef = useRef<EventTarget | null>(null);
  const { session } = useAuthSession();
  const launchAgent = useAction(api.agents.launch);

  const create = useTrackedMutation(api.tasks.create).withOptimisticUpdate(
    (localStore, args) => {
      const allTagsFull = localStore.getQuery(api.tags.list, {});
      const selectedTagsFull = (args.tagIds ?? [])
        .map((tagId) => allTagsFull?.find((t) => t._id === tagId))
        .filter((t): t is NonNullable<typeof t> => t !== undefined);

      const tempTask = {
        _id: crypto.randomUUID() as Id<"tasks">,
        _creationTime: Number.MAX_SAFE_INTEGER,
        userId: "",
        content: args.content,
        tagIds: args.tagIds ?? [],
        status: args.status ?? ("not_started" as const),
        priority: args.priority ?? ("triage" as const),
        dueDate: args.dueDate,
        tags: selectedTagsFull,
        agents: (args.agentExternalIds ?? []).map((externalId) => ({
          _id: crypto.randomUUID() as Id<"agents">,
          _creationTime: Number.MAX_SAFE_INTEGER,
          userId: "",
          taskId: "" as Id<"tasks">,
          externalId,
          link: `https://cursor.com/agents/${externalId}`,
          title: externalId,
          status: "",
          updatedAt: Date.now(),
        })),
        pullRequests: (args.pullRequestUrls ?? []).map((url) => {
          const parsed = tryParseGitHubPullRequestReference(url);
          return {
            _id: crypto.randomUUID() as Id<"pullRequests">,
            _creationTime: Number.MAX_SAFE_INTEGER,
            userId: "",
            taskId: "" as Id<"tasks">,
            url: normalizePullRequestUrl(url),
            normalized: parsed
              ? {
                  url: parsed.url,
                  domain: parsed.domain,
                  owner: parsed.owner,
                  repo: parsed.repo,
                  number: parsed.number,
                }
              : null,
            updatedAt: Date.now(),
          };
        }),
        linearIssues: (args.linearIssueUrls ?? []).map((url) => ({
          _id: crypto.randomUUID() as Id<"linearIssues">,
          _creationTime: Number.MAX_SAFE_INTEGER,
          userId: "",
          taskId: "" as Id<"tasks">,
          url: normalizeLinearIssueUrl(url),
          identifier: getLinearIssueIdentifierLabel(url),
          normalized: null,
          updatedAt: Date.now(),
        })),
      };

      const tasks = localStore.getQuery(api.tasks.list, effectiveListArgs);
      if (tasks !== undefined) {
        localStore.setQuery(api.tasks.list, effectiveListArgs, [tempTask, ...tasks]);
      }

      if (activeSearchArgs) {
        const searchTasks = localStore.getQuery(api.tasks.search, activeSearchArgs);
        if (searchTasks !== undefined) {
          const taskTagIds = args.tagIds ?? [];
          let matches = true;

          if (activeSearchArgs.noTag) {
            matches = taskTagIds.length === 0;
          } else if (activeSearchArgs.tagId) {
            const filterTag = allTagsFull?.find(t => t._id === activeSearchArgs.tagId);
            const matchingIds = new Set<Id<"tags">>([activeSearchArgs.tagId]);
            if (filterTag?.childrenRecursive) {
              for (const childId of filterTag.childrenRecursive) {
                matchingIds.add(childId);
              }
            }
            matches = taskTagIds.some(id => matchingIds.has(id));
          }
          if (activeSearchArgs.searchText && matches) {
            matches = args.content.toLowerCase().includes(activeSearchArgs.searchText.toLowerCase());
          }

          if (matches) {
            localStore.setQuery(api.tasks.search, activeSearchArgs, [tempTask, ...searchTasks]);
          }
        }
      }

      if (args.createdFromCaptureId) {
        for (const includeCompleted of [true, false]) {
          const captures = localStore.getQuery(api.captures.list, { includeCompleted });
          if (captures !== undefined) {
            localStore.setQuery(
              api.captures.list,
              { includeCompleted },
              captures.filter((c) => c._id !== args.createdFromCaptureId)
            );
          }
        }
      }
    }
  );

  const update = useTrackedMutation(api.tasks.update).withOptimisticUpdate(
    (localStore, args) => {
      const allTagsFull = localStore.getQuery(api.tags.list, {});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const applyUpdate = (t: any) => {
        if (t._id !== args.id) return t;
        return {
          ...t,
          content: args.content ?? t.content,
          tagIds: args.tagIds ?? t.tagIds,
          status: args.status ?? t.status,
          priority: args.priority ?? t.priority,
          dueDate: args.dueDate !== undefined
            ? (args.dueDate ?? undefined)
            : t.dueDate,
          tags: args.tagIds
            ? args.tagIds
                .map((tagId) => allTagsFull?.find((tag) => tag._id === tagId))
                .filter((tag): tag is NonNullable<typeof tag> => tag !== undefined)
            : t.tags,
        };
      };

      const tasks = localStore.getQuery(api.tasks.list, effectiveListArgs);
      if (tasks !== undefined) {
        localStore.setQuery(api.tasks.list, effectiveListArgs, tasks.map(applyUpdate));
      }

      if (activeSearchArgs) {
        const searchTasks = localStore.getQuery(api.tasks.search, activeSearchArgs);
        if (searchTasks !== undefined) {
          localStore.setQuery(api.tasks.search, activeSearchArgs, searchTasks.map(applyUpdate));
        }
      }
    }
  );

  const remove = useTrackedMutation(api.tasks.remove).withOptimisticUpdate(
    (localStore, args) => {
      const tasks = localStore.getQuery(api.tasks.list, effectiveListArgs);
      if (tasks !== undefined) {
        localStore.setQuery(api.tasks.list, effectiveListArgs, tasks.filter((t) => t._id !== args.id));
      }

      if (activeSearchArgs) {
        const searchTasks = localStore.getQuery(api.tasks.search, activeSearchArgs);
        if (searchTasks !== undefined) {
          localStore.setQuery(api.tasks.search, activeSearchArgs, searchTasks.filter((t) => t._id !== args.id));
        }
      }
    }
  );
  const createAgentRecord = useTrackedMutation(api.agents.createForTask);

  // Reset form when modal opens
  useEffect(() => {
    if (!isOpen) return;

    const timeoutId = window.setTimeout(() => {
      if (task) {
        setContent(task.content);
        setTagIds(task.tags.map((t) => t._id));
        setStatus(task.status);
        setPriority(task.priority);
        setDueDate(task.dueDate || "");
      } else {
        setContent(initialContent ?? "");
        setTagIds(initialTagId ? [initialTagId] : []);
        setStatus("not_started");
        setPriority("triage");
        setDueDate("");
      }
      setShowDeleteConfirm(false);
      setShowUnsavedChanges(false);
      setPrInput("");
      setLinearIssueInput("");
      setAgentInput("");
      setAgentAttachError(null);
      setPrAttachError(null);
      setLinearIssueAttachError(null);
      setIsAttachingAgent(false);
      setIsAttachingPr(false);
      setIsAttachingLinearIssue(false);
      setPendingAgentExternalIds(initialPendingAgentIds ?? []);
      setPendingPullRequestUrls([]);
      setPendingLinearIssueUrls([]);
      setShowStartAgentModal(false);
      setIsLaunchingStartedAgent(false);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [isOpen, task, initialTagId, initialContent, initialPendingAgentIds]);

  // Check if there are unsaved changes (edit mode only)
  const hasUnsavedChanges = useMemo(() => {
    if (!task) return false;
    const originalTagIds = task.tags.map((t) => t._id).sort();
    const currentTagIds = [...tagIds].sort();
    const tagsChanged =
      originalTagIds.length !== currentTagIds.length ||
      originalTagIds.some((id, i) => id !== currentTagIds[i]);

    return (
      content !== task.content ||
      status !== task.status ||
      priority !== task.priority ||
      dueDate !== (task.dueDate || "") ||
      tagsChanged
    );
  }, [content, status, priority, dueDate, tagIds, task]);

  // Handle close attempt - check for unsaved changes in edit mode
  const handleCloseAttempt = useCallback(() => {
    if (isEditing && hasUnsavedChanges) {
      setShowUnsavedChanges(true);
    } else {
      onClose();
    }
  }, [isEditing, hasUnsavedChanges, onClose]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !showDeleteConfirm && !showUnsavedChanges) {
        handleCloseAttempt();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, handleCloseAttempt, showDeleteConfirm, showUnsavedChanges]);

  useEffect(() => {
    if (!agentAttachError) return;
    const timeoutId = window.setTimeout(() => setAgentAttachError(null), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [agentAttachError]);

  useEffect(() => {
    if (!prAttachError) return;
    const timeoutId = window.setTimeout(() => setPrAttachError(null), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [prAttachError]);

  const selectedTags = tagIds
    .map((id) => allTags.find((t) => t._id === id))
    .filter((t): t is Tag => t !== undefined);

  const startAgentStorageKey = useMemo(
    () => String(session?.user.email ?? session?.user.name ?? "user"),
    [session]
  );

  const persistLastCaptureTag = useCallback((nextTagIds: Id<"tags">[]) => {
    if (typeof window === "undefined") return;
    const lastTagId = nextTagIds[nextTagIds.length - 1];
    if (lastTagId) {
      localStorage.setItem(LAST_SELECTED_TAG_KEY, lastTagId);
    } else {
      localStorage.removeItem(LAST_SELECTED_TAG_KEY);
    }
  }, []);

  const handleSubmit = () => {
    if (task) {
      update({
        id: task._id,
        content: content.trim(),
        tagIds,
        status,
        priority,
        dueDate: dueDate || null,
      });
      onClose();
    } else {
      if (createdFromCaptureId) {
        persistLastCaptureTag(tagIds);
      }
      const agentExternalIds =
        pendingAgentExternalIds.length > 0 ? pendingAgentExternalIds : undefined;
      const pullRequestUrls =
        pendingPullRequestUrls.length > 0 ? pendingPullRequestUrls : undefined;
      const linearIssueUrls =
        pendingLinearIssueUrls.length > 0 ? pendingLinearIssueUrls : undefined;

      // Close immediately so optimistic create can continue in background.
      onClose();
      void (async () => {
        const result = await create({
          content: content.trim(),
          tagIds: tagIds.length > 0 ? tagIds : undefined,
          status,
          priority,
          dueDate: dueDate || undefined,
          createdFromCaptureId,
          agentExternalIds,
          pullRequestUrls,
          linearIssueUrls,
        });
        await onTaskCreated?.(result);
      })();
      return;
    }
  };

  const handleDelete = () => {
    if (task) {
      remove({ id: task._id });
      setShowDeleteConfirm(false);
      onClose();
    }
  };

  if (!isOpen) return null;

  const parsedAgentExternalId = extractCursorAgentExternalId(agentInput);
  const canAddPendingAgent =
    !isEditing &&
    !!parsedAgentExternalId &&
    !pendingAgentExternalIds.includes(parsedAgentExternalId);
  const normalizedPendingPrInput = prInput.trim() ? normalizePullRequestUrl(prInput) : "";
  const canAddPendingPr =
    !isEditing &&
    normalizedPendingPrInput.length > 0 &&
    !pendingPullRequestUrls.includes(normalizedPendingPrInput);
  const normalizedPendingLinearIssueInput = linearIssueInput.trim()
    ? normalizeLinearIssueUrl(linearIssueInput)
    : "";
  const canAddPendingLinearIssue =
    !isEditing &&
    normalizedPendingLinearIssueInput.length > 0 &&
    !pendingLinearIssueUrls.includes(normalizedPendingLinearIssueInput);
  const shouldShowLinearIssuesSection =
    !isEditing ||
    (task?.linearIssues.length ?? 0) > 0 ||
    pendingLinearIssueUrls.length > 0 ||
    (isEditing && !!onAttachLinearIssue);

  const handleAttachAgentSubmit = async () => {
    if (!isEditing || !task || !onAttachAgent || !parsedAgentExternalId) return;
    setIsAttachingAgent(true);
    setAgentAttachError(null);
    try {
      await onAttachAgent({ taskId: task._id, externalId: parsedAgentExternalId });
      setAgentInput("");
    } catch (error) {
      setAgentAttachError(getAgentAttachmentErrorMessage(error));
    } finally {
      setIsAttachingAgent(false);
    }
  };

  const handleAttachPrSubmit = async () => {
    if (!isEditing || !task || !onAttachPr || !prInput.trim()) return;
    setIsAttachingPr(true);
    setPrAttachError(null);
    try {
      await onAttachPr({ taskId: task._id, url: prInput.trim() });
      setPrInput("");
    } catch (error) {
      setPrAttachError(getPullRequestAttachmentErrorMessage(error));
    } finally {
      setIsAttachingPr(false);
    }
  };

  const handleAttachLinearIssueSubmit = async () => {
    if (!isEditing || !task || !onAttachLinearIssue || !linearIssueInput.trim()) return;
    setIsAttachingLinearIssue(true);
    setLinearIssueAttachError(null);
    try {
      await onAttachLinearIssue({ taskId: task._id, url: linearIssueInput.trim() });
      setLinearIssueInput("");
    } catch (error) {
      setLinearIssueAttachError(getLinearIssueAttachmentErrorMessage(error));
    } finally {
      setIsAttachingLinearIssue(false);
    }
  };

  const handleStartAgent = async (args: { repository: string; branch: string; prompt: string }) => {
    setIsLaunchingStartedAgent(true);
    try {
      const launchedAgent = await launchAgent({
        repository: args.repository,
        branch: args.branch,
        promptText: args.prompt,
      });

      if (task) {
        const result = await createAgentRecord({
          taskId: task._id,
          externalId: launchedAgent.externalId,
          link: launchedAgent.link,
          title: launchedAgent.title,
          status: launchedAgent.status,
        });
        if (result.status === "already_attached_to_task") {
          throw new Error(AGENT_ALREADY_ATTACHED_TO_TASK_ERROR);
        }
        if (result.status === "linked_to_other_task") {
          throw new Error(AGENT_ALREADY_LINKED_ERROR);
        }
        if (result.status === "invalid_external_id") {
          throw new Error(result.message);
        }
        await onTaskCreated?.({
          taskId: task._id,
          createdAgents: [{ agentId: result.agentId, externalId: launchedAgent.externalId }],
        });
        return;
      }

      if (createdFromCaptureId) {
        persistLastCaptureTag(tagIds);
      }

      const fallbackContent = launchedAgent.title.trim();
      const createdTask = await create({
        content: content.trim() || fallbackContent,
        tagIds: tagIds.length > 0 ? tagIds : undefined,
        status,
        priority,
        dueDate: dueDate || undefined,
        createdFromCaptureId,
        agentExternalIds: pendingAgentExternalIds.length > 0 ? pendingAgentExternalIds : undefined,
        pullRequestUrls: pendingPullRequestUrls.length > 0 ? pendingPullRequestUrls : undefined,
        linearIssueUrls: pendingLinearIssueUrls.length > 0 ? pendingLinearIssueUrls : undefined,
      });

      const attachResult = await createAgentRecord({
        taskId: createdTask.taskId,
        externalId: launchedAgent.externalId,
        link: launchedAgent.link,
        title: launchedAgent.title,
        status: launchedAgent.status,
      });
      if (attachResult.status === "already_attached_to_task") {
        throw new Error(AGENT_ALREADY_ATTACHED_TO_TASK_ERROR);
      }
      if (attachResult.status === "linked_to_other_task") {
        throw new Error(AGENT_ALREADY_LINKED_ERROR);
      }
      if (attachResult.status === "invalid_external_id") {
        throw new Error(attachResult.message);
      }

      await onTaskCreated?.({
        taskId: createdTask.taskId,
        createdAgents: [
          ...createdTask.createdAgents,
          { agentId: attachResult.agentId, externalId: launchedAgent.externalId },
        ],
      });

      onClose();
    } finally {
      setIsLaunchingStartedAgent(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 cursor-default"
      onMouseDown={(e) => { mouseDownTargetRef.current = e.target; }}
      onClick={(e) => { if (e.target === mouseDownTargetRef.current) handleCloseAttempt(); }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      
      {/* Modal */}
      <div 
        className="relative bg-(--card-bg) border border-(--card-border) rounded-2xl max-w-2xl w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fixed header */}
        <div className="flex items-center justify-between gap-3 px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-(--accent)/10 flex items-center justify-center">
              {isEditing ? (
                <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              )}
            </div>
            <h3 className="text-lg font-semibold">{isEditing ? "Edit Task" : "Create Task"}</h3>
          </div>
          <div className="flex items-center gap-1">
            {isEditing && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="text-(--muted) hover:text-red-400 transition-colors p-2 rounded-lg hover:bg-red-400/10"
                title="Delete task"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
            <button
              onClick={handleCloseAttempt}
              className="text-(--muted) hover:text-foreground transition-colors p-2 rounded-lg hover:bg-(--card-border)"
              title="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 min-h-0">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-(--muted) mb-1">Content</label>
              <MarkdownEditor
                value={content}
                onChange={setContent}
                onSubmit={handleSubmit}
                placeholder="What needs to be done?"
                minHeight="200px"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-(--muted) mb-1">Priority</label>
                <StyledSelect
                  value={priority}
                  onChange={(v) => setPriority(v as TaskPriority)}
                  options={PRIORITY_ORDER.map((p): SelectOption => ({
                    value: p,
                    label: PRIORITY_CONFIG[p].label,
                    color: PRIORITY_CONFIG[p].color,
                  }))}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-(--muted) mb-1">Status</label>
                <StyledSelect
                  value={status}
                  onChange={(v) => setStatus(v as TaskStatus)}
                  options={STATUS_ORDER.map((s): SelectOption => ({
                    value: s,
                    label: STATUS_CONFIG[s].label,
                    color: STATUS_CONFIG[s].color,
                  }))}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-(--muted) mb-1">Due Date</label>
              <div className="relative w-full h-[38px] bg-background border border-(--card-border) rounded-lg focus-within:border-accent transition-colors">
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="absolute inset-0 w-full h-full px-3 bg-transparent focus:outline-none text-sm scheme-light dark:scheme-dark [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-(--muted)">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-(--muted) mb-1">Tags</label>
              <TagSelector
                selectedTags={selectedTags}
                onTagsChange={setTagIds}
                allTags={allTags}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
                {/* Agents section */}
                <div>
                  <label className="block text-xs font-medium text-(--muted) mb-1.5">Agents</label>
                  <div className="space-y-1.5">
                    {(isEditing ? task!.agents : []).map((agent) => {
                      const agentStatus = getAgentStatusInfo(agent.status);
                      return (
                        <div key={agent._id} className="flex items-center gap-1.5 group">
                          <a
                            href={agent.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-(--muted) hover:text-foreground transition-colors flex-1 min-w-0 bg-(--card-border)"
                            title={`${agent.externalId} · ${agentStatus.label}`}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: agentStatus.color }}
                              title={agentStatus.label}
                            />
                            <svg className="w-3 h-3.5 shrink-0 text-(--muted)" viewBox={CURSOR_ICON_VIEWBOX} fill="currentColor">
                              <path d={CURSOR_ICON_PATH} />
                            </svg>
                            <span className="truncate">{agent.title}</span>
                          </a>
                          {onRemoveAgent && (
                            <button
                              type="button"
                              onClick={() => onRemoveAgent(agent._id)}
                              className="p-0.5 rounded text-(--muted) opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-400/10 transition-all shrink-0"
                              title="Remove agent"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {isEditing && onAttachAgent && task && (
                      <form
                        className="space-y-1.5"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void handleAttachAgentSubmit();
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={agentInput}
                            onChange={(e) => {
                              const value = e.target.value;
                              setAgentInput(value);
                              setAgentAttachError(null);
                              const parsed = extractCursorAgentExternalId(value);
                              if (parsed && !isAttachingAgent) {
                                setAgentInput("");
                                setIsAttachingAgent(true);
                                void (async () => {
                                  try {
                                    await onAttachAgent({ taskId: task._id, externalId: parsed });
                                  } catch (error) {
                                    setAgentInput(value);
                                    setAgentAttachError(getAgentAttachmentErrorMessage(error));
                                  } finally {
                                    setIsAttachingAgent(false);
                                  }
                                })();
                              }
                            }}
                            placeholder="bc-... or agent URL"
                            disabled={isAttachingAgent}
                            className="flex-1 min-w-0 h-7 px-2 bg-background border border-(--card-border) rounded-md focus:outline-none focus:border-accent transition-colors text-xs disabled:opacity-60 disabled:cursor-not-allowed"
                          />
                          <button
                            type="submit"
                            disabled={!parsedAgentExternalId || isAttachingAgent}
                            className="p-1 rounded-md text-(--muted) hover:text-foreground hover:bg-(--card-border) transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                            title="Add agent"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                          </button>
                        </div>
                        {(agentAttachError || agentInput.trim()) && (
                          <p
                            className={`text-xs ${
                              agentAttachError || !parsedAgentExternalId ? "text-red-400" : "text-(--muted)"
                            }`}
                          >
                            {agentAttachError ??
                              (parsedAgentExternalId
                                ? `External ID: ${parsedAgentExternalId}`
                                : "Enter a Cursor agent URL or a bc-... external ID")}
                          </p>
                        )}
                      </form>
                    )}
                    {!isEditing && (
                      <>
                        {pendingAgentExternalIds.map((externalId) => (
                          <div key={externalId} className="flex items-center gap-1.5 group">
                            {(() => {
                              const pendingAgentStatus = getAgentStatusInfo("");
                              return (
                            <span
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-(--muted) flex-1 min-w-0"
                              style={{ backgroundColor: "var(--card-border)" }}
                              title={externalId}
                            >
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: pendingAgentStatus.color }} />
                              <svg
                                className="w-3 h-3.5 shrink-0 text-(--muted)"
                                viewBox={CURSOR_ICON_VIEWBOX}
                                fill="currentColor"
                              >
                                <path d={CURSOR_ICON_PATH} />
                              </svg>
                              <span className="truncate">{externalId}</span>
                            </span>
                              );
                            })()}
                            <button
                              type="button"
                              onClick={() =>
                                setPendingAgentExternalIds((current) =>
                                  current.filter((id) => id !== externalId)
                                )
                              }
                              className="p-0.5 rounded text-(--muted) hover:text-red-400 hover:bg-red-400/10 transition-all shrink-0"
                              title="Remove agent"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ))}
                        <form
                          className="flex items-center gap-1.5"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (!parsedAgentExternalId || pendingAgentExternalIds.includes(parsedAgentExternalId)) {
                              return;
                            }
                            setPendingAgentExternalIds((current) => [...current, parsedAgentExternalId]);
                            setAgentInput("");
                          }}
                        >
                          <input
                            type="text"
                            value={agentInput}
                            onChange={(e) => {
                              const value = e.target.value;
                              setAgentInput(value);
                              const parsed = extractCursorAgentExternalId(value);
                              if (parsed && !pendingAgentExternalIds.includes(parsed)) {
                                setPendingAgentExternalIds((current) => [...current, parsed]);
                                setAgentInput("");
                              }
                            }}
                            placeholder="bc-... or agent URL"
                            className="flex-1 min-w-0 h-7 px-2 bg-background border border-(--card-border) rounded-md focus:outline-none focus:border-accent transition-colors text-xs"
                          />
                          <button
                            type="submit"
                            disabled={!canAddPendingAgent}
                            className="p-1 rounded-md text-(--muted) hover:text-foreground hover:bg-(--card-border) transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                            title="Add agent"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                          </button>
                        </form>
                      </>
                    )}
                    {shouldShowLinearIssuesSection && (
                      <>
                        <div className="pt-2">
                          <label className="block text-xs font-medium text-(--muted) mb-1.5">
                            Linear Issues
                          </label>
                        </div>
                        {task?.linearIssues.map((linearIssue) => {
                          const label = linearIssue.identifier;
                          const status = getLinearIssueStatusInfo(linearIssue);
                          const title = linearIssue.title?.trim();
                          return (
                            <div key={linearIssue._id} className="flex items-center gap-1.5 group">
                              <a
                                href={getPullRequestHref(linearIssue.url)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-(--muted) hover:text-foreground transition-colors flex-1 min-w-0 bg-(--card-border)"
                                title={title ? `${label} · ${status.label} · ${title}` : `${label} · ${status.label}`}
                              >
                                <span
                                  className="w-1.5 h-1.5 rounded-full shrink-0"
                                  style={{ backgroundColor: status.color }}
                                  title={status.label}
                                />
                                <svg
                                  className="w-3.5 h-3.5 shrink-0 text-(--muted)"
                                  viewBox={LINEAR_ICON_VIEWBOX}
                                  fill="currentColor"
                                >
                                  <path d={LINEAR_ICON_PATH} />
                                </svg>
                                <span className="truncate">{title ? `${label} · ${title}` : label}</span>
                              </a>
                              {onRemoveLinearIssue && (
                                <button
                                  type="button"
                                  onClick={() => onRemoveLinearIssue(linearIssue._id)}
                                  className="p-0.5 rounded text-(--muted) opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-400/10 transition-all shrink-0"
                                  title="Remove Linear issue"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          );
                        })}
                        {isEditing && onAttachLinearIssue && task && (
                          <form
                            className="space-y-1.5"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void handleAttachLinearIssueSubmit();
                            }}
                          >
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={linearIssueInput}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setLinearIssueInput(value);
                                  setLinearIssueAttachError(null);
                                  if (looksLikeLinearIssueUrl(value) && !isAttachingLinearIssue) {
                                    setLinearIssueInput("");
                                    setIsAttachingLinearIssue(true);
                                    void (async () => {
                                      try {
                                        await onAttachLinearIssue({ taskId: task._id, url: value.trim() });
                                      } catch (error) {
                                        setLinearIssueInput(value);
                                        setLinearIssueAttachError(getLinearIssueAttachmentErrorMessage(error));
                                      } finally {
                                        setIsAttachingLinearIssue(false);
                                      }
                                    })();
                                  }
                                }}
                                placeholder="linear.app/team/issue/ENG-123"
                                disabled={isAttachingLinearIssue}
                                className="flex-1 min-w-0 h-7 px-2 bg-background border border-(--card-border) rounded-md focus:outline-none focus:border-accent transition-colors text-xs disabled:opacity-60 disabled:cursor-not-allowed"
                              />
                              <button
                                type="submit"
                                disabled={!linearIssueInput.trim() || isAttachingLinearIssue}
                                className="p-1 rounded-md text-(--muted) hover:text-foreground hover:bg-(--card-border) transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                                title="Add Linear issue"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                              </button>
                            </div>
                            {(linearIssueAttachError || linearIssueInput.trim()) && (
                              <p className={`text-xs ${linearIssueAttachError ? "text-red-400" : "text-(--muted)"}`}>
                                {linearIssueAttachError ??
                                  "Enter a Linear issue URL like linear.app/team/issue/ENG-123."}
                              </p>
                            )}
                          </form>
                        )}
                        {!isEditing && (
                          <>
                            {pendingLinearIssueUrls.map((url) => (
                              <div key={url} className="flex items-center gap-1.5 group">
                                <span
                                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-(--muted) flex-1 min-w-0"
                                  style={{ backgroundColor: "var(--card-border)" }}
                                  title={url}
                                >
                                  <span
                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{ backgroundColor: "#9ca3af" }}
                                  />
                                  <svg
                                    className="w-3.5 h-3.5 shrink-0 text-(--muted)"
                                    viewBox={LINEAR_ICON_VIEWBOX}
                                    fill="currentColor"
                                  >
                                    <path d={LINEAR_ICON_PATH} />
                                  </svg>
                                  <span className="truncate">{url}</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPendingLinearIssueUrls((current) =>
                                      current.filter((existingUrl) => existingUrl !== url)
                                    )
                                  }
                                  className="p-0.5 rounded text-(--muted) hover:text-red-400 hover:bg-red-400/10 transition-all shrink-0"
                                  title="Remove Linear issue"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            ))}
                            <form
                              className="flex items-center gap-1.5"
                              onSubmit={(e) => {
                                e.preventDefault();
                                if (
                                  !normalizedPendingLinearIssueInput ||
                                  pendingLinearIssueUrls.includes(normalizedPendingLinearIssueInput)
                                ) {
                                  return;
                                }
                                setPendingLinearIssueUrls((current) => [...current, normalizedPendingLinearIssueInput]);
                                setLinearIssueInput("");
                              }}
                            >
                              <input
                                type="text"
                                value={linearIssueInput}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setLinearIssueInput(value);
                                  if (looksLikeLinearIssueUrl(value)) {
                                    const normalized = normalizeLinearIssueUrl(value);
                                    if (normalized && !pendingLinearIssueUrls.includes(normalized)) {
                                      setPendingLinearIssueUrls((current) => [...current, normalized]);
                                      setLinearIssueInput("");
                                    }
                                  }
                                }}
                                placeholder="linear.app/team/issue/ENG-123"
                                className="flex-1 min-w-0 h-7 px-2 bg-background border border-(--card-border) rounded-md focus:outline-none focus:border-accent transition-colors text-xs"
                              />
                              <button
                                type="submit"
                                disabled={!canAddPendingLinearIssue}
                                className="p-1 rounded-md text-(--muted) hover:text-foreground hover:bg-(--card-border) transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                                title="Add Linear issue"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                              </button>
                            </form>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Pull Requests section */}
                <div>
                  <label className="block text-xs font-medium text-(--muted) mb-1.5">Pull Requests</label>
                  <div className="space-y-1.5">
                    {(isEditing ? task!.pullRequests : []).map((pr) => {
                      const label = pr.normalized
                        ? `#${pr.normalized.number} ${pr.normalized.owner}/${pr.normalized.repo}`
                        : pr.url;
                      const status = getPullRequestStatusInfo(pr);
                      return (
                        <div key={pr._id} className="flex items-center gap-1.5 group">
                          <a
                            href={getPullRequestHref(pr.url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-(--muted) hover:text-foreground transition-colors flex-1 min-w-0 bg-(--card-border)"
                            title={`${label} · ${status.label}`}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: status.color }}
                              title={status.label}
                            />
                            <svg className="w-3.5 h-3.5 shrink-0 text-(--muted)" viewBox="0 0 16 16" fill="currentColor">
                              <path d={status.iconPath} />
                            </svg>
                            <span className="truncate">{label}</span>
                          </a>
                          {onRemovePr && (
                            <button
                              type="button"
                              onClick={() => onRemovePr(pr._id)}
                              className="p-0.5 rounded text-(--muted) opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-400/10 transition-all shrink-0"
                              title="Remove pull request"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {isEditing && onAttachPr && task && (
                      <form
                        className="space-y-1.5"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void handleAttachPrSubmit();
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={prInput}
                            onChange={(e) => {
                              const value = e.target.value;
                              setPrInput(value);
                              setPrAttachError(null);
                              if (looksLikeGitHubPrUrl(value) && !isAttachingPr) {
                                setPrInput("");
                                setIsAttachingPr(true);
                                void (async () => {
                                  try {
                                    await onAttachPr({ taskId: task._id, url: value.trim() });
                                  } catch (error) {
                                    setPrInput(value);
                                    setPrAttachError(getPullRequestAttachmentErrorMessage(error));
                                  } finally {
                                    setIsAttachingPr(false);
                                  }
                                })();
                              }
                            }}
                            placeholder="github.com/owner/repo/pull/123"
                            disabled={isAttachingPr}
                            className="flex-1 min-w-0 h-7 px-2 bg-background border border-(--card-border) rounded-md focus:outline-none focus:border-accent transition-colors text-xs disabled:opacity-60 disabled:cursor-not-allowed"
                          />
                          <button
                            type="submit"
                            disabled={!prInput.trim() || isAttachingPr}
                            className="p-1 rounded-md text-(--muted) hover:text-foreground hover:bg-(--card-border) transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                            title="Add pull request"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                          </button>
                        </div>
                        {(prAttachError || prInput.trim()) && (
                          <p className={`text-xs ${prAttachError ? "text-red-400" : "text-(--muted)"}`}>
                            {prAttachError ??
                              "Enter a GitHub PR URL like github.com/owner/repo/pull/123 or review.cursor.com/github/pr/owner/repo/123."}
                          </p>
                        )}
                      </form>
                    )}
                    {!isEditing && (
                      <>
                        {pendingPullRequestUrls.map((url) => (
                          <div key={url} className="flex items-center gap-1.5 group">
                            {(() => {
                              const parsed = tryParseGitHubPullRequestReference(url);
                              const label = parsed ? `#${parsed.number} ${parsed.owner}/${parsed.repo}` : url;
                              const pendingPrStatus = getPullRequestStatusInfo({
                                _id: "" as Id<"pullRequests">,
                                taskId: "" as Id<"tasks">,
                                url,
                              });
                              return (
                            <span
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-(--muted) flex-1 min-w-0"
                              style={{ backgroundColor: "var(--card-border)" }}
                              title={label}
                            >
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: pendingPrStatus.color }} />
                              <svg
                                className="w-3.5 h-3.5 shrink-0 text-(--muted)"
                                viewBox="0 0 16 16"
                                fill="currentColor"
                              >
                                <path d={pendingPrStatus.iconPath} />
                              </svg>
                              <span className="truncate">{label}</span>
                            </span>
                              );
                            })()}
                            <button
                              type="button"
                              onClick={() =>
                                setPendingPullRequestUrls((current) =>
                                  current.filter((existingUrl) => existingUrl !== url)
                                )
                              }
                              className="p-0.5 rounded text-(--muted) hover:text-red-400 hover:bg-red-400/10 transition-all shrink-0"
                              title="Remove pull request"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ))}
                        <form
                          className="flex items-center gap-1.5"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (
                              !normalizedPendingPrInput ||
                              pendingPullRequestUrls.includes(normalizedPendingPrInput)
                            ) {
                              return;
                            }
                            setPendingPullRequestUrls((current) => [...current, normalizedPendingPrInput]);
                            setPrInput("");
                          }}
                        >
                          <input
                            type="text"
                            value={prInput}
                            onChange={(e) => {
                              const value = e.target.value;
                              setPrInput(value);
                              if (looksLikeGitHubPrUrl(value)) {
                                const normalized = normalizePullRequestUrl(value);
                                if (normalized && !pendingPullRequestUrls.includes(normalized)) {
                                  setPendingPullRequestUrls((current) => [...current, normalized]);
                                  setPrInput("");
                                }
                              }
                            }}
                            placeholder="github.com/owner/repo/pull/123"
                            className="flex-1 min-w-0 h-7 px-2 bg-background border border-(--card-border) rounded-md focus:outline-none focus:border-accent transition-colors text-xs"
                          />
                          <button
                            type="submit"
                            disabled={!canAddPendingPr}
                            className="p-1 rounded-md text-(--muted) hover:text-foreground hover:bg-(--card-border) transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                            title="Add pull request"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                          </button>
                        </form>
                      </>
                    )}
                  </div>
                </div>
              </div>
          </div>
        </div>

        {/* Fixed footer */}
        <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-4 border-t border-(--card-border) mt-4">
          <button
            type="button"
            onClick={() => setShowStartAgentModal(true)}
            disabled={isLaunchingStartedAgent}
            className="px-4 py-2 text-sm border border-(--card-border) text-foreground rounded-lg transition-colors font-medium hover:bg-(--card-border) flex items-center gap-2"
          >
            <svg className="w-3.5 h-4 shrink-0" viewBox={CURSOR_ICON_VIEWBOX} fill="currentColor" aria-hidden="true">
              <path d={CURSOR_ICON_PATH} />
            </svg>
            Start Agent
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={handleCloseAttempt}
              className="px-4 py-2 text-sm text-(--muted) hover:text-foreground transition-colors rounded-lg hover:bg-(--card-border)"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              className="px-4 py-2 text-sm bg-accent hover:bg-(--accent-hover) text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isEditing ? "Save Changes" : "Create Task"}
            </button>
          </div>
        </div>

        {showStartAgentModal && (
          <StartAgentModal
            isOpen={showStartAgentModal}
            onClose={() => setShowStartAgentModal(false)}
            storageKeySuffix={startAgentStorageKey}
            initialPrompt={content}
            onStart={handleStartAgent}
          />
        )}

        {isEditing && (
          <>
            <ConfirmModal
              isOpen={showDeleteConfirm}
              onClose={() => setShowDeleteConfirm(false)}
              onConfirm={handleDelete}
              title="Delete Task"
              message="Are you sure you want to delete this task? This action cannot be undone."
              itemPreview={task!.content}
              confirmLabel="Delete Task"
            />

            <UnsavedChangesModal
              isOpen={showUnsavedChanges}
              onClose={() => setShowUnsavedChanges(false)}
              onDiscard={onClose}
            />
          </>
        )}
      </div>
    </div>
  );
}
