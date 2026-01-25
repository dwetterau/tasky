"use client";

import { useState, useRef, useEffect } from "react";
import { Id } from "../../convex/_generated/dataModel";

export type Tag = { _id: Id<"tags">; name: string; color?: string };

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
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedIds = new Set(selectedTags.map((t) => t._id));
  const availableTags = allTags.filter(
    (tag) =>
      !selectedIds.has(tag._id) &&
      tag.name.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const addTag = (tag: Tag) => {
    onTagsChange([...selectedTags.map((t) => t._id), tag._id]);
    setSearch("");
    inputRef.current?.focus();
  };

  const removeTag = (tagId: Id<"tags">) => {
    onTagsChange(selectedTags.filter((t) => t._id !== tagId).map((t) => t._id));
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
          placeholder={selectedTags.length === 0 ? "Add tags..." : ""}
          className="flex-1 min-w-[80px] bg-transparent outline-none text-sm placeholder:text-[var(--muted)]"
        />
      </div>

      {isOpen && availableTags.length > 0 && (
        <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg shadow-xl max-h-48 overflow-y-auto">
          {availableTags.map((tag) => (
            <button
              key={tag._id}
              onClick={() => addTag(tag)}
              className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--card-border)] transition-colors flex items-center gap-2"
            >
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: tag.color || "var(--accent)" }}
              />
              {tag.name}
            </button>
          ))}
        </div>
      )}

      {isOpen && search && availableTags.length === 0 && (
        <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg shadow-xl p-3 text-sm text-[var(--muted)]">
          No matching tags
        </div>
      )}
    </div>
  );
}

// Single-select tag filter for search/filter UI
export function SearchTagSelector({
  selectedTag,
  onTagChange,
  allTags,
}: {
  selectedTag: Tag | null;
  onTagChange: (tagId: Id<"tags"> | null) => void;
  allTags: Tag[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const availableTags = allTags.filter((tag) =>
    tag.name.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 h-[38px] px-3 bg-[var(--background)] border border-[var(--card-border)] rounded-lg hover:border-[var(--accent)] transition-colors text-sm"
      >
        {selectedTag ? (
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

      {isOpen && (
        <div className="absolute z-10 top-full left-0 mt-1 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg shadow-xl min-w-[200px] max-h-64 overflow-hidden">
          <div className="p-2 border-b border-[var(--card-border)]">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tags..."
              className="w-full px-2 py-1 bg-[var(--background)] border border-[var(--card-border)] rounded text-sm focus:outline-none focus:border-[var(--accent)]"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {availableTags.length === 0 ? (
              <div className="px-3 py-2 text-sm text-[var(--muted)]">No tags found</div>
            ) : (
              availableTags.map((tag) => (
                <button
                  key={tag._id}
                  onClick={() => {
                    onTagChange(tag._id);
                    setIsOpen(false);
                    setSearch("");
                  }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--card-border)] transition-colors flex items-center gap-2"
                >
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: tag.color || "var(--accent)" }}
                  />
                  {tag.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
