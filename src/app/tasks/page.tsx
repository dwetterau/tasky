"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Navigation } from "../../components/Navigation";
import { TagSelector, SearchTagSelector, Tag } from "../../components/TagSelector";
import { authClient } from "@/lib/auth-client";
import ReactMarkdown from "react-markdown";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
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

type TaskStatus = "not_started" | "in_progress" | "blocked" | "closed";
type TaskPriority = "triage" | "low" | "medium" | "high";

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  not_started: { label: "Not Started", color: "#6b7280" },
  in_progress: { label: "In Progress", color: "#3b82f6" },
  blocked: { label: "Blocked", color: "#ef4444" },
  closed: { label: "Closed", color: "#22c55e" },
};

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string }> = {
  triage: { label: "Triage", color: "#6b7280" },
  low: { label: "Low", color: "#22c55e" },
  medium: { label: "Medium", color: "#f59e0b" },
  high: { label: "High", color: "#ef4444" },
};

const STATUS_ORDER: TaskStatus[] = ["not_started", "in_progress", "blocked", "closed"];
const PRIORITY_ORDER: TaskPriority[] = ["triage", "low", "medium", "high"];

type KanbanMode = "status" | "priority";

function CreateTaskModal({
  isOpen,
  onClose,
  allTags,
  initialTagId,
}: {
  isOpen: boolean;
  onClose: () => void;
  allTags: Tag[];
  initialTagId: Id<"tags"> | null;
}) {
  const [content, setContent] = useState("");
  const [tagIds, setTagIds] = useState<Id<"tags">[]>(initialTagId ? [initialTagId] : []);
  const [status, setStatus] = useState<TaskStatus>("not_started");
  const [priority, setPriority] = useState<TaskPriority>("triage");
  const [dueDate, setDueDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const create = useMutation(api.tasks.create);

  // Reset form when modal opens with new initialTagId
  useEffect(() => {
    if (isOpen) {
      setContent("");
      setTagIds(initialTagId ? [initialTagId] : []);
      setStatus("not_started");
      setPriority("triage");
      setDueDate("");
    }
  }, [isOpen, initialTagId]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (textareaRef.current && isOpen) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [content, isOpen]);

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  const selectedTags = tagIds
    .map((id) => allTags.find((t) => t._id === id))
    .filter((t): t is Tag => t !== undefined);

  const handleSubmit = async () => {
    if (!content.trim()) return;
    
    setIsSubmitting(true);
    try {
      await create({
        content: content.trim(),
        tagIds: tagIds.length > 0 ? tagIds : undefined,
        status,
        priority,
        dueDate: dueDate || undefined,
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 cursor-default"
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      
      {/* Modal */}
      <div 
        className="relative bg-(--card-bg) border border-(--card-border) rounded-2xl p-6 max-w-lg w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-(--accent)/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold">Create Task</h3>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-(--muted) mb-1">Content</label>
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full min-h-[100px] px-3 py-2 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors resize-none font-mono text-sm"
              placeholder="What needs to be done?"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-(--muted) mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                className="w-full h-[38px] px-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm"
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_CONFIG[s].label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-(--muted) mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full h-[38px] px-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm"
              >
                {(["triage", "low", "medium", "high"] as TaskPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_CONFIG[p].label}
                  </option>
                ))}
              </select>
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

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-(--muted) hover:text-foreground transition-colors rounded-lg hover:bg-(--card-border)"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSubmit()}
              disabled={!content.trim() || isSubmitting}
              className="px-4 py-2 text-sm bg-accent hover:bg-(--accent-hover) text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Creating..." : "Create Task"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  taskContent,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  taskContent: string;
}) {
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

  // Truncate content for display
  const displayContent = taskContent.length > 100 
    ? taskContent.slice(0, 100) + "..." 
    : taskContent;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 cursor-default"
      onClick={onClose}
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
          <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold">Delete Task</h3>
        </div>
        
        <p className="text-(--muted) mb-2">
          Are you sure you want to delete this task? This action cannot be undone.
        </p>
        
        <div className="bg-background border border-(--card-border) rounded-lg p-3 mb-6">
          <p className="text-sm text-foreground line-clamp-3">{displayContent}</p>
        </div>
        
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-(--muted) hover:text-foreground transition-colors rounded-lg hover:bg-(--card-border)"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors font-medium"
          >
            Delete Task
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskEditModal({
  isOpen,
  onClose,
  task,
  allTags,
}: {
  isOpen: boolean;
  onClose: () => void;
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
  const [editContent, setEditContent] = useState(task.content);
  const [editTagIds, setEditTagIds] = useState<Id<"tags">[]>(task.tags.map((t) => t._id));
  const [editStatus, setEditStatus] = useState<TaskStatus>(task.status);
  const [editPriority, setEditPriority] = useState<TaskPriority>(task.priority);
  const [editDueDate, setEditDueDate] = useState(task.dueDate || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const update = useMutation(api.tasks.update);
  const remove = useMutation(api.tasks.remove);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setEditContent(task.content);
      setEditTagIds(task.tags.map((t) => t._id));
      setEditStatus(task.status);
      setEditPriority(task.priority);
      setEditDueDate(task.dueDate || "");
    }
  }, [isOpen, task]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !showDeleteConfirm) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose, showDeleteConfirm]);

  useEffect(() => {
    if (textareaRef.current && isOpen) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [editContent, isOpen]);

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  const editTags = editTagIds
    .map((id) => allTags.find((t) => t._id === id))
    .filter((t): t is Tag => t !== undefined);

  const handleSubmit = async () => {
    if (!editContent.trim()) return;
    
    setIsSubmitting(true);
    try {
      await update({
        id: task._id,
        content: editContent.trim(),
        tagIds: editTagIds,
        status: editStatus,
        priority: editPriority,
        dueDate: editDueDate || null,
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = () => {
    remove({ id: task._id });
    setShowDeleteConfirm(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 cursor-default"
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      
      {/* Modal */}
      <div 
        className="relative bg-(--card-bg) border border-(--card-border) rounded-2xl p-6 max-w-2xl w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-(--accent)/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold">Edit Task</h3>
          </div>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="text-(--muted) hover:text-red-400 transition-colors p-2 rounded-lg hover:bg-red-400/10"
            title="Delete task"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-(--muted) mb-1">Content</label>
            <textarea
              ref={textareaRef}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full min-h-[200px] px-4 py-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors resize-none font-mono text-sm"
              placeholder="What needs to be done?"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-(--muted) mb-1">Status</label>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value as TaskStatus)}
                className="w-full h-[38px] px-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm"
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_CONFIG[s].label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-(--muted) mb-1">Priority</label>
              <select
                value={editPriority}
                onChange={(e) => setEditPriority(e.target.value as TaskPriority)}
                className="w-full h-[38px] px-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm"
              >
                {(["triage", "low", "medium", "high"] as TaskPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_CONFIG[p].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-(--muted) mb-1">Due Date</label>
            <div className="relative w-full h-[38px] bg-background border border-(--card-border) rounded-lg focus-within:border-accent transition-colors">
              <input
                type="date"
                value={editDueDate}
                onChange={(e) => setEditDueDate(e.target.value)}
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
              selectedTags={editTags}
              onTagsChange={setEditTagIds}
              allTags={allTags}
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-(--muted) hover:text-foreground transition-colors rounded-lg hover:bg-(--card-border)"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSubmit()}
              disabled={!editContent.trim() || isSubmitting}
              className="px-4 py-2 text-sm bg-accent hover:bg-(--accent-hover) text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>

        <DeleteConfirmModal
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={handleDelete}
          taskContent={task.content}
        />
      </div>
    </div>
  );
}

function TaskCard({
  task,
  kanbanMode,
  isDragging: isDraggingProp,
  isColumnDropTarget,
  onOpenEditModal,
}: {
  task: {
    _id: Id<"tasks">;
    content: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate?: string;
    tags: Tag[];
  };
  kanbanMode: KanbanMode;
  isDragging?: boolean;
  isColumnDropTarget?: boolean;
  onOpenEditModal?: () => void;
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const hasDraggedRef = useRef(false);

  const remove = useMutation(api.tasks.remove).withOptimisticUpdate(
    (localStore, args) => {
      // Update list query
      const tasks = localStore.getQuery(api.tasks.list, {});
      if (tasks !== undefined) {
        localStore.setQuery(
          api.tasks.list,
          {},
          tasks.filter((t) => t._id !== args.id)
        );
      }
    }
  );

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
      className={`group relative bg-(--card-bg) border border-(--card-border) rounded-xl overflow-hidden transition-all duration-200 hover:border-(--accent)/30 flex cursor-grab active:cursor-grabbing ${isDraggingProp ? "ring-2 ring-accent shadow-lg" : ""}`}
    >
      {/* Accent bar */}
      <div
        className="w-1 shrink-0"
        style={{ backgroundColor: accentColor }}
      />

      <div className="flex-1 p-4 min-w-0">
        {/* Delete button - positioned absolutely to avoid being pushed off */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowDeleteConfirm(true);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 text-(--muted) hover:text-red-400 transition-all duration-200 p-1.5 rounded-lg bg-(--card-bg)/80 backdrop-blur-sm hover:bg-red-400/10 shadow-sm"
          title="Delete task"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>

        <div className="flex flex-wrap gap-1.5 mb-2 pr-10">
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

        <div className="prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2 text-sm wrap-break-word prose-a:text-accent prose-a:no-underline hover:prose-a:underline">
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

        <DeleteConfirmModal
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={() => {
            remove({ id: task._id });
            setShowDeleteConfirm(false);
          }}
          taskContent={task.content}
        />

        {(task.dueDate || (kanbanMode === "status" && task.priority !== "triage") || (kanbanMode === "priority" && task.status !== "not_started")) && (
          <div className="flex items-center gap-3 mt-3 text-xs text-(--muted)">
            {task.dueDate && (
              <span className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {new Date(task.dueDate).toLocaleDateString()}
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
}: {
  columnId: string;
  columnValue: TaskStatus | TaskPriority;
  tasks: Array<{
    _id: Id<"tasks">;
    content: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate?: string;
    tags: Tag[];
  }>;
  kanbanMode: KanbanMode;
  isDropTarget?: boolean;
  onOpenEditModal: (task: { _id: Id<"tasks">; content: string; status: TaskStatus; priority: TaskPriority; dueDate?: string; tags: Tag[] }) => void;
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

type TaskForEdit = {
  _id: Id<"tasks">;
  content: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string;
  tags: Tag[];
};

function TasksList() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [searchText, setSearchText] = useState("");
  const [debouncedSearchText, setDebouncedSearchText] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [kanbanMode, setKanbanMode] = useState<KanbanMode>("status");
  const [activeTaskId, setActiveTaskId] = useState<Id<"tasks"> | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<TaskForEdit | null>(null);

  const tagsQuery = useQuery(api.tags.list);
  const allTags = useMemo(() => tagsQuery ?? [], [tagsQuery]);

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
  const updateStatus = useMutation(api.tasks.updateStatus).withOptimisticUpdate(
    (localStore, args) => {
      const tasks = localStore.getQuery(api.tasks.list, {});
      if (tasks !== undefined) {
        localStore.setQuery(
          api.tasks.list,
          {},
          tasks.map((t) => {
            if (t._id !== args.id) return t;
            return { ...t, status: args.status };
          })
        );
      }
    }
  );

  const updatePriority = useMutation(api.tasks.updatePriority).withOptimisticUpdate(
    (localStore, args) => {
      const tasks = localStore.getQuery(api.tasks.list, {});
      if (tasks !== undefined) {
        localStore.setQuery(
          api.tasks.list,
          {},
          tasks.map((t) => {
            if (t._id !== args.id) return t;
            return { ...t, priority: args.priority };
          })
        );
      }
    }
  );

  const allTagsFormatted: Tag[] = allTags.map((tag) => ({
    _id: tag._id,
    name: tag.name,
    color: tag.color,
  }));

  // Derive selected tag from URL - URL is the source of truth
  const selectedTagId = useMemo(() => {
    const tagParam = searchParams.get("tag");
    if (tagParam && tagsQuery !== undefined) {
      const validTag = allTags.find((t) => t._id === tagParam);
      if (validTag) {
        return tagParam as Id<"tags">;
      }
    }
    return null;
  }, [searchParams, allTags, tagsQuery]);

  // Update URL when tag filter changes
  const handleTagChange = useCallback((tagId: Id<"tags"> | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (tagId) {
      params.set("tag", tagId);
    } else {
      params.delete("tag");
    }
    
    const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
    router.replace(newUrl);
  }, [searchParams, router]);

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

  const selectedTag = selectedTagId
    ? allTagsFormatted.find((t) => t._id === selectedTagId) ?? null
    : null;

  const clearSearch = () => {
    setSearchText("");
    handleTagChange(null);
  };

  // Helper to determine column from a target ID (could be column or task)
  const getColumnFromTargetId = useCallback((targetId: string): string | null => {
    // Check if it's directly a column ID
    if (kanbanMode === "status" && STATUS_ORDER.includes(targetId as TaskStatus)) {
      return targetId;
    }
    if (kanbanMode === "priority" && PRIORITY_ORDER.includes(targetId as TaskPriority)) {
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
      if (STATUS_ORDER.includes(targetId as TaskStatus)) {
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
      if (PRIORITY_ORDER.includes(targetId as TaskPriority)) {
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
    closed: [],
  };

  const tasksByPriority: Record<TaskPriority, TaskWithTags[]> = {
    triage: [],
    low: [],
    medium: [],
    high: [],
  };

  for (const task of tasks ?? []) {
    const taskWithTags = {
      ...task,
      tags: task.tags as Tag[],
    };
    tasksByStatus[task.status].push(taskWithTags);
    tasksByPriority[task.priority].push(taskWithTags);
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Navigation />
      <div className="flex-1 flex flex-col pt-24 min-h-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full flex-1 flex flex-col min-h-0">
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
                allTags={allTagsFormatted}
              />

              {/* Kanban Mode Toggle */}
              <div className="h-[38px] flex items-center bg-(--card-bg) border border-(--card-border) rounded-lg p-1">
                <button
                  onClick={() => setKanbanMode("status")}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    kanbanMode === "status"
                      ? "bg-accent text-white"
                      : "text-(--muted) hover:text-foreground"
                  }`}
                >
                  Status
                </button>
                <button
                  onClick={() => setKanbanMode("priority")}
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
                  ? `${tasks.length} result${tasks.length === 1 ? "" : "s"}`
                  : tasks.length === 0
                  ? "No tasks yet"
                  : `${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
              </p>
              {isSearching && (
                <button
                  onClick={clearSearch}
                  className="text-sm text-accent hover:underline"
                >
                  Clear search
                </button>
              )}
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
              <div className="flex gap-6 overflow-x-auto pb-4 flex-1 min-h-0">
                {kanbanMode === "status" ? (
                  STATUS_ORDER.map((status) => (
                    <KanbanColumn
                      key={status}
                      columnId={status}
                      columnValue={status}
                      tasks={tasksByStatus[status]}
                      kanbanMode={kanbanMode}
                      isDropTarget={overColumnId === status}
                      onOpenEditModal={setEditingTask}
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
                      onOpenEditModal={setEditingTask}
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

      <CreateTaskModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        allTags={allTagsFormatted}
        initialTagId={selectedTagId}
      />

      {editingTask && (
        <TaskEditModal
          isOpen={true}
          onClose={() => setEditingTask(null)}
          task={editingTask}
          allTags={allTagsFormatted}
        />
      )}
    </div>
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
      <div className="bg-(--card-bg) border border-(--card-border) rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2 bg-linear-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            Tasky
          </h1>
          <p className="text-(--muted)">Your personal task manager</p>
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
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return session ? <TasksList /> : <SignIn />;
}
