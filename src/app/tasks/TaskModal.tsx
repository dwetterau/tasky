"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { useTrackedMutation } from "@/lib/useTrackedMutation";
import { TagSelector, Tag } from "../../components/TagSelector";
import { StyledSelect, type SelectOption } from "../../components/StyledSelect";
import { MarkdownEditor } from "../../components/MarkdownEditor";
import {
  type TaskStatus,
  type TaskPriority,
  type TaskForEdit,
  STATUS_CONFIG,
  STATUS_ORDER,
  PRIORITY_CONFIG,
  PRIORITY_ORDER,
} from "./constants";
import { ConfirmModal } from "../../components/ConfirmModal";

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

export function TaskModal({
  isOpen,
  onClose,
  task,
  allTags,
  initialTagId,
  initialContent,
  createdFromCaptureId,
  activeSearchArgs,
}: {
  isOpen: boolean;
  onClose: () => void;
  task?: TaskForEdit | null;
  allTags: Tag[];
  initialTagId?: Id<"tags"> | null;
  /** Pre-fill content when creating a new task (e.g. from a capture) */
  initialContent?: string;
  /** When set, the source capture will be deleted after task creation */
  createdFromCaptureId?: Id<"captures">;
  /** Current search/filter args on the tasks page, so optimistic updates also patch the search query */
  activeSearchArgs?: TaskSearchArgs;
}) {
  const isEditing = !!task;

  const [content, setContent] = useState("");
  const [tagIds, setTagIds] = useState<Id<"tags">[]>([]);
  const [status, setStatus] = useState<TaskStatus>("not_started");
  const [priority, setPriority] = useState<TaskPriority>("triage");
  const [dueDate, setDueDate] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showUnsavedChanges, setShowUnsavedChanges] = useState(false);
  const mouseDownTargetRef = useRef<EventTarget | null>(null);

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
      };

      const tasks = localStore.getQuery(api.tasks.list, {});
      if (tasks !== undefined) {
        localStore.setQuery(api.tasks.list, {}, [tempTask, ...tasks]);
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

      const tasks = localStore.getQuery(api.tasks.list, {});
      if (tasks !== undefined) {
        localStore.setQuery(api.tasks.list, {}, tasks.map(applyUpdate));
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
      const tasks = localStore.getQuery(api.tasks.list, {});
      if (tasks !== undefined) {
        localStore.setQuery(api.tasks.list, {}, tasks.filter((t) => t._id !== args.id));
      }

      if (activeSearchArgs) {
        const searchTasks = localStore.getQuery(api.tasks.search, activeSearchArgs);
        if (searchTasks !== undefined) {
          localStore.setQuery(api.tasks.search, activeSearchArgs, searchTasks.filter((t) => t._id !== args.id));
        }
      }
    }
  );

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
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
    }
  }, [isOpen, task, initialTagId, initialContent]);

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

  const selectedTags = tagIds
    .map((id) => allTags.find((t) => t._id === id))
    .filter((t): t is Tag => t !== undefined);

  const handleSubmit = () => {
    if (!content.trim()) return;
    if (task) {
      update({
        id: task._id,
        content: content.trim(),
        tagIds,
        status,
        priority,
        dueDate: dueDate || null,
      });
    } else {
      create({
        content: content.trim(),
        tagIds: tagIds.length > 0 ? tagIds : undefined,
        status,
        priority,
        dueDate: dueDate || undefined,
        createdFromCaptureId,
      });
    }
    onClose();
  };

  const handleDelete = () => {
    if (task) {
      remove({ id: task._id });
      setShowDeleteConfirm(false);
      onClose();
    }
  };

  if (!isOpen) return null;

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
          </div>
        </div>

        {/* Fixed footer */}
        <div className="flex items-center justify-end gap-3 px-5 pb-4 pt-4 border-t border-(--card-border) mt-4">
          <button
            onClick={handleCloseAttempt}
            className="px-4 py-2 text-sm text-(--muted) hover:text-foreground transition-colors rounded-lg hover:bg-(--card-border)"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!content.trim()}
            className="px-4 py-2 text-sm bg-accent hover:bg-(--accent-hover) text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isEditing ? "Save Changes" : "Create Task"}
          </button>
        </div>

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
