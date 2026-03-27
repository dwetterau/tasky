"use client";

import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useTrackedMutation } from "@/lib/useTrackedMutation";
import { Id } from "../../../convex/_generated/dataModel";
import { Navigation } from "../../components/Navigation";
import { SearchTagSelector, Tag } from "../../components/TagSelector";
import { useAuthSession } from "@/lib/useAuthSession";
import { SignIn } from "@/components/SignIn";
import { useState, useEffect, useMemo, useCallback } from "react";
import { usePageTagFilter } from "@/lib/usePageTagFilter";
import { TaskModal } from "../tasks/TaskModal";
import { CreateTaskFromAgentModal } from "../tasks/CreateTaskFromAgentModal";
import { LinkTaskModal } from "../tasks/LinkTaskModal";
import {
  type TaskStatus,
  type TaskPriority,
  type TaskForEdit,
  type AgentAttachment,
  type PullRequestAttachment,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  CURSOR_ICON_VIEWBOX,
  CURSOR_ICON_PATH,
  getAgentStatusInfo,
} from "../tasks/constants";
import {
  AGENT_ALREADY_ATTACHED_TO_TASK_ERROR,
  AGENT_ALREADY_LINKED_ERROR,
} from "../tasks/attachmentErrors";

type LinkedAgent = NonNullable<
  ReturnType<typeof useQuery<typeof api.agents.listWithTasks>>
>[number];

type CursorApiAgent = {
  id: string;
  name?: string;
  status?: string;
  source?: { repository?: string; ref?: string };
  target?: { url?: string; prUrl?: string; branchName?: string };
  summary?: string;
  createdAt?: string;
};

type AgentListItem =
  | { kind: "linked"; agent: LinkedAgent; sortTime: number }
  | { kind: "unlinked"; agent: CursorApiAgent; sortTime: number };

