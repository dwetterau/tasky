"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Navigation } from "../../components/Navigation";
import { TagSelector, SearchTagSelector, Tag } from "../../components/TagSelector";
import { authClient } from "@/lib/auth-client";
import ReactMarkdown from "react-markdown";
import { useState, useRef, useEffect } from "react";

type TaskStatus = "not_started" | "in_progress" | "blocked" | "done";
type TaskPriority = "triage" | "low" | "medium" | "high";

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  not_started: { label: "Not Started", color: "#6b7280" },
  in_progress: { label: "In Progress", color: "#3b82f6" },
  blocked: { label: "Blocked", color: "#ef4444" },
  done: { label: "Done", color: "#22c55e" },
};

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string }> = {
  triage: { label: "Triage", color: "#6b7280" },
  low: { label: "Low", color: "#22c55e" },
  medium: { label: "Medium", color: "#f59e0b" },
  high: { label: "High", color: "#ef4444" },
};

const STATUS_ORDER: TaskStatus[] = ["not_started", "in_progress", "blocked", "done"];

function TaskCard({
  task,
  allTags,
}: {
  task: {
    _id: Id<"tasks">;
    content: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate?: string;
    tags: Tag[];
  };
  allTags: Tag[];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(task.content);
  const [editTagIds, setEditTagIds] = useState<Id<"tags">[]>(task.tags.map((t) => t._id));
  const [editStatus, setEditStatus] = useState<TaskStatus>(task.status);
  const [editPriority, setEditPriority] = useState<TaskPriority>(task.priority);
  const [editDueDate, setEditDueDate] = useState(task.dueDate || "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const remove = useMutation(api.tasks.remove);
  const update = useMutation(api.tasks.update);

  const editTags = editTagIds
    .map((id) => allTags.find((t) => t._id === id))
    .filter((t): t is Tag => t !== undefined);

  const priorityColor = PRIORITY_CONFIG[task.priority].color;

  const startEditing = () => {
    setEditContent(task.content);
    setEditTagIds(task.tags.map((t) => t._id));
    setEditStatus(task.status);
    setEditPriority(task.priority);
    setEditDueDate(task.dueDate || "");
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  const saveChanges = async () => {
    await update({
      id: task._id,
      content: editContent,
      tagIds: editTagIds,
      status: editStatus,
      priority: editPriority,
      dueDate: editDueDate || null,
    });
    setIsEditing(false);
  };

  useEffect(() => {
    if (textareaRef.current && isEditing) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [editContent, isEditing]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditing]);

  if (isEditing) {
    return (
      <div className="bg-[var(--card-bg)] border border-[var(--accent)]/50 rounded-xl p-4 transition-all duration-200">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">Content</label>
            <textarea
              ref={textareaRef}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full min-h-[80px] px-3 py-2 bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--accent)] transition-colors resize-none font-mono text-sm"
              placeholder="Task description..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--muted)] mb-1">Status</label>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value as TaskStatus)}
                className="w-full h-[38px] px-3 bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--accent)] transition-colors text-sm"
              >
                {STATUS_ORDER.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_CONFIG[status].label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--muted)] mb-1">Priority</label>
              <select
                value={editPriority}
                onChange={(e) => setEditPriority(e.target.value as TaskPriority)}
                className="w-full h-[38px] px-3 bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--accent)] transition-colors text-sm"
              >
                {(["triage", "low", "medium", "high"] as TaskPriority[]).map((priority) => (
                  <option key={priority} value={priority}>
                    {PRIORITY_CONFIG[priority].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">Due Date</label>
            <input
              type="date"
              value={editDueDate}
              onChange={(e) => setEditDueDate(e.target.value)}
              className="w-full h-[38px] px-3 bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--accent)] transition-colors text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">Tags</label>
            <TagSelector
              selectedTags={editTags}
              onTagsChange={setEditTagIds}
              allTags={allTags}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              onClick={cancelEditing}
              className="px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors rounded-lg hover:bg-[var(--card-border)]"
            >
              Cancel
            </button>
            <button
              onClick={() => void saveChanges()}
              className="px-3 py-1.5 text-sm bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg transition-colors font-medium"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden transition-all duration-200 hover:border-[var(--accent)]/30 flex"
    >
      {/* Priority accent bar */}
      <div
        className="w-1 shrink-0"
        style={{ backgroundColor: priorityColor }}
      />

      <div className="flex-1 p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex flex-wrap gap-1.5">
            {task.tags.length === 0 ? (
              <span className="text-xs text-[var(--muted)]">No tags</span>
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
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={startEditing}
              className="opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-[var(--accent)] transition-all duration-200 p-1 rounded hover:bg-[var(--accent)]/10"
              title="Edit task"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              onClick={() => remove({ id: task._id })}
              className="opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-red-400 transition-all duration-200 p-1 rounded hover:bg-red-400/10"
              title="Delete task"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>

        <div className="prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2 text-sm">
          <ReactMarkdown>{task.content}</ReactMarkdown>
        </div>

        {(task.dueDate || task.priority !== "triage") && (
          <div className="flex items-center gap-3 mt-3 text-xs text-[var(--muted)]">
            {task.dueDate && (
              <span className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {new Date(task.dueDate).toLocaleDateString()}
              </span>
            )}
            <span
              className="px-1.5 py-0.5 rounded text-xs font-medium"
              style={{
                backgroundColor: `${priorityColor}20`,
                color: priorityColor,
              }}
            >
              {PRIORITY_CONFIG[task.priority].label}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function KanbanColumn({
  status,
  tasks,
  allTags,
}: {
  status: TaskStatus;
  tasks: Array<{
    _id: Id<"tasks">;
    content: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate?: string;
    tags: Tag[];
  }>;
  allTags: Tag[];
}) {
  const config = STATUS_CONFIG[status];

  return (
    <div className="flex-1 min-w-[280px] max-w-[350px]">
      <div className="flex items-center gap-2 mb-4 px-1">
        <div
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: config.color }}
        />
        <h3 className="font-medium text-sm">{config.label}</h3>
        <span className="text-xs text-[var(--muted)] bg-[var(--card-border)] px-2 py-0.5 rounded-full">
          {tasks.length}
        </span>
      </div>

      <div className="space-y-3">
        {tasks.map((task) => (
          <TaskCard key={task._id} task={task} allTags={allTags} />
        ))}
        {tasks.length === 0 && (
          <div className="text-center py-8 text-[var(--muted)] text-sm border border-dashed border-[var(--card-border)] rounded-xl">
            No tasks
          </div>
        )}
      </div>
    </div>
  );
}

function TasksList() {
  const [searchText, setSearchText] = useState("");
  const [selectedTagId, setSelectedTagId] = useState<Id<"tags"> | null>(null);
  const [debouncedSearchText, setDebouncedSearchText] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const isSearching = debouncedSearchText.trim() !== "" || selectedTagId !== null;

  const allTasks = useQuery(api.tasks.list);
  const searchResults = useQuery(
    api.tasks.search,
    isSearching
      ? {
          searchText: debouncedSearchText.trim() || undefined,
          tagId: selectedTagId ?? undefined,
        }
      : "skip"
  );

  const tasks = isSearching ? searchResults : allTasks;
  const allTags = useQuery(api.tags.list) ?? [];

  const allTagsFormatted: Tag[] = allTags.map((tag) => ({
    _id: tag._id,
    name: tag.name,
    color: tag.color,
  }));

  const selectedTag = selectedTagId
    ? allTagsFormatted.find((t) => t._id === selectedTagId) ?? null
    : null;

  const clearSearch = () => {
    setSearchText("");
    setSelectedTagId(null);
  };

  // Group tasks by status
  type TaskWithTags = {
    _id: Id<"tasks">;
    content: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate?: string;
    tags: Tag[];
  };

  const tasksByStatus: Record<TaskStatus, TaskWithTags[]> = {
    not_started: [],
    in_progress: [],
    blocked: [],
    done: [],
  };

  for (const task of tasks ?? []) {
    tasksByStatus[task.status].push({
      ...task,
      tags: task.tags as Tag[],
    });
  }

  return (
    <>
      <Navigation />
      <div className="min-h-screen pt-24 pb-12 px-4">
        <div className="max-w-7xl mx-auto">
          {/* Search UI */}
          <div className="mb-6 space-y-3">
            <div className="flex gap-2 flex-wrap">
              <div className="flex-1 min-w-[200px] relative">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)]"
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
                  className="w-full h-[38px] pl-10 pr-3 bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--accent)] transition-colors text-sm"
                />
                {searchText && (
                  <button
                    onClick={() => setSearchText("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              <SearchTagSelector
                selectedTag={selectedTag}
                onTagChange={setSelectedTagId}
                allTags={allTagsFormatted}
              />
            </div>

            <div className="flex items-center justify-between">
              <p className="text-[var(--muted)] text-sm">
                {tasks === undefined
                  ? "Loading..."
                  : isSearching
                  ? `${tasks.length} result${tasks.length === 1 ? "" : "s"}`
                  : tasks.length === 0
                  ? "No tasks yet"
                  : `${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
              </p>
              {isSearching && (
                <button
                  onClick={clearSearch}
                  className="text-sm text-[var(--accent)] hover:underline"
                >
                  Clear search
                </button>
              )}
            </div>
          </div>

          {/* Kanban Board */}
          {tasks === undefined ? (
            <div className="text-center py-8 text-[var(--muted)]">Loading...</div>
          ) : tasks.length === 0 && !isSearching ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)] flex items-center justify-center">
                <svg className="w-8 h-8 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <p className="text-[var(--muted)] mb-2">No tasks yet</p>
              <p className="text-sm text-[var(--muted)]/60">
                Create a task from a capture using the task icon
              </p>
            </div>
          ) : (
            <div className="flex gap-6 overflow-x-auto pb-4">
              {STATUS_ORDER.map((status) => (
                <KanbanColumn
                  key={status}
                  status={status}
                  tasks={tasksByStatus[status]}
                  allTags={allTagsFormatted}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function SignIn() {
  const handleGitHubSignIn = async () => {
    await authClient.signIn.social({
      provider: "github",
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            Tasky
          </h1>
          <p className="text-[var(--muted)]">Your personal task manager</p>
        </div>
        <button
          onClick={() => void handleGitHubSignIn()}
          className="w-full flex items-center justify-center gap-3 bg-[#24292e] hover:bg-[#2f363d] text-white py-3 px-4 rounded-xl transition-all duration-200 font-medium"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
          Sign in with GitHub
        </button>
      </div>
    </div>
  );
}

export default function TasksPage() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return session ? <TasksList /> : <SignIn />;
}
