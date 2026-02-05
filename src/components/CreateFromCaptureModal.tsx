"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

const LOCAL_STORAGE_KEY = "tasky-last-selected-tag";

type Tag = { _id: Id<"tags">; name: string; color?: string };

interface CreateFromCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (tagIds: Id<"tags">[]) => void;
  captureText: string;
  type: "note" | "task";
  /** Tag ID selected on the current page (tasks/notes) - takes priority over last used tag */
  pageSelectedTagId?: Id<"tags"> | null;
}

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
  const [selectedTagId, setSelectedTagId] = useState<Id<"tags"> | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Track modal open state using refs
  const prevIsOpenRef = useRef(false);
  const hasLoadedRef = useRef(false);

  // Load default tag when modal opens
  // Priority: 1) pageSelectedTagId (from tasks/notes page filter)
  //           2) last used tag from localStorage
  //           3) null (blank)
  useEffect(() => {
    // Detect modal open transition (false -> true)
    const justOpened = isOpen && !prevIsOpenRef.current;
    if (justOpened) {
      hasLoadedRef.current = false;
    }

    // Load default tag when modal is open and we haven't loaded yet
    if (isOpen && !hasLoadedRef.current && allTags.length > 0) {
      let newTagId: Id<"tags"> | null = null;
      
      // Priority 1: Use page selected tag if provided and valid
      if (pageSelectedTagId) {
        const tagExists = allTags.some((t) => t._id === pageSelectedTagId);
        if (tagExists) {
          newTagId = pageSelectedTagId;
        }
      }
      
      // Priority 2: Fall back to last used tag from localStorage
      if (!newTagId) {
        const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (saved) {
          const tagExists = allTags.some((t) => t._id === saved);
          if (tagExists) {
            newTagId = saved as Id<"tags">;
          }
        }
      }
      
      // Reading from localStorage is a legitimate sync with external state
      // eslint-disable-next-line
      setSelectedTagId(newTagId);
      hasLoadedRef.current = true;
    }

    prevIsOpenRef.current = isOpen;
  }, [isOpen, allTags, pageSelectedTagId]);

  // Helper to close dropdown and reset search
  const closeDropdown = () => {
    setIsDropdownOpen(false);
    setSearch("");
  };

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        closeDropdown();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isDropdownOpen) {
          closeDropdown();
        } else if (isOpen) {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isDropdownOpen, onClose]);

  if (!isOpen) return null;

  const selectedTag = allTags.find((t) => t._id === selectedTagId);
  const filteredTags = allTags.filter((tag) =>
    tag.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleConfirm = () => {
    // Save selected tag to local storage
    if (selectedTagId) {
      localStorage.setItem(LOCAL_STORAGE_KEY, selectedTagId);
    } else {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
    onConfirm(selectedTagId ? [selectedTagId] : []);
  };

  const handleSelectTag = (tag: Tag) => {
    setSelectedTagId(tag._id);
    closeDropdown();
  };

  const handleClearTag = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedTagId(null);
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

        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">
            Tag (optional)
          </label>
          <div className="relative">
            <button
              ref={buttonRef}
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="w-full flex items-center justify-between h-[42px] px-3 bg-background border border-(--card-border) rounded-lg hover:border-accent transition-colors text-sm"
            >
              {selectedTag ? (
                <span className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: selectedTag.color || "var(--accent)" }}
                  />
                  <span className="truncate">{selectedTag.name}</span>
                </span>
              ) : (
                <span className="text-(--muted)">Select a tag...</span>
              )}
              <div className="flex items-center gap-1">
                {selectedTag && (
                  <span
                    role="button"
                    onClick={handleClearTag}
                    className="hover:opacity-70 transition-opacity p-0.5 cursor-pointer"
                  >
                    <svg className="w-4 h-4 text-(--muted)" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </span>
                )}
                <svg
                  className={`w-4 h-4 text-(--muted) transition-transform ${isDropdownOpen ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {isDropdownOpen && (
              <div
                ref={dropdownRef}
                className="absolute top-full left-0 right-0 mt-1 z-10 bg-(--card-bg) border border-(--card-border) rounded-lg shadow-xl overflow-hidden"
              >
                <div className="p-2 border-b border-(--card-border)">
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search tags..."
                    className="w-full px-2 py-1.5 bg-background border border-(--card-border) rounded text-sm focus:outline-none focus:border-accent"
                    autoFocus
                  />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {filteredTags.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-(--muted)">
                      {allTags.length === 0 ? "No tags created yet" : "No tags found"}
                    </div>
                  ) : (
                    filteredTags.map((tag) => (
                      <button
                        key={tag._id}
                        onClick={() => handleSelectTag(tag)}
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-(--card-border) transition-colors flex items-center gap-2 ${
                          selectedTagId === tag._id ? "bg-(--accent)/10" : ""
                        }`}
                      >
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: tag.color || "var(--accent)" }}
                        />
                        <span className="truncate">{tag.name}</span>
                        {selectedTagId === tag._id && (
                          <svg className="w-4 h-4 ml-auto text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
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