function AgentRow({
  item,
  onEditTask,
  onCreateTask,
  onLinkTask,
}: {
  item: AgentListItem;
  onEditTask: (taskId: Id<"tasks">) => void;
  onCreateTask: (agent: CursorApiAgent) => void;
  onLinkTask: (agent: CursorApiAgent) => void;
}) {
  if (item.kind === "linked") {
    const { agent } = item;
    const statusInfo = getAgentStatusInfo(agent.status);
    const task = agent.task;

    return (
      <div className="group relative bg-(--card-bg) border border-(--card-border) rounded-xl overflow-hidden transition-all duration-200 [&:hover:not(:has(a:hover))]:border-accent/30 flex">
        <div
          className="w-1 shrink-0"
          style={{ backgroundColor: statusInfo.color }}
        />
        <div className="flex-1 p-4 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <a
                  href={agent.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium hover:text-accent transition-colors min-w-0"
                >
                  <svg
                    className="w-3.5 h-4 shrink-0"
                    viewBox={CURSOR_ICON_VIEWBOX}
                    fill="currentColor"
                  >
                    <path d={CURSOR_ICON_PATH} />
                  </svg>
                  <span className="truncate">{agent.title || agent.externalId}</span>
                </a>
                <span
                  className="shrink-0 px-1.5 py-0.5 rounded text-xs font-medium"
                  style={{
                    backgroundColor: `${statusInfo.color}20`,
                    color: statusInfo.color,
                  }}
                >
                  {statusInfo.label}
                </span>
              </div>

              {task && (
                <div className="mt-2">
                  <p className="text-sm text-(--muted) line-clamp-2">
                    {task.content || "No content"}
                  </p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span
                      className="px-1.5 py-0.5 rounded text-xs font-medium"
                      style={{
                        backgroundColor: `${STATUS_CONFIG[task.status as TaskStatus]?.color ?? "#6b7280"}20`,
                        color: STATUS_CONFIG[task.status as TaskStatus]?.color ?? "#6b7280",
                      }}
                    >
                      {STATUS_CONFIG[task.status as TaskStatus]?.label ?? task.status}
                    </span>
                    <span
                      className="px-1.5 py-0.5 rounded text-xs font-medium"
                      style={{
                        backgroundColor: `${PRIORITY_CONFIG[task.priority as TaskPriority]?.color ?? "#6b7280"}20`,
                        color: PRIORITY_CONFIG[task.priority as TaskPriority]?.color ?? "#6b7280",
                      }}
                    >
                      {PRIORITY_CONFIG[task.priority as TaskPriority]?.label ?? task.priority}
                    </span>
                    {task.tags.map((tag) => (
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
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => task && onEditTask(task._id)}
              className="shrink-0 px-3 py-1.5 text-sm text-accent border border-accent/30 hover:bg-accent hover:text-white rounded-lg transition-colors font-medium"
            >
              Edit Task
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { agent } = item;
  const statusInfo = getAgentStatusInfo(agent.status ?? "");
  const agentUrl = agent.target?.url ?? `https://cursor.com/agents/${agent.id}`;

  return (
    <div className="group relative bg-(--card-bg) border border-(--card-border) rounded-xl overflow-hidden transition-all duration-200 [&:hover:not(:has(a:hover))]:border-accent/30 flex">
      <div
        className="w-1 shrink-0 opacity-40"
        style={{ backgroundColor: statusInfo.color }}
      />
      <div className="flex-1 p-4 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <a
                href={agentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium hover:text-accent transition-colors min-w-0"
              >
                <svg
                  className="w-3.5 h-4 shrink-0 opacity-50"
                  viewBox={CURSOR_ICON_VIEWBOX}
                  fill="currentColor"
                >
                  <path d={CURSOR_ICON_PATH} />
                </svg>
                <span className="truncate">{agent.name || agent.id}</span>
              </a>
              <span
                className="shrink-0 px-1.5 py-0.5 rounded text-xs font-medium"
                style={{
                  backgroundColor: `${statusInfo.color}20`,
                  color: statusInfo.color,
                }}
              >
                {statusInfo.label}
              </span>
              <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-(--card-border) text-(--muted)">
                No task
              </span>
            </div>
            {agent.summary && (
              <p className="text-sm text-(--muted) line-clamp-2 mt-1">
                {agent.summary}
              </p>
            )}
            {agent.source?.repository && (
              <p className="text-xs text-(--muted) mt-1">
                {agent.source.repository.replace("https://github.com/", "")}
                {agent.source.ref ? ` @ ${agent.source.ref}` : ""}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onLinkTask(agent)}
              className="px-3 py-1.5 text-sm text-accent border border-accent/30 hover:bg-accent hover:text-white rounded-lg transition-colors font-medium"
            >
              Link Task
            </button>
            <button
              type="button"
              onClick={() => onCreateTask(agent)}
              className="px-3 py-1.5 text-sm bg-accent hover:bg-(--accent-hover) text-white rounded-lg transition-colors font-medium"
            >
              Create Task
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentsList({ startAgentStorageKeySuffix }: { startAgentStorageKeySuffix: string }) {
  const { allTags, allTagsRaw, selectedTag, selectedTagId, selectedNoTag, handleTagChange } =
    usePageTagFilter({ allowNoTag: true });

  const linkedAgents = useQuery(api.agents.listWithTasks);
  const listFromCursorApi = useAction(api.agents.listFromCursorApi);
  const syncAgentStates = useAction(api.agents.syncAgentStates);
  const createTask = useTrackedMutation(api.tasks.create);
  const createAgent = useTrackedMutation(api.agents.createForTask);
  const launchAgent = useAction(api.agents.launch);
  const removeAgent = useTrackedMutation(api.agents.remove);
  const removePullRequest = useTrackedMutation(api.pullRequests.remove);

  const [cursorAgents, setCursorAgents] = useState<CursorApiAgent[]>([]);
  const [cursorApiStatus, setCursorApiStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<Id<"tasks"> | null>(null);
  const [createFromAgentId, setCreateFromAgentId] = useState<string | null>(null);
  const [showCreateFromAgentModal, setShowCreateFromAgentModal] = useState(false);
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [createTaskAgentExternalId, setCreateTaskAgentExternalId] = useState<string | null>(null);
  const [linkTaskAgent, setLinkTaskAgent] = useState<CursorApiAgent | null>(null);

  const fetchCursorAgents = useCallback(async () => {
    setCursorApiStatus("loading");
    try {
      const result = await listFromCursorApi({});
      setCursorAgents(result.agents);
      setCursorApiStatus("loaded");
    } catch {
      setCursorApiStatus("error");
    }
  }, [listFromCursorApi]);

  useEffect(() => {
    if (cursorApiStatus === "idle") {
      void fetchCursorAgents();
    }
  }, [cursorApiStatus, fetchCursorAgents]);

  const linkedExternalIds = useMemo(
    () => new Set((linkedAgents ?? []).map((a) => a.externalId)),
    [linkedAgents]
  );

  const unlinkedAgents = useMemo(
    () => cursorAgents.filter((a) => !linkedExternalIds.has(a.id)),
    [cursorAgents, linkedExternalIds]
  );

  const tagDescendants = useMemo(() => {
    if (!selectedTagId) return new Set<string>();
    const tag = allTagsRaw.find((t) => t._id === selectedTagId);
    const ids = new Set<string>([selectedTagId]);
    if (tag?.childrenRecursive) {
      for (const childId of tag.childrenRecursive) {
        ids.add(childId);
      }
    }
    return ids;
  }, [selectedTagId, allTagsRaw]);

  const filteredItems = useMemo((): AgentListItem[] => {
    const items: AgentListItem[] = [];

    for (const agent of linkedAgents ?? []) {
      if (selectedTagId && agent.task) {
        const taskTagIds = agent.task.tagIds ?? [];
        if (!taskTagIds.some((id) => tagDescendants.has(id))) {
          continue;
        }
      }
      if (selectedNoTag && agent.task) {
        if (agent.task.tagIds.length > 0) {
          continue;
        }
      }
      items.push({
        kind: "linked",
        agent,
        sortTime: agent._creationTime,
      });
    }

    for (const agent of unlinkedAgents) {
      items.push({
        kind: "unlinked",
        agent,
        sortTime: agent.createdAt ? new Date(agent.createdAt).getTime() : 0,
      });
    }

    items.sort((a, b) => b.sortTime - a.sortTime);
    return items;
  }, [linkedAgents, unlinkedAgents, selectedTagId, selectedNoTag, tagDescendants]);

  const linkedCount = filteredItems.filter((i) => i.kind === "linked").length;
  const unlinkedCount = filteredItems.filter((i) => i.kind === "unlinked").length;

  const editingTask = useMemo((): TaskForEdit | null => {
    if (!editingTaskId || !linkedAgents) return null;
    const agentsForTask = linkedAgents.filter((a) => a.task?._id === editingTaskId);
    const firstWithTask = agentsForTask.find((a) => a.task);
    if (!firstWithTask?.task) return null;
    const task = firstWithTask.task;
    return {
      _id: task._id,
      content: task.content,
      status: task.status as TaskStatus,
      priority: task.priority as TaskPriority,
      dueDate: task.dueDate,
      tags: task.tags as Tag[],
      agents: agentsForTask.map((a) => ({
        _id: a._id,
        taskId: a.taskId,
        externalId: a.externalId,
        link: a.link,
        title: a.title,
        status: a.status,
        lastSyncedAt: a.lastSyncedAt,
      })) as AgentAttachment[],
      pullRequests: [] as PullRequestAttachment[],
    };
  }, [editingTaskId, linkedAgents]);

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      const agentsToSync = (linkedAgents ?? []).map((a) => ({
        agentId: a._id,
        externalId: a.externalId,
        taskId: a.taskId,
      }));

      const syncLinked = agentsToSync.length > 0
        ? syncAgentStates({ items: agentsToSync })
        : Promise.resolve();

      await Promise.all([syncLinked, fetchCursorAgents()]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCreateTaskFromExistingAgent = async (args: {
    externalId: string;
    tagIds: Id<"tags">[];
    priority: TaskPriority;
  }) => {
    const result = await createTask({
      content: "",
      tagIds: args.tagIds.length > 0 ? args.tagIds : undefined,
      priority: args.priority,
      agentExternalIds: [args.externalId],
    });
    if (result.createdAgents.length > 0) {
      try {
        await syncAgentStates({
          items: result.createdAgents.map((agent) => ({
            ...agent,
            taskId: result.taskId,
          })),
        });
      } catch { /* keep success */ }
    }
    void fetchCursorAgents();
  };

  const handleCreateTaskFromStartedAgent = async (args: {
    repository: string;
    branch: string;
    prompt: string;
    tagIds: Id<"tags">[];
    priority: TaskPriority;
  }) => {
    const launchedAgent = await launchAgent({
      repository: args.repository,
      branch: args.branch,
      promptText: args.prompt,
    });
    const result = await createTask({
      content: launchedAgent.title.trim(),
      tagIds: args.tagIds.length > 0 ? args.tagIds : undefined,
      priority: args.priority,
      agentExternalIds: [launchedAgent.externalId],
    });
    if (result.createdAgents.length > 0) {
      try {
        await syncAgentStates({
          items: result.createdAgents.map((agent) => ({
            ...agent,
            taskId: result.taskId,
          })),
        });
      } catch { /* keep success */ }
    }
    void fetchCursorAgents();
  };

  const handleAttachAgent = async (args: {
    taskId: Id<"tasks">;
    externalId: string;
  }) => {
    const result = await createAgent({
      taskId: args.taskId,
      externalId: args.externalId,
      link: `https://cursor.com/agents/${args.externalId}`,
      title: args.externalId,
      status: "",
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
    try {
      await syncAgentStates({
        items: [{ agentId: result.agentId, externalId: args.externalId, taskId: args.taskId }],
      });
    } catch { /* keep success */ }
  };

  const handleTaskCreated = async (result: {
    taskId: Id<"tasks">;
    createdAgents: Array<{ agentId: Id<"agents">; externalId: string }>;
  }) => {
    if (result.createdAgents.length === 0) return;
    try {
      await syncAgentStates({
        items: result.createdAgents.map((agent) => ({ ...agent, taskId: result.taskId })),
      });
    } catch { /* keep success */ }
  };

  const handleOpenCreateFromAgent = (agent: CursorApiAgent) => {
    setCreateTaskAgentExternalId(agent.id);
    setShowCreateTaskModal(true);
  };

  const handleOpenLinkTaskForAgent = (agent: CursorApiAgent) => {
    setLinkTaskAgent(agent);
  };

  const handleLinkExistingTask = async (taskId: Id<"tasks">) => {
    if (!linkTaskAgent) return;
    const externalId = linkTaskAgent.id;
    setLinkTaskAgent(null);
    await handleAttachAgent({ taskId, externalId });
    void fetchCursorAgents();
  };

  const totalCount = linkedAgents === undefined ? null : filteredItems.length;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Navigation />
      <div className="flex-1 flex pt-16 min-h-0">
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 w-full flex-1 flex flex-col min-h-0 pt-8">
            <div className="mb-6 space-y-3">
              <div className="flex gap-2 flex-wrap items-center">
                <SearchTagSelector
                  selectedTag={selectedTag}
                  onTagChange={handleTagChange}
                  allTags={allTags}
                  selectedNoTag={selectedNoTag}
                />

                <button
                  type="button"
                  onClick={() => {
                    setCreateFromAgentId(null);
                    setShowCreateFromAgentModal(true);
                  }}
                  className="h-[38px] px-4 inline-flex items-center gap-2 border border-accent/30 bg-(--card-bg) text-accent hover:bg-accent hover:text-white rounded-lg transition-colors font-medium text-sm"
                  title="Create task from agent"
                >
                  <svg className="w-4 h-4.5" viewBox={CURSOR_ICON_VIEWBOX} fill="currentColor" aria-hidden="true">
                    <path d={CURSOR_ICON_PATH} />
                  </svg>
                  New
                </button>

                <div className="flex-1" />

                <button
                  onClick={() => void handleRefresh()}
                  disabled={isRefreshing}
                  aria-busy={isRefreshing}
                  className="h-[38px] px-4 inline-flex items-center gap-1.5 text-sm border border-(--card-border) bg-(--card-bg) rounded-lg transition-colors hover:border-accent/30 hover:text-accent disabled:text-(--muted) disabled:cursor-not-allowed"
                >
                  {isRefreshing ? (
                    <svg
                      className="w-3.5 h-3.5 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  <span>{isRefreshing ? "Refreshing..." : "Refresh"}</span>
                </button>
              </div>

              <div className="flex items-center gap-3">
                <p className="text-(--muted) text-sm">
                  {totalCount === null
                    ? "Loading..."
                    : totalCount === 0
                    ? "No agents"
                    : `${totalCount} agent${totalCount === 1 ? "" : "s"}${linkedCount > 0 && unlinkedCount > 0 ? ` (${linkedCount} linked, ${unlinkedCount} unlinked)` : ""}`}
                </p>
                {cursorApiStatus === "loading" && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-(--muted)">
                    <svg
                      className="w-3 h-3 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Loading from Cursor...
                  </span>
                )}
              </div>
            </div>

            {linkedAgents === undefined ? (
              <div className="text-center py-8 text-(--muted)">Loading...</div>
            ) : filteredItems.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-(--card-bg) border border-(--card-border) flex items-center justify-center">
                  <svg className="w-8 h-8 text-(--muted)" viewBox={CURSOR_ICON_VIEWBOX} fill="currentColor">
                    <path d={CURSOR_ICON_PATH} />
                  </svg>
                </div>
                <p className="text-(--muted) mb-2">No agents</p>
                <p className="text-sm text-(--muted)/60">
                  Agents linked to tasks or from your Cursor account will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-3 overflow-y-auto pb-8 flex-1 min-h-0">
                {filteredItems.map((item) => (
                  <AgentRow
                    key={item.kind === "linked" ? item.agent._id : item.agent.id}
                    item={item}
                    onEditTask={setEditingTaskId}
                    onCreateTask={handleOpenCreateFromAgent}
                    onLinkTask={handleOpenLinkTaskForAgent}
                  />
                ))}
                {cursorApiStatus === "error" && (
                  <div className="text-center py-4 text-sm">
                    <span className="text-red-400">Failed to load agents from Cursor API.</span>
                    {" "}
                    <button
                      onClick={() => void fetchCursorAgents()}
                      className="text-accent hover:underline"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <CreateTaskFromAgentModal
        isOpen={showCreateFromAgentModal}
        onClose={() => {
          setShowCreateFromAgentModal(false);
          setCreateFromAgentId(null);
        }}
        onCreateFromAgent={handleCreateTaskFromExistingAgent}
        onStartAgent={handleCreateTaskFromStartedAgent}
        storageKeySuffix={startAgentStorageKeySuffix}
        allTags={allTags}
        initialTagId={selectedTagId}
        initialAgentId={createFromAgentId ?? undefined}
      />

      {showCreateTaskModal && (
        <TaskModal
          isOpen={true}
          onClose={() => {
            setShowCreateTaskModal(false);
            setCreateTaskAgentExternalId(null);
          }}
          allTags={allTags}
          initialTagId={selectedTagId}
          initialPendingAgentIds={createTaskAgentExternalId ? [createTaskAgentExternalId] : undefined}
          onTaskCreated={async (result) => {
            await handleTaskCreated(result);
            void fetchCursorAgents();
          }}
        />
      )}

      <LinkTaskModal
        isOpen={linkTaskAgent !== null}
        onClose={() => setLinkTaskAgent(null)}
        onSelect={(taskId) => void handleLinkExistingTask(taskId)}
        tagId={selectedTagId}
        noTag={selectedNoTag || undefined}
      />

      {editingTask && (
        <TaskModal
          isOpen={true}
          onClose={() => setEditingTaskId(null)}
          task={editingTask}
          allTags={allTags}
          onTaskCreated={handleTaskCreated}
          onAttachAgent={handleAttachAgent}
          onRemoveAgent={(id) => removeAgent({ id })}
          onRemovePr={(id) => removePullRequest({ id })}
        />
      )}
    </div>
  );
}

export default function AgentsPage() {
  const { session, isPending } = useAuthSession();

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return session ? (
    <AgentsList
      startAgentStorageKeySuffix={String(session.user.email ?? session.user.name ?? "user")}
    />
  ) : (
    <SignIn />
  );
}
