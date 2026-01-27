"use client";

import { useState, useEffect, useRef } from "react";
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
}

export function CreateFromCaptureModal({
  isOpen,
  onClose,
  onConfirm,
  captureText,
  type,
}: CreateFromCaptureModalProps) {
  const allTags = useQuery(api.tags.list) ?? [];
  const [selectedTagId, setSelectedTagId] = useState<Id<"tags"> | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [initialized, setInitialized] = useState(false);

  // Load last selected tag from local storage on mount
  useEffect(() => {
    if (!initialized && allTags.length > 0) {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        // Verify the saved tag still exists
        const tagExists = allTags.some((t) => t._id === saved);
        if (tagExists) {
          setSelectedTagId(saved as Id<"tags">);
        }
      }
      setInitialized(true);
    }
  }, [allTags, initialized]);

  // Reset search when dropdown closes
  useEffect(() => {
    if (!isDropdownOpen) {
      setSearch("");
    }
  }, [isDropdownOpen]);

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
        setIsDropdownOpen(false);
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
          setIsDropdownOpen(false);
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
    setIsDropdownOpen(false);
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
        className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            Create {type === "task" ? "Task" : "Note"}
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors p-1 rounded-lg hover:bg-[var(--card-border)]"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mb-4 p-3 bg-[var(--background)] rounded-lg border border-[var(--card-border)]">
          <p className="text-sm text-[var(--muted)] mb-1">From capture:</p>
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
              className="w-full flex items-center justify-between h-[42px] px-3 bg-[var(--background)] border border-[var(--card-border)] rounded-lg hover:border-[var(--accent)] transition-colors text-sm"
            >
              {selectedTag ? (
                <span className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: selectedTag.color || "var(--accent)" }}
                  />
                  <span className="truncate">{selectedTag.name}</span>
                </span>
              ) : (
                <span className="text-[var(--muted)]">Select a tag...</span>
              )}
              <div className="flex items-center gap-1">
                {selectedTag && (
                  <span
                    role="button"
                    onClick={handleClearTag}
                    className="hover:opacity-70 transition-opacity p-0.5 cursor-pointer"
                  >
                    <svg className="w-4 h-4 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </span>
                )}
                <svg
                  className={`w-4 h-4 text-[var(--muted)] transition-transform ${isDropdownOpen ? "rotate-180" : ""}`}
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
                className="absolute top-full left-0 right-0 mt-1 z-10 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg shadow-xl overflow-hidden"
              >
                <div className="p-2 border-b border-[var(--card-border)]">
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search tags..."
                    className="w-full px-2 py-1.5 bg-[var(--background)] border border-[var(--card-border)] rounded text-sm focus:outline-none focus:border-[var(--accent)]"
                    autoFocus
                  />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {filteredTags.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-[var(--muted)]">
                      {allTags.length === 0 ? "No tags created yet" : "No tags found"}
                    </div>
                  ) : (
                    filteredTags.map((tag) => (
                      <button
                        key={tag._id}
                        onClick={() => handleSelectTag(tag)}
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-[var(--card-border)] transition-colors flex items-center gap-2 ${
                          selectedTagId === tag._id ? "bg-[var(--accent)]/10" : ""
                        }`}
                      >
                        <span
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: tag.color || "var(--accent)" }}
                        />
                        <span className="truncate">{tag.name}</span>
                        {selectedTagId === tag._id && (
                          <svg className="w-4 h-4 ml-auto text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
            className="flex-1 px-4 py-2.5 border border-[var(--card-border)] rounded-xl text-sm font-medium hover:bg-[var(--card-border)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 px-4 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-xl text-sm font-medium transition-colors"
          >
            Create {type === "task" ? "Task" : "Note"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
