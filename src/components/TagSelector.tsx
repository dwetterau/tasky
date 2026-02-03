"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Id } from "../../convex/_generated/dataModel";

export type Tag = { _id: Id<"tags">; name: string; color?: string };

// Hook to calculate and update dropdown position
function useDropdownPosition(
  containerRef: React.RefObject<HTMLDivElement | null>,
  isOpen: boolean
) {
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const [isPositionReady, setIsPositionReady] = useState(false);

  const updatePosition = useCallback(() => {
    if (containerRef.current && isOpen) {
      const rect = containerRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
      setIsPositionReady(true);
    }
  }, [containerRef, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      // Reset ready state when dropdown closes
      setIsPositionReady(false);
      return;
    }

    updatePosition();

    // Update position on scroll/resize
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen, updatePosition]);

  return { position, isPositionReady };
}

// Multi-select tag selector for editing items
export function TagSelector({
  selectedTags,
  onTagsChange,
  allTags,
}: {
  selectedTags: Tag[];
  onTagsChange: (tagIds: Id<"tags">[]) => void;
  allTags: Tag[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const { position, isPositionReady } = useDropdownPosition(containerRef, isOpen);

  const selectedIds = new Set(selectedTags.map((t) => t._id));
  const availableTags = allTags.filter(
    (tag) =>
      !selectedIds.has(tag._id) &&
      tag.name.toLowerCase().includes(search.toLowerCase())
  );

  // Reset highlighted index when dropdown opens or available tags change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [isOpen, search]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && itemRefs.current[highlightedIndex]) {
      itemRefs.current[highlightedIndex]?.scrollIntoView({
        block: "nearest",
      });
    }
  }, [highlightedIndex, isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const addTag = (tag: Tag) => {
    onTagsChange([...selectedTags.map((t) => t._id), tag._id]);
    setSearch("");
    setHighlightedIndex(0);
    inputRef.current?.focus();
  };

  const removeTag = (tagId: Id<"tags">) => {
    onTagsChange(selectedTags.filter((t) => t._id !== tagId).map((t) => t._id));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || availableTags.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < availableTags.length - 1 ? prev + 1 : 0
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : availableTags.length - 1
        );
        break;
      case "Enter":
        e.preventDefault();
        if (availableTags[highlightedIndex]) {
          addTag(availableTags[highlightedIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        break;
    }
  };

  const renderDropdown = () => {
    if (!isOpen || !isPositionReady) return null;

    // Reset refs array
    itemRefs.current = [];

    const dropdownContent = availableTags.length > 0 ? (
      <div
        ref={dropdownRef}
        className="fixed z-50 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg shadow-xl max-h-48 overflow-y-auto"
        style={{
          top: position.top,
          left: position.left,
          width: position.width,
        }}
      >
        {availableTags.map((tag, index) => (
          <button
            key={tag._id}
            ref={(el) => { itemRefs.current[index] = el; }}
            onClick={() => addTag(tag)}
            onMouseEnter={() => setHighlightedIndex(index)}
            className={`w-full px-3 py-2 text-left text-sm transition-colors flex items-center gap-2 ${
              index === highlightedIndex
                ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                : "hover:bg-[var(--card-border)]"
            }`}
          >
            <span
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: tag.color || "var(--accent)" }}
            />
            {tag.name}
          </button>
        ))}
      </div>
    ) : search ? (
      <div
        ref={dropdownRef}
        className="fixed z-50 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg shadow-xl p-3 text-sm text-[var(--muted)]"
        style={{
          top: position.top,
          left: position.left,
          width: position.width,
        }}
      >
        No matching tags
      </div>
    ) : null;

    if (!dropdownContent) return null;

    return createPortal(dropdownContent, document.body);
  };

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex flex-wrap items-center gap-2 min-h-[38px] px-3 py-2 bg-[var(--background)] border border-[var(--card-border)] rounded-lg cursor-text focus-within:border-[var(--accent)] transition-colors"
        onClick={() => {
          setIsOpen(true);
          inputRef.current?.focus();
        }}
      >
        {selectedTags.map((tag) => (
          <span
            key={tag._id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
            style={{
              backgroundColor: tag.color ? `${tag.color}20` : "var(--accent-muted)",
              color: tag.color || "var(--accent)",
            }}
          >
            {tag.name}
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeTag(tag._id);
              }}
              className="hover:opacity-70 transition-opacity"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={selectedTags.length === 0 ? "Add tags..." : ""}
          className="flex-1 min-w-[80px] bg-transparent outline-none text-sm placeholder:text-[var(--muted)]"
        />
      </div>

      {renderDropdown()}
    </div>
  );
}

// Special constant for "no tag" filter
export const NO_TAG_FILTER = "__no_tag__" as const;
export type TagFilterValue = Id<"tags"> | typeof NO_TAG_FILTER | null;

// Single-select tag filter for search/filter UI
export function SearchTagSelector({
  selectedTag,
  onTagChange,
  allTags,
  selectedNoTag = false,
}: {
  selectedTag: Tag | null;
  onTagChange: (tagId: TagFilterValue) => void;
  allTags: Tag[];
  selectedNoTag?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const { position, isPositionReady } = useDropdownPosition(containerRef, isOpen);

  const availableTags = allTags.filter((tag) =>
    tag.name.toLowerCase().includes(search.toLowerCase())
  );

  // Reset highlighted index when dropdown opens or search changes
  useEffect(() => {
    setHighlightedIndex(0);
  }, [isOpen, search]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && itemRefs.current[highlightedIndex]) {
      itemRefs.current[highlightedIndex]?.scrollIntoView({
        block: "nearest",
      });
    }
  }, [highlightedIndex, isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectTag = (tag: Tag) => {
    onTagChange(tag._id);
    setIsOpen(false);
    setSearch("");
    setHighlightedIndex(0);
  };

  const selectNoTag = () => {
    onTagChange(NO_TAG_FILTER);
    setIsOpen(false);
    setSearch("");
    setHighlightedIndex(0);
  };

  // Include "No tag" option in the list when searching matches it
  const showNoTagOption = "no tag".includes(search.toLowerCase()) || search === "";
  const totalItems = (showNoTagOption ? 1 : 0) + availableTags.length;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (totalItems === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < totalItems - 1 ? prev + 1 : 0
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : totalItems - 1
        );
        break;
      case "Enter":
        e.preventDefault();
        if (showNoTagOption && highlightedIndex === 0) {
          selectNoTag();
        } else {
          const tagIndex = showNoTagOption ? highlightedIndex - 1 : highlightedIndex;
          if (availableTags[tagIndex]) {
            selectTag(availableTags[tagIndex]);
          }
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        break;
    }
  };

  const renderDropdown = () => {
    if (!isOpen || !isPositionReady) return null;

    // Reset refs array
    itemRefs.current = [];

    const dropdownContent = (
      <div
        ref={dropdownRef}
        className="fixed z-50 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg shadow-xl min-w-[200px] max-h-64 overflow-hidden"
        style={{
          top: position.top,
          left: position.left,
          minWidth: Math.max(position.width, 200),
        }}
      >
        <div className="p-2 border-b border-[var(--card-border)]">
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tags..."
            className="w-full px-2 py-1 bg-[var(--background)] border border-[var(--card-border)] rounded text-sm focus:outline-none focus:border-[var(--accent)]"
            autoFocus
          />
        </div>
        <div className="max-h-48 overflow-y-auto">
          {totalItems === 0 ? (
            <div className="px-3 py-2 text-sm text-[var(--muted)]">No tags found</div>
          ) : (
            <>
              {showNoTagOption && (
                <button
                  ref={(el) => { itemRefs.current[0] = el; }}
                  onClick={selectNoTag}
                  onMouseEnter={() => setHighlightedIndex(0)}
                  className={`w-full px-3 py-2 text-left text-sm transition-colors flex items-center gap-2 ${
                    highlightedIndex === 0
                      ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "hover:bg-[var(--card-border)]"
                  }`}
                >
                  <span className="w-3 h-3 rounded-full border-2 border-[var(--muted)] border-dashed" />
                  No tag
                </button>
              )}
              {availableTags.map((tag, index) => {
                const itemIndex = showNoTagOption ? index + 1 : index;
                return (
                  <button
                    key={tag._id}
                    ref={(el) => { itemRefs.current[itemIndex] = el; }}
                    onClick={() => selectTag(tag)}
                    onMouseEnter={() => setHighlightedIndex(itemIndex)}
                    className={`w-full px-3 py-2 text-left text-sm transition-colors flex items-center gap-2 ${
                      itemIndex === highlightedIndex
                        ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                        : "hover:bg-[var(--card-border)]"
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: tag.color || "var(--accent)" }}
                    />
                    {tag.name}
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>
    );

    return createPortal(dropdownContent, document.body);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 h-[38px] px-3 bg-[var(--background)] border border-[var(--card-border)] rounded-lg hover:border-[var(--accent)] transition-colors text-sm"
      >
        {selectedNoTag ? (
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full border-2 border-[var(--muted)] border-dashed" />
            <span>No tag</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTagChange(null);
              }}
              className="hover:opacity-70 transition-opacity ml-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ) : selectedTag ? (
          <span className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: selectedTag.color || "var(--accent)" }}
            />
            <span>{selectedTag.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTagChange(null);
              }}
              className="hover:opacity-70 transition-opacity ml-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ) : (
          <span className="text-[var(--muted)] flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
            </svg>
            Filter by tag
          </span>
        )}
      </button>

      {renderDropdown()}
    </div>
  );
}
