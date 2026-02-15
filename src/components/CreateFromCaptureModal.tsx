"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { TagSelector, Tag } from "./TagSelector";
import { StyledSelect, type SelectOption } from "./StyledSelect";
import {
  type TaskPriority,
  PRIORITY_CONFIG,
  PRIORITY_ORDER,
} from "../app/tasks/constants";

const LOCAL_STORAGE_KEY = "tasky-last-selected-tag";

interface CreateFromCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (tagIds: Id<"tags">[], priority?: TaskPriority) => void;
  captureText: string;
  type: "note" | "task";
  /** Tag ID selected on the current page (tasks/notes) - takes priority over last used tag */
  pageSelectedTagId?: Id<"tags"> | null;
}

const priorityOptions: SelectOption[] = PRIORITY_ORDER.map((p) => ({
  value: p,
  label: PRIORITY_CONFIG[p].label,
  color: PRIORITY_CONFIG[p].color,
}));

export function CreateFromCaptureModal({
  isOpen,
  onClose,
  onConfirm,
  captureText,
  type,
  pageSelectedTagId,
}: CreateFromCaptureModalProps) {
  const allTagsQuery = useQuery(api.tags.list);
  const allTags = useMemo(() => allTagsQuery ?? [], [allTagsQuery]);
  const [selectedTagIds, setSelectedTagIds] = useState<Id<"tags">[]>([]);
  const [priority, setPriority] = useState<TaskPriority>("triage");

  // Track modal open state using refs
  const prevIsOpenRef = useRef(false);
  const hasLoadedRef = useRef(false);

  // Load default tag when modal opens
  // Priority: 1) pageSelectedTagId (from tasks/notes page filter)
  //           2) last used tag from localStorage
  //           3) empty (no tags)
  useEffect(() => {
    // Detect modal open transition (false -> true)
    const justOpened = isOpen && !prevIsOpenRef.current;
    if (justOpened) {
      hasLoadedRef.current = false;
    }

    // Load default tag when modal is open and we haven't loaded yet
    if (isOpen && !hasLoadedRef.current && allTags.length > 0) {
      let defaultTagId: Id<"tags"> | null = null;

      // Priority 1: Use page selected tag if provided and valid
      if (pageSelectedTagId) {
        const tagExists = allTags.some((t) => t._id === pageSelectedTagId);
        if (tagExists) {
          defaultTagId = pageSelectedTagId;
        }
      }

      // Priority 2: Fall back to last used tag from localStorage
      if (!defaultTagId) {
        const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (saved) {
          const tagExists = allTags.some((t) => t._id === saved);
          if (tagExists) {
            defaultTagId = saved as Id<"tags">;
          }
        }
      }

      // Reading from localStorage is a legitimate sync with external state
      // eslint-disable-next-line
      setSelectedTagIds(defaultTagId ? [defaultTagId] : []);
      setPriority("triage");
      hasLoadedRef.current = true;
    }

    prevIsOpenRef.current = isOpen;
  }, [isOpen, allTags, pageSelectedTagId]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const selectedTags = selectedTagIds
    .map((id) => allTags.find((t) => t._id === id))
    .filter((t) => t !== undefined);

  const handleConfirm = () => {
    // Save first selected tag to local storage for next time
    if (selectedTagIds.length > 0) {
      localStorage.setItem(LOCAL_STORAGE_KEY, selectedTagIds[0]);
    } else {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
    onConfirm(selectedTagIds, type === "task" ? priority : undefined);
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-(--card-bg) border border-(--card-border) rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            Create {type === "task" ? "Task" : "Note"}
          </h2>
          <button
            onClick={onClose}
            className="text-(--muted) hover:text-foreground transition-colors p-1 rounded-lg hover:bg-(--card-border)"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mb-4 p-3 bg-background rounded-lg border border-(--card-border)">
          <p className="text-sm text-(--muted) mb-1">From capture:</p>
          <p className="text-sm line-clamp-3">{captureText}</p>
        </div>

        {/* Priority selector - only for tasks */}
        {type === "task" && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Priority</label>
            <StyledSelect
              value={priority}
              onChange={(v) => setPriority(v as TaskPriority)}
              options={priorityOptions}
            />
          </div>
        )}

        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">
            Tags (optional)
          </label>
          <TagSelector
            selectedTags={selectedTags}
            onTagsChange={setSelectedTagIds}
            allTags={allTags}
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-(--card-border) rounded-xl text-sm font-medium hover:bg-(--card-border) transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 px-4 py-2.5 bg-accent hover:bg-(--accent-hover) text-white rounded-xl text-sm font-medium transition-colors"
          >
            Create {type === "task" ? "Task" : "Note"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
