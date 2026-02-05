"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useState, useRef, useEffect } from "react";
import { Id } from "../../convex/_generated/dataModel";
import { Navigation } from "../components/Navigation";
import { SignIn } from "../components/SignIn";
import { useAuthSession } from "@/lib/useAuthSession";
import { CreateFromCaptureModal } from "../components/CreateFromCaptureModal";

function CaptureItem({
  id,
  text,
  completed,
  includeCompleted,
}: {
  id: Id<"captures">;
  text: string;
  completed: boolean;
  includeCompleted: boolean;
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
        // If not including completed, filter out the now-completed item
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
    }
  }, [isEditing, editText]);

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
      <div className="group flex items-start gap-3 bg-(--card-bg) border border-(--card-border) rounded-xl p-4 transition-all duration-200 hover:border-accent/30">
        <button
          onClick={() => toggle({ id })}
          className={`w-6 h-6 shrink-0 rounded-lg border-2 flex items-center justify-center transition-all duration-200 ${
            completed
              ? "bg-accent border-accent"
              : "border-(--muted) hover:border-accent"
          }`}
        >
          {completed && (
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
        {isEditing ? (
          <textarea
            ref={editTextareaRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={handleSaveEdit}
            onKeyDown={handleKeyDown}
            autoFocus
            rows={1}
            className="flex-1 min-w-0 bg-transparent border-b border-accent outline-none py-0.5 resize-none overflow-hidden"
          />
        ) : (
          <span
            onClick={handleStartEditing}
            className={`flex-1 min-w-0 cursor-text break-all whitespace-pre-wrap ${completed ? "line-through text-(--muted)" : ""}`}
          >
            {text}
          </span>
        )}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => handleOpenModal("task")}
            className="opacity-0 group-hover:opacity-100 text-(--muted) hover:text-accent transition-all duration-200 p-1 rounded-lg hover:bg-accent/10"
            title="Create task"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </button>
          <button
            onClick={() => handleOpenModal("note")}
            className="opacity-0 group-hover:opacity-100 text-(--muted) hover:text-accent transition-all duration-200 p-1 rounded-lg hover:bg-accent/10"
            title="Create note"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </button>
          <button
            onClick={() => remove({ id })}
            className="opacity-0 group-hover:opacity-100 text-(--muted) hover:text-red-400 transition-all duration-200 p-1 rounded-lg hover:bg-red-400/10"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <CreateFromCaptureModal
        isOpen={modalState.isOpen}
        onClose={handleCloseModal}
        onConfirm={handleConfirm}
        captureText={text}
        type={modalState.type}
      />
    </>
  );
}

function CaptureList() {
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const queryArgs = { includeCompleted };
  const captures = useQuery(api.captures.list, queryArgs);
  const create = useMutation(api.captures.create).withOptimisticUpdate(
    (localStore, args) => {
      const captures = localStore.getQuery(api.captures.list, queryArgs);
      if (captures !== undefined) {
        // Create a temporary capture - it will be replaced when the server responds
        // New captures are added at the beginning since we sort by creation time desc
        // Use MAX_SAFE_INTEGER so it sorts to the top until server responds with real timestamp
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
  const mainTextareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCapture.trim()) return;
    create({ text: newCapture.trim() });
    setNewCapture("");
    if (mainTextareaRef.current) {
      mainTextareaRef.current.style.height = "auto";
    }
  };

  const handleMainKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  useEffect(() => {
    if (mainTextareaRef.current) {
      const textarea = mainTextareaRef.current;
      textarea.style.height = "auto";
      textarea.style.height = textarea.scrollHeight + "px";
    }
  }, [newCapture]);

  const completedCount = captures?.filter((c) => c.completed).length ?? 0;
  const totalCount = captures?.length ?? 0;

  return (
    <>
      <Navigation />
      <div className="min-h-screen pt-24 pb-12 px-4">
        <div className="max-w-xl mx-auto">
          <div className="mb-6 flex items-center justify-between">
            <p className="text-(--muted) text-sm">
              {totalCount === 0
                ? "No captures yet"
                : includeCompleted
                  ? `${completedCount} of ${totalCount} completed`
                  : `${totalCount} pending`}
            </p>
            <button
              onClick={() => setIncludeCompleted(!includeCompleted)}
              className={`flex items-center gap-2 text-sm transition-colors duration-200 ${
                includeCompleted ? "text-accent" : "text-(--muted) hover:text-foreground"
              }`}
            >
              <span
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${
                  includeCompleted ? "bg-accent" : "bg-(--card-border)"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    includeCompleted ? "translate-x-[18px]" : "translate-x-1"
                  }`}
                />
              </span>
              Show completed
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mb-6">
            <div className="flex gap-3 items-start">
              <textarea
                ref={mainTextareaRef}
                value={newCapture}
                onChange={(e) => setNewCapture(e.target.value)}
                onKeyDown={handleMainKeyDown}
                placeholder="Capture something..."
                autoFocus
                rows={1}
                className="flex-1 bg-(--card-bg) border border-(--card-border) rounded-xl px-4 py-3 focus:outline-none focus:border-accent transition-colors placeholder:text-(--muted) resize-none overflow-hidden max-h-48"
              />
              <button
                type="submit"
                className="bg-accent hover:bg-(--accent-hover) text-white px-6 py-3 rounded-xl font-medium transition-colors"
              >
                Add
              </button>
            </div>
          </form>

          <div className="space-y-3">
            {captures === undefined ? (
              <div className="text-center py-8 text-(--muted)">Loading...</div>
            ) : captures.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-(--muted) mb-2">
                  {includeCompleted ? "No captures yet" : "No pending captures"}
                </p>
                <p className="text-sm text-(--muted)/60">
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
                />
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default function Home() {
  const { session, isPending } = useAuthSession();

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return session ? <CaptureList /> : <SignIn />;
}
