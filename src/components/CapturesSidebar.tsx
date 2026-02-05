"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useState } from "react";
import { Id } from "../../convex/_generated/dataModel";
import { CreateFromCaptureModal } from "./CreateFromCaptureModal";

function CaptureItem({
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
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    type: "note" | "task";
  }>({ isOpen: false, type: "note" });
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(text);

  const toggle = useMutation(api.captures.toggle).withOptimisticUpdate(
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

  const remove = useMutation(api.captures.remove).withOptimisticUpdate(
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

  const createNoteFromCapture = useMutation(api.notes.createFromCapture).withOptimisticUpdate(
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

  const createTaskFromCapture = useMutation(api.tasks.createFromCapture).withOptimisticUpdate(
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

  const update = useMutation(api.captures.update).withOptimisticUpdate(
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

  const handleStartEditing = () => {
    setEditText(text);
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
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === "Escape") {
      handleCancelEdit();
    }
  };

  const handleOpenModal = (type: "note" | "task") => {
    setModalState({ isOpen: true, type });
  };

  const handleCloseModal = () => {
    setModalState({ isOpen: false, type: modalState.type });
  };

  const handleConfirm = (tagIds: Id<"tags">[]) => {
    if (modalState.type === "task") {
      createTaskFromCapture({ captureId: id, tagIds });
    } else {
      createNoteFromCapture({ captureId: id, tagIds });
    }
    handleCloseModal();
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
              onClick={() => handleOpenModal("task")}
              className="text-(--muted) hover:text-accent transition-colors p-1 rounded hover:bg-accent/10"
              title="Create task"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </button>
            <button
              onClick={() => handleOpenModal("note")}
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
          <input
            type="text"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={handleSaveEdit}
            onKeyDown={handleKeyDown}
            autoFocus
            className="w-full min-w-0 bg-transparent border-b border-accent outline-none py-0.5 text-sm"
          />
        ) : (
          <span
            onClick={handleStartEditing}
            className={`block cursor-text wrap-break-word text-sm leading-relaxed ${completed ? "line-through text-(--muted)" : ""}`}
          >
            {text}
          </span>
        )}
        </div>
      </div>

      <CreateFromCaptureModal
        isOpen={modalState.isOpen}
        onClose={handleCloseModal}
        onConfirm={handleConfirm}
        captureText={text}
        type={modalState.type}
        pageSelectedTagId={pageSelectedTagId}
      />
    </>
  );
}

export function CapturesSidebar({
  pageSelectedTagId,
}: {
  pageSelectedTagId?: Id<"tags"> | null;
} = {}) {
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const queryArgs = { includeCompleted };
  const captures = useQuery(api.captures.list, queryArgs);
  const create = useMutation(api.captures.create).withOptimisticUpdate(
    (localStore, args) => {
      const captures = localStore.getQuery(api.captures.list, queryArgs);
      if (captures !== undefined) {
        const tempCapture = {
          _id: crypto.randomUUID() as Id<"captures">,
          _creationTime: Number.MAX_SAFE_INTEGER,
          userId: "",
          text: args.text,
          completed: false,
        };
        localStore.setQuery(api.captures.list, queryArgs, [tempCapture, ...captures]);
      }
    }
  );
  const [newCapture, setNewCapture] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCapture.trim()) return;
    create({ text: newCapture.trim() });
    setNewCapture("");
  };

  const completedCount = captures?.filter((c) => c.completed).length ?? 0;
  const totalCount = captures?.length ?? 0;

  return (
    <div className="w-80 shrink-0 flex flex-col h-full border-l border-(--card-border) bg-background">
      <div className="px-2 border-b border-(--card-border)">
        <form onSubmit={handleSubmit}>
          <div className="flex gap-2">
            <input
              type="text"
              value={newCapture}
              onChange={(e) => setNewCapture(e.target.value)}
              placeholder="Capture something..."
              className="flex-1 bg-(--card-bg) border border-(--card-border) rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors placeholder:text-(--muted)"
            />
            <button
              type="submit"
              className="bg-accent hover:bg-(--accent-hover) text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Add
            </button>
          </div>
        </form>
      </div>

      <div className="p-4 border-b border-(--card-border) flex items-center justify-between">
        <p className="text-(--muted) text-xs">
          {totalCount === 0
            ? "No captures yet"
            : includeCompleted
              ? `${completedCount} of ${totalCount} completed`
              : `${totalCount} pending`}
        </p>
        <button
          onClick={() => setIncludeCompleted(!includeCompleted)}
          className={`flex items-center gap-1.5 text-xs transition-colors duration-200 ${
            includeCompleted ? "text-accent" : "text-(--muted) hover:text-foreground"
          }`}
        >
          <span
            className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors duration-200 ${
              includeCompleted ? "bg-accent" : "bg-(--card-border)"
            }`}
          >
            <span
              className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                includeCompleted ? "translate-x-[14px]" : "translate-x-1"
              }`}
            />
          </span>
          Completed
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {captures === undefined ? (
          <div className="text-center py-4 text-(--muted) text-sm">Loading...</div>
        ) : captures.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-(--muted) text-sm mb-1">
              {includeCompleted ? "No captures yet" : "No pending captures"}
            </p>
            <p className="text-xs text-(--muted)/60">
              {includeCompleted ? "Add your first capture above" : "All caught up!"}
            </p>
          </div>
        ) : (
          captures.map((capture) => (
            <CaptureItem
              key={capture._id}
              id={capture._id}
              text={capture.text}
              completed={capture.completed}
              includeCompleted={includeCompleted}
              pageSelectedTagId={pageSelectedTagId}
            />
          ))
        )}
      </div>
    </div>
  );
}
