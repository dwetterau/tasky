"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Navigation } from "../../components/Navigation";
import { authClient } from "@/lib/auth-client";
import ReactMarkdown from "react-markdown";
import { useState, useRef, useEffect } from "react";

type Tag = { _id: Id<"tags">; name: string; color?: string };

function TagSelector({
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

function NoteCard({
  id,
  content,
  tags,
  allTags,
}: {
  id: Id<"notes">;
  content: string;
  tags: Tag[];
  allTags: Tag[];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(content);
  const [editTagIds, setEditTagIds] = useState<Id<"tags">[]>(tags.map((t) => t._id));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const remove = useMutation(api.notes.remove);
  const update = useMutation(api.notes.update);

  // Get the full tag objects for editing
  const editTags = editTagIds
    .map((id) => allTags.find((t) => t._id === id))
    .filter((t): t is Tag => t !== undefined);

  const startEditing = () => {
    setEditContent(content);
    setEditTagIds(tags.map((t) => t._id));
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditContent(content);
    setEditTagIds(tags.map((t) => t._id));
  };

  const saveChanges = async () => {
    await update({
      id,
      content: editContent,
      tagIds: editTagIds,
    });
    setIsEditing(false);
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current && isEditing) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [editContent, isEditing]);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditing]);

  if (isEditing) {
    return (
      <div className="bg-[var(--card-bg)] border border-[var(--accent)]/50 rounded-xl p-6 transition-all duration-200">
        <div className="mb-4">
          <label className="block text-xs font-medium text-[var(--muted)] mb-2">Tags</label>
          <TagSelector
            selectedTags={editTags}
            onTagsChange={setEditTagIds}
            allTags={allTags}
          />
        </div>
        <div className="mb-4">
          <label className="block text-xs font-medium text-[var(--muted)] mb-2">Content (Markdown)</label>
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full min-h-[120px] px-3 py-2 bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--accent)] transition-colors resize-none font-mono text-sm"
            placeholder="Write your note in markdown..."
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={cancelEditing}
            className="px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors rounded-lg hover:bg-[var(--card-border)]"
          >
            Cancel
          </button>
          <button
            onClick={() => void saveChanges()}
            className="px-4 py-2 text-sm bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg transition-colors font-medium"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6 transition-all duration-200 hover:border-[var(--accent)]/30">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex flex-wrap gap-2">
          {tags.length === 0 ? (
            <span className="text-xs text-[var(--muted)]">No tags</span>
          ) : (
            tags.map((tag) => (
              <span
                key={tag._id}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
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
        <div className="flex items-center gap-1">
          <button
            onClick={startEditing}
            className="opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-[var(--accent)] transition-all duration-200 p-1 rounded-lg hover:bg-[var(--accent)]/10 shrink-0"
            title="Edit note"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={() => remove({ id })}
            className="opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-red-400 transition-all duration-200 p-1 rounded-lg hover:bg-red-400/10 shrink-0"
            title="Delete note"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
      <div className="prose dark:prose-invert prose-sm max-w-none prose-headings:text-[var(--foreground)] prose-p:text-[var(--foreground)] prose-strong:text-[var(--foreground)] prose-a:text-[var(--accent)]">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </div>
  );
}

function SearchTagSelector({
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

function NotesList() {
  const [searchText, setSearchText] = useState("");
  const [selectedTagId, setSelectedTagId] = useState<Id<"tags"> | null>(null);
  const [debouncedSearchText, setDebouncedSearchText] = useState("");

  // Debounce search text to avoid too many queries
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const isSearching = debouncedSearchText.trim() !== "" || selectedTagId !== null;

  // Use search query when there are search criteria, otherwise use list
  const allNotes = useQuery(api.notes.list);
  const searchResults = useQuery(
    api.notes.search,
    isSearching
      ? {
          searchText: debouncedSearchText.trim() || undefined,
          tagId: selectedTagId ?? undefined,
        }
      : "skip"
  );

  const notes = isSearching ? searchResults : allNotes;
  const allTags = useQuery(api.tags.list) ?? [];

  // Convert tags to the expected format
  const allTagsFormatted: Tag[] = allTags.map((tag) => ({
    _id: tag._id,
    name: tag.name,
    color: tag.color,
  }));

  const selectedTag = selectedTagId
    ? allTagsFormatted.find((t) => t._id === selectedTagId) ?? null
    : null;

  const clearSearch = () => {
    setSearchText("");
    setSelectedTagId(null);
  };

  return (
    <>
      <Navigation />
      <div className="min-h-screen pt-24 pb-12 px-4">
        <div className="max-w-2xl mx-auto">
          {/* Search UI */}
          <div className="mb-6 space-y-3">
            <div className="flex gap-2">
              {/* Full-text search input */}
              <div className="flex-1 relative">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)]"
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
                  placeholder="Search notes..."
                  className="w-full h-[38px] pl-10 pr-3 bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--accent)] transition-colors text-sm"
                />
                {searchText && (
                  <button
                    onClick={() => setSearchText("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Tag filter */}
              <SearchTagSelector
                selectedTag={selectedTag}
                onTagChange={setSelectedTagId}
                allTags={allTagsFormatted}
              />
            </div>

            {/* Search status */}
            <div className="flex items-center justify-between">
              <p className="text-[var(--muted)] text-sm">
                {notes === undefined
                  ? "Loading..."
                  : isSearching
                  ? `${notes.length} result${notes.length === 1 ? "" : "s"}`
                  : notes.length === 0
                  ? "No notes yet"
                  : `${notes.length} note${notes.length === 1 ? "" : "s"}`}
              </p>
              {isSearching && (
                <button
                  onClick={clearSearch}
                  className="text-sm text-[var(--accent)] hover:underline"
                >
                  Clear search
                </button>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {notes === undefined ? (
              <div className="text-center py-8 text-[var(--muted)]">Loading...</div>
            ) : notes.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)] flex items-center justify-center">
                  <svg className="w-8 h-8 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                {isSearching ? (
                  <>
                    <p className="text-[var(--muted)] mb-2">No matching notes</p>
                    <p className="text-sm text-[var(--muted)]/60">
                      Try adjusting your search criteria
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[var(--muted)] mb-2">No notes yet</p>
                    <p className="text-sm text-[var(--muted)]/60">
                      Create a note from a capture using the note icon
                    </p>
                  </>
                )}
              </div>
            ) : (
              notes.map((note) => (
                <NoteCard
                  key={note._id}
                  id={note._id}
                  content={note.content}
                  tags={note.tags}
                  allTags={allTagsFormatted}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </>
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
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            Tasky
          </h1>
          <p className="text-[var(--muted)]">Your personal task manager</p>
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

export default function NotesPage() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return session ? <NotesList /> : <SignIn />;
}
