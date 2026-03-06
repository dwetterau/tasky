"use client";

import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useTrackedMutation } from "@/lib/useTrackedMutation";
import { Id } from "../../../convex/_generated/dataModel";
import { Navigation } from "../../components/Navigation";
import { SearchTagSelector, Tag } from "../../components/TagSelector";
import { useAuthSession } from "@/lib/useAuthSession";
import { SignIn } from "@/components/SignIn";
import ReactMarkdown from "react-markdown";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { usePageTagFilter } from "@/lib/usePageTagFilter";
import { CapturesSidebar } from "@/components/CapturesSidebar";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { TaskModal, type TaskSearchArgs } from "./TaskModal";
import {
  type TaskStatus,
  type TaskPriority,
  type TaskForEdit,
  type AgentAttachment,
  type PullRequestAttachment,
  type KanbanMode,
  STATUS_CONFIG,
  STATUS_ORDER,
  PRIORITY_CONFIG,
  PRIORITY_ORDER,
  PRIORITY_WEIGHT,
  STATUS_WEIGHT,
  CURSOR_ICON_VIEWBOX,
  CURSOR_ICON_PATH,
  PR_ICON_PATHS,
  getAgentStatusInfo,
  getPullRequestStatusInfo,
  getPullRequestHref,
} from "./constants";
import { AttachAgentModal } from "./AttachAgentModal";
import { AttachPrModal } from "./AttachPrModal";

function formatDueDateForViewer(dueDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if (!match) {
    const fallbackDate = new Date(dueDate);
    return Number.isNaN(fallbackDate.getTime())
      ? dueDate
      : fallbackDate.toLocaleDateString();
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const localDate = new Date(year, monthIndex, day);

  // Guard against invalid/overflowing values (e.g. 2026-02-31).
  if (
    Number.isNaN(localDate.getTime()) ||
    localDate.getFullYear() !== year ||
    localDate.getMonth() !== monthIndex ||
    localDate.getDate() !== day
  ) {
    return dueDate;
  }

  return localDate.toLocaleDateString();
}

type TaskView = {
  _id: Id<"tasks">;
  _creationTime: number;
  content: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string;
  completedAt?: number;
  tags: Tag[];
  agents: AgentAttachment[];
  pullRequests: PullRequestAttachment[];
};

function parseGitHubPrUrl(rawUrl: string): PullRequestAttachment["normalized"] {
  try {
    const parseInput = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawUrl.trim())
      ? rawUrl.trim()
      : `https://${rawUrl.trim()}`;
    const parsed = new URL(parseInput);
    const hostname = parsed.hostname.toLowerCase();
    const domain = hostname === "www.github.com" ? "github.com" : hostname;
    if (domain !== "github.com") return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 4 || parts[2].toLowerCase() !== "pull") return null;
    const number = Number(parts[3]);
    if (!Number.isInteger(number) || number <= 0) return null;
    return {
      domain,
      owner: parts[0].toLowerCase(),
      repo: parts[1].toLowerCase(),
      number,
    };
  } catch {
    return null;
  }
}


