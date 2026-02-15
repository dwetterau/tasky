"use client";

import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import { useTrackedMutation } from "@/lib/useTrackedMutation";
import { useState, useRef, useEffect, useMemo } from "react";
import { Id } from "../../convex/_generated/dataModel";
import { CreateFromCaptureModal } from "./CreateFromCaptureModal";
import { TaskModal } from "../app/tasks/TaskModal";
import { Tag } from "./TagSelector";

const LOCAL_STORAGE_KEY = "tasky-last-selected-tag";

export function CaptureItem({
  id,
  text,
  completed,
  includeCompleted,
  pageSelectedTagId,
}: {
  id: Id<"captures">;
  text: string;
  completed: boolean;
  includeCompleted: boolean;
  pageSelectedTagId?: Id<"tags"> | null;
}) {
  const queryArgs = { includeCompleted };
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);

  // Fetch tags for TaskModal
  const allTagsQuery = useQuery(api.tags.list);
  const allTags: Tag[] = useMemo(
    () => allTagsQuery?.map((t) => ({ _id: t._id, name: t.name, color: t.color })) ?? [],
    [allTagsQuery]
  );

  // Compute initial tag ID: pageSelectedTagId > localStorage > none
  const initialTagId = useMemo(() => {
    if (pageSelectedTagId && allTags.some((t) => t._id === pageSelectedTagId)) {
      return pageSelectedTagId;
    }
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved && allTags.some((t) => t._id === saved)) {
      return saved as Id<"tags">;
    }
    return null;
  }, [pageSelectedTagId, allTags]);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(text);

  const toggle = useTrackedMutation(api.captures.toggle).withOptimisticUpdate(
    (localStore, args) => {
      const captures = localStore.getQuery(api.captures.list, queryArgs);
      if (captures !== undefined) {
        const updatedCaptures = captures.map((capture) =>
          capture._id === args.id
            ? { ...capture, completed: !capture.completed, statusUpdatedAt: Date.now() }
            : capture
        );
        const filteredCaptures = includeCompleted
          ? updatedCaptures
          : updatedCaptures.filter((c) => !c.completed);
        localStore.setQuery(api.captures.list, queryArgs, filteredCaptures);
      }
    }
  );

  const remove = useTrackedMutation(api.captures.remove).withOptimisticUpdate(
    (localStore, args) => {
      const captures = localStore.getQuery(api.captures.list, queryArgs);
      if (captures !== undefined) {
        localStore.setQuery(
          api.captures.list,
          queryArgs,
          captures.filter((capture) => capture._id !== args.id)
        );
      }
    }
  );

  const createNoteFromCapture = useTrackedMutation(api.notes.createFromCapture).withOptimisticUpdate(
    (localStore, args) => {
      const captures = localStore.getQuery(api.captures.list, queryArgs);
      if (captures !== undefined) {
        localStore.setQuery(
          api.captures.list,
          queryArgs,
          captures.filter((capture) => capture._id !== args.captureId)
        );
      }
    }
  );

  const update = useTrackedMutation(api.captures.update).withOptimisticUpdate(
    (localStore, args) => {
      const captures = localStore.getQuery(api.captures.list, queryArgs);
      if (captures !== undefined) {
        localStore.setQuery(
          api.captures.list,
          queryArgs,
          captures.map((capture) =>
            capture._id === args.id ? { ...capture, text: args.text } : capture
          )
        );
      }
    }
  );

  const cursorPositionRef = useRef<number | null>(null);

  const handleStartEditing = (e: React.MouseEvent) => {
    setEditText(text);

    // Determine cursor position from where the user clicked
    let cursorPos = text.length;
    const caretPos = document.caretPositionFromPoint(e.clientX, e.clientY);
    if (caretPos) {
      cursorPos = caretPos.offset;
    }

    cursorPositionRef.current = cursorPos;
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    const trimmedText = editText.trim();
    if (trimmedText && trimmedText !== text) {
      update({ id, text: trimmedText });
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditText(text);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === "Escape") {
      handleCancelEdit();
    }
  };

  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && editTextareaRef.current) {
      const textarea = editTextareaRef.current;
      textarea.style.height = "auto";
      textarea.style.height = textarea.scrollHeight + "px";

      // Set cursor position from the original click location
      if (cursorPositionRef.current !== null) {
        textarea.focus();
        textarea.selectionStart = cursorPositionRef.current;
        textarea.selectionEnd = cursorPositionRef.current;
        cursorPositionRef.current = null;
      }
    }
  }, [isEditing, editText]);

  const handleNoteConfirm = (tagIds: Id<"tags">[]) => {
    createNoteFromCapture({ captureId: id, tagIds });
    setShowNoteModal(false);
  };

  return (
    <>
      <div className="bg-(--card-bg) border border-(--card-border) rounded-lg px-3 pb-3 pt-1 transition-all duration-200">
        {/* Action row - always visible */}
        <div className="flex items-center justify-between pb-1">
          <button
            onClick={() => toggle({ id })}
            className={`p-1 rounded transition-colors ${
              completed
                ? "text-accent hover:bg-green-500/10"
                : "text-(--muted) hover:text-accent hover:bg-green-500/10"
            }`}
            title={completed ? "Mark incomplete" : "Mark complete"}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </button>

          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setShowTaskModal(true)}
              className="text-(--muted) hover:text-accent transition-colors p-1 rounded hover:bg-accent/10"
              title="Create task"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </button>
            <button
              onClick={() => setShowNoteModal(true)}
              className="text-(--muted) hover:text-accent transition-colors p-1 rounded hover:bg-accent/10"
              title="Create note"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>
            <button
              onClick={() => remove({ id })}
              className="text-(--muted) hover:text-red-400 transition-colors p-1 rounded hover:bg-red-400/10"
              title="Delete"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="border-t border-(--card-border) pt-2 mt-0">
          {/* Text content */}
          {isEditing ? (
            <textarea
              ref={editTextareaRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onBlur={handleSaveEdit}
              onKeyDown={handleKeyDown}
              rows={1}
              className="w-full min-w-0 bg-transparent border-b border-accent outline-none py-0.5 text-sm resize-none overflow-hidden"
            />
          ) : (
            <span
              onClick={handleStartEditing}
              className={`block cursor-text wrap-break-word text-sm leading-relaxed whitespace-pre-wrap ${completed ? "line-through text-(--muted)" : ""}`}
            >
              {text}
            </span>
          )}
        </div>
      </div>

      <TaskModal
        isOpen={showTaskModal}
        onClose={() => setShowTaskModal(false)}
        allTags={allTags}
        initialTagId={initialTagId}
        initialContent={text}
        createdFromCaptureId={id}
      />

      <CreateFromCaptureModal
        isOpen={showNoteModal}
        onClose={() => setShowNoteModal(false)}
        onConfirm={handleNoteConfirm}
        captureText={text}
        type="note"
        pageSelectedTagId={pageSelectedTagId}
      />
    </>
  );
}