function TaskCard({
  task,
  kanbanMode,
  isDragging: isDraggingProp,
  isColumnDropTarget,
  onOpenEditModal,
  onOpenAttachAgentModal,
  onOpenAttachPrModal,
}: {
  task: TaskView;
  kanbanMode: KanbanMode;
  isDragging?: boolean;
  isColumnDropTarget?: boolean;
  onOpenEditModal?: () => void;
  onOpenAttachAgentModal?: () => void;
  onOpenAttachPrModal?: () => void;
}) {
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const hasDraggedRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const el = contentRef.current;
    if (el) {
      setIsOverflowing(el.scrollHeight > el.clientHeight);
    }
  }, [task.content]);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task._id });

  const style = {
    transform: CSS.Transform.toString(transform),
    // Only use transform transitions, not opacity - opacity changes should be instant
    transition: transition ? transition.replace(/opacity[^,]*(,|$)/g, '').trim().replace(/,$/, '') || undefined : undefined,
    // Hide the original card completely when it's being dragged (DragOverlay shows the visual)
    opacity: isDragging ? 0 : isColumnDropTarget ? 0.4 : 1,
  };

  // In status mode, accent bar shows priority color
  // In priority mode, accent bar shows status color
  const accentColor = kanbanMode === "status" 
    ? PRIORITY_CONFIG[task.priority].color 
    : STATUS_CONFIG[task.status].color;

  // Track drag vs click - if we moved more than 8px, it's a drag
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
    hasDraggedRef.current = false;
    // Call dnd-kit's onPointerDown handler
    const dndPointerDown = listeners?.onPointerDown as ((e: React.PointerEvent<HTMLDivElement>) => void) | undefined;
    dndPointerDown?.(e);
  };

  const handleClick = (e: React.MouseEvent) => {
    // Don't open modal if we dragged, or if clicking on a link or button
    if (hasDraggedRef.current) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'A' || target.tagName === 'BUTTON' || target.closest('a') || target.closest('button')) {
      return;
    }
    onOpenEditModal?.();
  };

  // Listen for drag start from dnd-kit to mark as dragged
  useEffect(() => {
    if (isDragging) {
      hasDraggedRef.current = true;
    }
  }, [isDragging]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      className={`group relative bg-(--card-bg) border border-(--card-border) rounded-xl overflow-hidden transition-all duration-200 [&:hover:not(:has(a:hover))]:border-(--accent)/30 flex cursor-grab active:cursor-grabbing ${isDraggingProp ? "ring-2 ring-accent shadow-lg" : ""}`}
    >
      {/* Accent bar */}
      <div
        className="w-1 shrink-0"
        style={{ backgroundColor: accentColor }}
      />

      <div className="flex-1 p-4 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex flex-wrap gap-1.5">
            {task.tags.length === 0 ? (
              <span className="text-xs text-(--muted)">No tags</span>
            ) : (
              task.tags.map((tag) => (
                <span
                  key={tag._id}
                  className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium"
                  style={{
                    backgroundColor: tag.color ? `${tag.color}20` : "var(--accent-muted)",
                    color: tag.color || "var(--accent)",
                  }}
                >
                  {tag.name}
                </span>
              ))
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenAttachAgentModal?.();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-1 rounded text-(--muted) opacity-40 hover:opacity-100 hover:text-foreground hover:bg-(--card-border) transition-all"
              title="Attach agent"
            >
              <svg className="w-3.5 h-4 shrink-0" viewBox={CURSOR_ICON_VIEWBOX} fill="currentColor">
                <path d={CURSOR_ICON_PATH} />
              </svg>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenAttachPrModal?.();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-1 rounded text-(--muted) opacity-40 hover:opacity-100 hover:text-foreground hover:bg-(--card-border) transition-all"
              title="Attach pull request"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d={PR_ICON_PATHS.open} />
              </svg>
            </button>
          </div>
        </div>

        <div className="relative">
          <div
            ref={contentRef}
            className="prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2 text-sm wrap-break-word prose-a:text-accent prose-a:no-underline max-h-[200px] overflow-hidden"
          >
            <ReactMarkdown
              components={{
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="text-accent hover:underline"
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {task.content}
            </ReactMarkdown>
          </div>
          {isOverflowing && (
            <div className="absolute bottom-0 left-0 right-0 h-16 bg-linear-to-t from-(--card-bg) to-transparent pointer-events-none" />
          )}
        </div>

        {(task.dueDate || (kanbanMode === "status" && task.priority !== "triage") || (kanbanMode === "priority" && task.status !== "not_started")) && (
          <div className="flex items-center gap-3 mt-3 text-xs text-(--muted)">
            {task.dueDate && (
              <span className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {formatDueDateForViewer(task.dueDate)}
              </span>
            )}
            {/* In status mode, show priority badge. In priority mode, show status badge */}
            {kanbanMode === "status" && task.priority !== "triage" && (
              <span
                className="px-1.5 py-0.5 rounded text-xs font-medium"
                style={{
                  backgroundColor: `${PRIORITY_CONFIG[task.priority].color}20`,
                  color: PRIORITY_CONFIG[task.priority].color,
                }}
              >
                {PRIORITY_CONFIG[task.priority].label}
              </span>
            )}
            {kanbanMode === "priority" && task.status !== "not_started" && (
              <span
                className="px-1.5 py-0.5 rounded text-xs font-medium"
                style={{
                  backgroundColor: `${STATUS_CONFIG[task.status].color}20`,
                  color: STATUS_CONFIG[task.status].color,
                }}
              >
                {STATUS_CONFIG[task.status].label}
              </span>
            )}
          </div>
        )}

        {(task.pullRequests.length > 0 || task.agents.length > 0) && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {task.pullRequests.map((pullRequest) => {
              const label = pullRequest.normalized
                ? `${pullRequest.normalized.owner}/${pullRequest.normalized.repo}#${pullRequest.normalized.number}`
                : pullRequest.url;
              const status = getPullRequestStatusInfo(pullRequest);
              return (
                <a
                  key={pullRequest._id}
                  href={getPullRequestHref(pullRequest.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs text-(--muted) hover:text-foreground transition-colors bg-(--card-border)"
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
                  {label}
                </a>
              );
            })}
            {task.agents.map((agent) => {
              const agentStatus = getAgentStatusInfo(agent.status);
              return (
                <a
                  key={agent._id}
                  href={agent.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs text-(--muted) hover:text-foreground transition-colors bg-(--card-border)"
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
                  {agent.title}
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function KanbanColumn({
  columnId,
  columnValue,
  tasks,
  kanbanMode,
  isDropTarget,
  onOpenEditModal,
  onOpenAttachAgentModal,
  onOpenAttachPrModal,
}: {
  columnId: string;
  columnValue: TaskStatus | TaskPriority;
  tasks: TaskView[];
  kanbanMode: KanbanMode;
  isDropTarget?: boolean;
  onOpenEditModal: (task: TaskForEdit) => void;
  onOpenAttachAgentModal: (taskId: Id<"tasks">) => void;
  onOpenAttachPrModal: (taskId: Id<"tasks">) => void;
}) {
  const { setNodeRef } = useDroppable({ id: columnId });
  
  const config = kanbanMode === "status" 
    ? STATUS_CONFIG[columnValue as TaskStatus]
    : PRIORITY_CONFIG[columnValue as TaskPriority];

  return (
    <div 
      ref={setNodeRef}
      className="shrink-0 w-[280px] flex flex-col overflow-hidden"
    >
      {/* Sticky header with gradient fade */}
      <div className="sticky top-0 z-10 bg-background pb-1">
        <div className="flex items-center gap-2 px-1 py-2">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: config.color }}
          />
          <h3 className="font-medium text-sm">{config.label}</h3>
          <span className="text-xs text-(--muted) bg-(--card-border) px-2 py-0.5 rounded-full">
            {tasks.length}
          </span>
        </div>
        {/* Gradient fade effect */}
        <div className="h-4 bg-linear-to-b from-background to-transparent -mb-4" />
      </div>

      <div className={`space-y-3 flex-1 p-2 pt-4 rounded-xl transition-all duration-200 overflow-y-auto ${isDropTarget ? "bg-(--accent)/10 ring-2 ring-(--accent)/30 ring-inset" : ""}`}>
        {tasks.map((task) => (
          <TaskCard 
            key={task._id} 
            task={task} 
            kanbanMode={kanbanMode} 
            isColumnDropTarget={isDropTarget}
            onOpenEditModal={() => onOpenEditModal(task)}
            onOpenAttachAgentModal={() => onOpenAttachAgentModal(task._id)}
            onOpenAttachPrModal={() => onOpenAttachPrModal(task._id)}
          />
        ))}
        {tasks.length === 0 && (
          <div className={`text-center py-8 text-(--muted) text-sm border-2 border-dashed rounded-xl transition-all duration-200 ${isDropTarget ? "border-accent bg-(--accent)/10 scale-[1.02]" : "border-(--card-border)"}`}>
            {isDropTarget ? "Drop here" : "No tasks"}
          </div>
        )}
      </div>
    </div>
  );
}

function TasksList() {
  const [searchText, setSearchText] = useState("");
  const [debouncedSearchText, setDebouncedSearchText] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [kanbanMode, setKanbanMode] = useState<KanbanMode>("status");
  const [hideClosed, setHideClosed] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<Id<"tasks"> | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<Id<"tasks"> | null>(null);
  const [attachAgentTaskId, setAttachAgentTaskId] = useState<Id<"tasks"> | null>(null);
  const [attachPrTaskId, setAttachPrTaskId] = useState<Id<"tasks"> | null>(null);
  const [isRefreshingLinks, setIsRefreshingLinks] = useState(false);

  const { allTags, selectedTag, selectedTagId, selectedNoTag, handleTagChange } =
    usePageTagFilter({ allowNoTag: true });

  // Refs to capture current filter state for optimistic updates
  const searchTextRef = useRef<string>("");
  const selectedTagIdRef = useRef<Id<"tags"> | null>(null);
  const selectedNoTagRef = useRef<boolean>(false);

  // Drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  // Mutations for drag-and-drop
  // Note: The refs are accessed in optimistic update callbacks which run at mutation-invocation
  // time (during drag-and-drop), not during render. This is safe despite the lint warning.
  const updateStatus = useTrackedMutation(api.tasks.updateStatus).withOptimisticUpdate(
    (localStore, args) => {
      const now = Date.now();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const applyStatusUpdate = (t: any) => {
        if (t._id !== args.id) return t;
        const nextCompletedAt =
          args.status === "closed" && t.status !== "closed"
            ? now
            : args.status !== "closed" && t.status === "closed"
              ? undefined
              : t.completedAt;
        const nextStatusUpdatedAt = args.status !== t.status ? now : t.statusUpdatedAt;
        return {
          ...t,
          status: args.status,
          completedAt: nextCompletedAt,
          statusUpdatedAt: nextStatusUpdatedAt,
        };
      };

      // Update the main list query
      const listTasks = localStore.getQuery(api.tasks.list, {});
      if (listTasks !== undefined) {
        localStore.setQuery(
          api.tasks.list,
          {},
          listTasks.map(applyStatusUpdate)
        );
      }

      // Also update the search query if filters are active
      const currentSearchText = searchTextRef.current.trim() || undefined;
      const currentTagId = selectedTagIdRef.current ?? undefined;
      const currentNoTag = selectedNoTagRef.current || undefined;
      if (currentSearchText !== undefined || currentTagId !== undefined || currentNoTag !== undefined) {
        const searchArgs = { searchText: currentSearchText, tagId: currentTagId, noTag: currentNoTag };
        const searchTasks = localStore.getQuery(api.tasks.search, searchArgs);
        if (searchTasks !== undefined) {
          localStore.setQuery(
            api.tasks.search,
            searchArgs,
            searchTasks.map(applyStatusUpdate)
          );
        }
      }
    }
  );

  const updatePriority = useTrackedMutation(api.tasks.updatePriority).withOptimisticUpdate(
    (localStore, args) => {
      // Update the main list query
      const listTasks = localStore.getQuery(api.tasks.list, {});
      if (listTasks !== undefined) {
        localStore.setQuery(
          api.tasks.list,
          {},
          listTasks.map((t) => {
            if (t._id !== args.id) return t;
            return { ...t, priority: args.priority };
          })
        );
      }

      // Also update the search query if filters are active
      const currentSearchText = searchTextRef.current.trim() || undefined;
      const currentTagId = selectedTagIdRef.current ?? undefined;
      const currentNoTag = selectedNoTagRef.current || undefined;
      if (currentSearchText !== undefined || currentTagId !== undefined || currentNoTag !== undefined) {
        const searchArgs = { searchText: currentSearchText, tagId: currentTagId, noTag: currentNoTag };
        const searchTasks = localStore.getQuery(api.tasks.search, searchArgs);
        if (searchTasks !== undefined) {
          localStore.setQuery(
            api.tasks.search,
            searchArgs,
            searchTasks.map((t) => {
              if (t._id !== args.id) return t;
              return { ...t, priority: args.priority };
            })
          );
        }
      }
    }
  );

  const createAgent = useTrackedMutation(api.agents.createForTask).withOptimisticUpdate(
    (localStore, args) => {
      const now = Date.now();
      const tempAgent = {
        _id: crypto.randomUUID() as Id<"agents">,
        _creationTime: Number.MAX_SAFE_INTEGER,
        userId: "",
        taskId: args.taskId,
        externalId: args.externalId,
        link: args.link,
        title: args.title,
        status: args.status,
        lastSyncedAt: undefined,
        updatedAt: now,
      };

      const applyToTask = <T extends { _id: Id<"tasks">; agents?: AgentAttachment[] }>(task: T): T =>
        task._id === args.taskId
          ? ({ ...task, agents: [tempAgent, ...(task.agents ?? [])] } as T)
          : task;

      const listTasks = localStore.getQuery(api.tasks.list, {});
      if (listTasks !== undefined) {
        localStore.setQuery(api.tasks.list, {}, listTasks.map((task) => applyToTask(task)));
      }

      const currentSearchText = searchTextRef.current.trim() || undefined;
      const currentTagId = selectedTagIdRef.current ?? undefined;
      const currentNoTag = selectedNoTagRef.current || undefined;
      if (currentSearchText !== undefined || currentTagId !== undefined || currentNoTag !== undefined) {
        const searchArgs = { searchText: currentSearchText, tagId: currentTagId, noTag: currentNoTag };
        const searchTasks = localStore.getQuery(api.tasks.search, searchArgs);
        if (searchTasks !== undefined) {
          localStore.setQuery(
            api.tasks.search,
            searchArgs,
            searchTasks.map((task) => applyToTask(task))
          );
        }
      }
    }
  );

  const createPullRequest = useTrackedMutation(api.pullRequests.createForTask).withOptimisticUpdate(
    (localStore, args) => {
      const now = Date.now();
      const tempPullRequest = {
        _id: crypto.randomUUID() as Id<"pullRequests">,
        _creationTime: Number.MAX_SAFE_INTEGER,
        userId: "",
        taskId: args.taskId,
        url: args.url,
        githubState: undefined,
        isDraft: undefined,
        isMerged: undefined,
        lastSyncedAt: undefined,
        normalized: parseGitHubPrUrl(args.url),
        updatedAt: now,
      };

      const applyToTask = <T extends { _id: Id<"tasks">; pullRequests?: PullRequestAttachment[] }>(
        task: T
      ): T =>
        task._id === args.taskId
          ? ({ ...task, pullRequests: [tempPullRequest, ...(task.pullRequests ?? [])] } as T)
          : task;

      const listTasks = localStore.getQuery(api.tasks.list, {});
      if (listTasks !== undefined) {
        localStore.setQuery(api.tasks.list, {}, listTasks.map((task) => applyToTask(task)));
      }

      const currentSearchText = searchTextRef.current.trim() || undefined;
      const currentTagId = selectedTagIdRef.current ?? undefined;
      const currentNoTag = selectedNoTagRef.current || undefined;
      if (currentSearchText !== undefined || currentTagId !== undefined || currentNoTag !== undefined) {
        const searchArgs = { searchText: currentSearchText, tagId: currentTagId, noTag: currentNoTag };
        const searchTasks = localStore.getQuery(api.tasks.search, searchArgs);
        if (searchTasks !== undefined) {
          localStore.setQuery(
            api.tasks.search,
            searchArgs,
            searchTasks.map((task) => applyToTask(task))
          );
        }
      }
    }
  );
  const removeAgent = useTrackedMutation(api.agents.remove).withOptimisticUpdate(
    (localStore, args) => {
      const removeFromTask = <T extends { _id: Id<"tasks">; agents?: AgentAttachment[] }>(t: T): T => ({
        ...t,
        agents: (t.agents ?? []).filter((a) => a._id !== args.id),
      });
      const listTasks = localStore.getQuery(api.tasks.list, {});
      if (listTasks !== undefined) {
        localStore.setQuery(api.tasks.list, {}, listTasks.map(removeFromTask));
      }
      const currentSearchText = searchTextRef.current.trim() || undefined;
      const currentTagId = selectedTagIdRef.current ?? undefined;
      const currentNoTag = selectedNoTagRef.current || undefined;
      if (currentSearchText !== undefined || currentTagId !== undefined || currentNoTag !== undefined) {
        const searchArgs = { searchText: currentSearchText, tagId: currentTagId, noTag: currentNoTag };
        const searchTasks = localStore.getQuery(api.tasks.search, searchArgs);
        if (searchTasks !== undefined) {
          localStore.setQuery(api.tasks.search, searchArgs, searchTasks.map(removeFromTask));
        }
      }
    }
  );
  const removePullRequest = useTrackedMutation(api.pullRequests.remove).withOptimisticUpdate(
    (localStore, args) => {
      const removeFromTask = <T extends { _id: Id<"tasks">; pullRequests?: PullRequestAttachment[] }>(t: T): T => ({
        ...t,
        pullRequests: (t.pullRequests ?? []).filter((pr) => pr._id !== args.id),
      });
      const listTasks = localStore.getQuery(api.tasks.list, {});
      if (listTasks !== undefined) {
        localStore.setQuery(api.tasks.list, {}, listTasks.map(removeFromTask));
      }
      const currentSearchText = searchTextRef.current.trim() || undefined;
      const currentTagId = selectedTagIdRef.current ?? undefined;
      const currentNoTag = selectedNoTagRef.current || undefined;
      if (currentSearchText !== undefined || currentTagId !== undefined || currentNoTag !== undefined) {
        const searchArgs = { searchText: currentSearchText, tagId: currentTagId, noTag: currentNoTag };
        const searchTasks = localStore.getQuery(api.tasks.search, searchArgs);
        if (searchTasks !== undefined) {
          localStore.setQuery(api.tasks.search, searchArgs, searchTasks.map(removeFromTask));
        }
      }
    }
  );
  const syncAgentStates = useAction(api.agents.syncAgentStates);
  const syncPullRequestsBatch = useAction(api.pullRequests.syncPullRequestsBatch);
  const syncAgentRunningStatuses = useTrackedMutation(api.tasks.reopenBlockedWithTerminalAgents);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  // Keep refs in sync for optimistic updates
  useEffect(() => {
    searchTextRef.current = debouncedSearchText;
  }, [debouncedSearchText]);

  useEffect(() => {
    selectedTagIdRef.current = selectedTagId;
  }, [selectedTagId]);

  useEffect(() => {
    selectedNoTagRef.current = selectedNoTag;
  }, [selectedNoTag]);

  const isSearching = debouncedSearchText.trim() !== "" || selectedTagId !== null || selectedNoTag;

  const activeSearchArgs: TaskSearchArgs | undefined = useMemo(() => {
    if (!isSearching) return undefined;
    return {
      searchText: debouncedSearchText.trim() || undefined,
      tagId: selectedTagId ?? undefined,
      noTag: selectedNoTag || undefined,
    };
  }, [isSearching, debouncedSearchText, selectedTagId, selectedNoTag]);

  const allTasks = useQuery(api.tasks.list);
  const searchResults = useQuery(
    api.tasks.search,
    isSearching
      ? {
          searchText: debouncedSearchText.trim() || undefined,
          tagId: selectedTagId ?? undefined,
          noTag: selectedNoTag || undefined,
        }
      : "skip"
  );

  const tasks = isSearching ? searchResults : allTasks;

  const editingTask = useMemo(() => {
    if (!editingTaskId) return null;
    return (allTasks ?? []).find((t) => t._id === editingTaskId) ?? null;
  }, [editingTaskId, allTasks]);

  const clearSearch = () => {
    setSearchText("");
    handleTagChange(null);
  };

  const handleAttachAgent = async (args: {
    taskId: Id<"tasks">;
    externalId: string;
  }) => {
    const agentId = await createAgent({
      taskId: args.taskId,
      externalId: args.externalId,
      link: `https://cursor.com/agents/${args.externalId}`,
      title: args.externalId,
      status: "",
    });
    try {
      await syncAgentStates({
        items: [{ agentId, externalId: args.externalId }],
      });
    } catch {
      // Keep attach success even if background metadata sync fails.
    }
  };

  const handleAttachPr = async (args: { taskId: Id<"tasks">; url: string }) => {
    const pullRequestId = await createPullRequest(args);
    const normalized = parseGitHubPrUrl(args.url);
    if (!normalized) return;
    try {
      await syncPullRequestsBatch({
        items: [
          {
            pullRequestId,
            url: args.url,
            owner: normalized.owner,
            repo: normalized.repo,
            number: normalized.number,
          },
        ],
      });
    } catch {
      // Keep attach success even if background metadata sync fails.
    }
  };

  // Helper to determine column from a target ID (could be column or task)
  const getColumnFromTargetId = useCallback((targetId: string): string | null => {
    // Check if it's directly a column ID
    if (kanbanMode === "status" && (STATUS_ORDER as readonly string[]).includes(targetId)) {
      return targetId;
    }
    if (kanbanMode === "priority" && (PRIORITY_ORDER as readonly string[]).includes(targetId)) {
      return targetId;
    }
    // It's a task ID - find the task and get its column
    const targetTask = (tasks ?? []).find((t) => t._id === targetId);
    if (targetTask) {
      return kanbanMode === "status" ? targetTask.status : targetTask.priority;
    }
    return null;
  }, [kanbanMode, tasks]);

  // Drag event handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveTaskId(event.active.id as Id<"tasks">);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    if (over) {
      const columnId = getColumnFromTargetId(over.id as string);
      setOverColumnId(columnId);
    } else {
      setOverColumnId(null);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTaskId(null);
    setOverColumnId(null);

    if (!over) return;

    const taskId = active.id as Id<"tasks">;
    const targetId = over.id as string;

    // Find the dragged task
    const task = (tasks ?? []).find((t) => t._id === taskId);
    if (!task) return;

    if (kanbanMode === "status") {
      let newStatus: TaskStatus;
      
      // Check if dropped on a column
      if ((STATUS_ORDER as readonly string[]).includes(targetId)) {
        newStatus = targetId as TaskStatus;
      } else {
        // Dropped on a task card - find the target task's status
        const targetTask = (tasks ?? []).find((t) => t._id === targetId);
        if (!targetTask) return;
        newStatus = targetTask.status;
      }
      
      if (task.status !== newStatus) {
        updateStatus({ id: taskId, status: newStatus });
      }
    } else {
      let newPriority: TaskPriority;
      
      // Check if dropped on a column
      if ((PRIORITY_ORDER as readonly string[]).includes(targetId)) {
        newPriority = targetId as TaskPriority;
      } else {
        // Dropped on a task card - find the target task's priority
        const targetTask = (tasks ?? []).find((t) => t._id === targetId);
        if (!targetTask) return;
        newPriority = targetTask.priority;
      }
      
      if (task.priority !== newPriority) {
        updatePriority({ id: taskId, priority: newPriority });
      }
    }
  };

  const handleDragCancel = () => {
    setActiveTaskId(null);
    setOverColumnId(null);
  };

  // Get the active task for drag overlay
  const activeTask = activeTaskId 
    ? (tasks ?? []).find((t) => t._id === activeTaskId) 
    : null;

  // Group tasks by status or priority based on mode
  const tasksByStatus: Record<TaskStatus, TaskView[]> = {
    not_started: [],
    in_progress: [],
    agent_running: [],
    blocked: [],
    closed: [],
  };

  const tasksByPriority: Record<TaskPriority, TaskView[]> = {
    triage: [],
    low: [],
    medium: [],
    high: [],
    urgent: [],
  };
  const visiblePullRequestsForSync: Array<{
    pullRequestId: Id<"pullRequests">;
    url: string;
    owner: string;
    repo: string;
    number: number;
  }> = [];
  const visibleAgentsForSync: Array<{
    agentId: Id<"agents">;
    externalId: string;
  }> = [];

  let displayedTaskCount = 0;
  for (const task of tasks ?? []) {
    if (hideClosed && task.status === "closed") continue;
    displayedTaskCount++;
    const taskWithRelations: TaskView = {
      ...task,
      tags: task.tags as Tag[],
      agents: (task.agents as AgentAttachment[] | undefined) ?? [],
      pullRequests: (task.pullRequests as PullRequestAttachment[] | undefined) ?? [],
    };
    if (task.status !== "closed") {
      for (const pullRequest of taskWithRelations.pullRequests) {
        const normalized = pullRequest.normalized ?? parseGitHubPrUrl(pullRequest.url);
        if (!normalized) continue;
        visiblePullRequestsForSync.push({
          pullRequestId: pullRequest._id,
          url: pullRequest.url,
          owner: normalized.owner,
          repo: normalized.repo,
          number: normalized.number,
        });
      }
      for (const agent of taskWithRelations.agents) {
        visibleAgentsForSync.push({
          agentId: agent._id,
          externalId: agent.externalId,
        });
      }
    }
    tasksByStatus[task.status].push(taskWithRelations);
    tasksByPriority[task.priority].push(taskWithRelations);
  }

  // Sort tasks within each status column: by priority (high first), then by creation time descending
  // Exception: closed column sorts only by time (most recently closed first), ignoring priority
  for (const status of STATUS_ORDER) {
    tasksByStatus[status].sort((a, b) => {
      if (status === "closed") {
        const aTime = a.completedAt ?? a._creationTime;
        const bTime = b.completedAt ?? b._creationTime;
        return bTime - aTime;
      }
      const priorityDiff = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b._creationTime - a._creationTime;
    });
  }

  // Sort tasks within each priority column: by status (not_started first, closed last), then by creation time descending
  for (const priority of PRIORITY_ORDER) {
    tasksByPriority[priority].sort((a, b) => {
      const statusDiff = STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status];
      if (statusDiff !== 0) return statusDiff;
      return b._creationTime - a._creationTime;
    });
  }

  const visibleLinksCount = visiblePullRequestsForSync.length + visibleAgentsForSync.length;

  const handleRefreshVisibleLinks = async () => {
    if (visibleLinksCount === 0 || isRefreshingLinks) return;
    setIsRefreshingLinks(true);
    try {
      const syncPromises: Array<Promise<unknown>> = [];
      const taskIdsForAgentRunningSync = (tasks ?? [])
        .filter((task) => {
          const hasAgents = ((task.agents as AgentAttachment[] | undefined) ?? []).length > 0;
          if (!hasAgents) return false;
          return task.status === "agent_running" || task.status === "not_started" || task.status === "in_progress";
        })
        .map((task) => task._id);
      if (visiblePullRequestsForSync.length > 0) {
        syncPromises.push(
          syncPullRequestsBatch({
            items: visiblePullRequestsForSync.map((item) => ({
              pullRequestId: item.pullRequestId,
              url: item.url,
              owner: item.owner,
              repo: item.repo,
              number: item.number,
            })),
          })
        );
      }
      if (visibleAgentsForSync.length > 0) {
        syncPromises.push(
          syncAgentStates({
            items: visibleAgentsForSync.map((item) => ({
              agentId: item.agentId,
              externalId: item.externalId,
            })),
          })
        );
      }
      await Promise.all(syncPromises);
      if (taskIdsForAgentRunningSync.length > 0) {
        await syncAgentRunningStatuses({
          taskIds: taskIdsForAgentRunningSync,
        });
      }
    } finally {
      setIsRefreshingLinks(false);
    }
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Navigation />
      <div className="flex-1 flex pt-16 min-h-0">
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="max-w-376 mx-auto px-4 sm:px-6 lg:px-8 w-full flex-1 flex flex-col min-h-0 pt-8">
          {/* Search UI */}
          <div className="mb-6 space-y-3">
            <div className="flex gap-2 flex-wrap">
              <div className="flex-1 min-w-[200px] relative">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-(--muted)"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Search tasks..."
                  className="w-full h-[38px] pl-10 pr-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm"
                />
                {searchText && (
                  <button
                    onClick={() => setSearchText("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-(--muted) hover:text-foreground"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              <SearchTagSelector
                selectedTag={selectedTag}
                onTagChange={handleTagChange}
                allTags={allTags}
                selectedNoTag={selectedNoTag}
              />

              {/* Kanban Mode Toggle */}
              <div className="h-[38px] flex items-center bg-(--card-bg) border border-(--card-border) rounded-lg p-1">
                <button
                  onClick={() => { setKanbanMode("status"); setHideClosed(false); }}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    kanbanMode === "status"
                      ? "bg-accent text-white"
                      : "text-(--muted) hover:text-foreground"
                  }`}
                >
                  Status
                </button>
                <button
                  onClick={() => { setKanbanMode("priority"); setHideClosed(true); }}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    kanbanMode === "priority"
                      ? "bg-accent text-white"
                      : "text-(--muted) hover:text-foreground"
                  }`}
                >
                  Priority
                </button>
              </div>

              <button
                onClick={() => setShowCreateModal(true)}
                className="h-[38px] px-4 bg-accent hover:bg-(--accent-hover) text-white rounded-lg transition-colors font-medium text-sm flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create Task
              </button>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-(--muted) text-sm">
                {tasks === undefined
                  ? "Loading..."
                  : isSearching
                  ? `${displayedTaskCount} result${displayedTaskCount === 1 ? "" : "s"}${hideClosed && tasks.length !== displayedTaskCount ? ` (${tasks.length - displayedTaskCount} closed hidden)` : ""}`
                  : displayedTaskCount === 0 && !hideClosed
                  ? "No tasks yet"
                  : `${displayedTaskCount} task${displayedTaskCount === 1 ? "" : "s"}${hideClosed && tasks.length !== displayedTaskCount ? ` (${tasks.length - displayedTaskCount} closed hidden)` : ""}`}
              </p>
              <div className="flex items-center gap-3">
                {(visibleLinksCount > 0 || isRefreshingLinks) && (
                  <button
                    onClick={handleRefreshVisibleLinks}
                    disabled={isRefreshingLinks}
                    className="text-sm text-accent hover:underline disabled:text-(--muted) disabled:no-underline disabled:cursor-not-allowed"
                  >
                    {isRefreshingLinks
                      ? "Refreshing links..."
                      : `Refresh all links (${visibleLinksCount})`}
                  </button>
                )}
                {debouncedSearchText.trim() !== "" && (
                  <button
                    onClick={clearSearch}
                    className="text-sm text-accent hover:underline"
                  >
                    Clear search
                  </button>
                )}
                <button
                  onClick={() => setHideClosed(!hideClosed)}
                  className={`flex items-center gap-1.5 text-xs transition-colors ${
                    hideClosed ? "text-foreground" : "text-(--muted) hover:text-foreground"
                  }`}
                >
                  <div className={`w-6 h-3.5 rounded-full transition-colors relative ${hideClosed ? "bg-accent" : "bg-(--card-border)"}`}>
                    <div className={`absolute top-[2px] w-[10px] h-[10px] rounded-full bg-white transition-transform ${hideClosed ? "left-[12px]" : "left-[2px]"}`} />
                  </div>
                  Hide closed
                </button>
              </div>
            </div>
          </div>

          {/* Kanban Board */}
          {tasks === undefined ? (
            <div className="text-center py-8 text-(--muted)">Loading...</div>
          ) : tasks.length === 0 && !isSearching ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-(--card-bg) border border-(--card-border) flex items-center justify-center">
                <svg className="w-8 h-8 text-(--muted)" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <p className="text-(--muted) mb-2">No tasks yet</p>
              <p className="text-sm text-(--muted)/60">
                Create a task from a capture using the task icon
              </p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={pointerWithin}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <div className="flex gap-2 overflow-x-auto pb-4 flex-1 min-h-0">
                {kanbanMode === "status" ? (
                  STATUS_ORDER.map((status) => (
                    <KanbanColumn
                      key={status}
                      columnId={status}
                      columnValue={status}
                      tasks={tasksByStatus[status]}
                      kanbanMode={kanbanMode}
                      isDropTarget={overColumnId === status}
                      onOpenEditModal={(t) => setEditingTaskId(t._id)}
                      onOpenAttachAgentModal={setAttachAgentTaskId}
                      onOpenAttachPrModal={setAttachPrTaskId}
                    />
                  ))
                ) : (
                  PRIORITY_ORDER.map((priority) => (
                    <KanbanColumn
                      key={priority}
                      columnId={priority}
                      columnValue={priority}
                      tasks={tasksByPriority[priority]}
                      kanbanMode={kanbanMode}
                      isDropTarget={overColumnId === priority}
                      onOpenEditModal={(t) => setEditingTaskId(t._id)}
                      onOpenAttachAgentModal={setAttachAgentTaskId}
                      onOpenAttachPrModal={setAttachPrTaskId}
                    />
                  ))
                )}
              </div>

              {/* Drag Overlay - null dropAnimation for instant transition */}
              <DragOverlay dropAnimation={null}>
                {activeTask ? (
                  <div className="shadow-2xl scale-105 rotate-3">
                    <TaskCard
                      task={{
                        ...activeTask,
                        tags: activeTask.tags as Tag[],
                        agents: (activeTask.agents as AgentAttachment[] | undefined) ?? [],
                        pullRequests:
                          (activeTask.pullRequests as PullRequestAttachment[] | undefined) ?? [],
                      }}
                      kanbanMode={kanbanMode}
                    />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
          </div>
        </div>
        <CapturesSidebar pageSelectedTagId={selectedTagId} pageTaskSearchArgs={activeSearchArgs} />
      </div>

      <TaskModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        allTags={allTags}
        initialTagId={selectedTagId}
        activeSearchArgs={activeSearchArgs}
        onAttachAgent={handleAttachAgent}
        onAttachPr={handleAttachPr}
      />

      {editingTask && (
        <TaskModal
          isOpen={true}
          onClose={() => setEditingTaskId(null)}
          task={editingTask}
          allTags={allTags}
          activeSearchArgs={activeSearchArgs}
          onAttachAgent={handleAttachAgent}
          onRemoveAgent={(id) => removeAgent({ id })}
          onAttachPr={handleAttachPr}
          onRemovePr={(id) => removePullRequest({ id })}
        />
      )}

      <AttachAgentModal
        isOpen={attachAgentTaskId !== null}
        taskId={attachAgentTaskId}
        onClose={() => setAttachAgentTaskId(null)}
        onAttach={handleAttachAgent}
      />

      <AttachPrModal
        isOpen={attachPrTaskId !== null}
        taskId={attachPrTaskId}
        onClose={() => setAttachPrTaskId(null)}
        onAttach={handleAttachPr}
      />
    </div>
  );
}

export default function TasksPage() {
  const { session, isPending } = useAuthSession();

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return session ? <TasksList /> : <SignIn />;
}
