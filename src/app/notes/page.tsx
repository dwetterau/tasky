"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Navigation } from "../../components/Navigation";
import { TagSelector, SearchTagSelector, Tag } from "../../components/TagSelector";
import { useAuthSession } from "@/lib/useAuthSession";
import { SignIn } from "@/components/SignIn";
import ReactMarkdown from "react-markdown";
import { useState, useRef, useEffect, useMemo } from "react";
import { useSelectedTag } from "@/lib/useSelectedTag";

function CreateNoteModal({
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const create = useMutation(api.notes.create);

  // Reset form when modal opens with new initialTagId
  useEffect(() => {
    if (isOpen) {
      setContent("");
      setTagIds(initialTagId ? [initialTagId] : []);
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
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
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
          <h3 className="text-lg font-semibold">Create Note</h3>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-(--muted) mb-1">Tags</label>
            <TagSelector
              selectedTags={selectedTags}
              onTagsChange={setTagIds}
              allTags={allTags}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-(--muted) mb-1">Content (Markdown)</label>
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full min-h-[150px] px-3 py-2 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors resize-none font-mono text-sm"
              placeholder="Write your note in markdown..."
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
              {isSubmitting ? "Creating..." : "Create Note"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type FullTag = NonNullable<ReturnType<typeof useQuery<typeof api.tags.list>>>[number];

function NoteCard({
  id,
  content,
  tags,
  allTags,
}: {
  id: Id<"notes">;
  content: string;
  tags: FullTag[];
  allTags: FullTag[];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(content);
  const [editTagIds, setEditTagIds] = useState<Id<"tags">[]>(tags.map((t) => t._id));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const remove = useMutation(api.notes.remove).withOptimisticUpdate(
    (localStore, args) => {
      // Update list query
      const notes = localStore.getQuery(api.notes.list, {});
      if (notes !== undefined) {
        localStore.setQuery(
          api.notes.list,
          {},
          notes.filter((n) => n._id !== args.id)
        );
      }
    }
  );

  const update = useMutation(api.notes.update).withOptimisticUpdate(
    (localStore, args) => {
      // Update list query
      const notes = localStore.getQuery(api.notes.list, {});
      if (notes !== undefined) {
        localStore.setQuery(
          api.notes.list,
          {},
          notes.map((n) => {
            if (n._id !== args.id) return n;
            return {
              ...n,
              content: args.content ?? n.content,
              tagIds: args.tagIds ?? n.tagIds,
              // Update tags if tagIds changed
              tags: args.tagIds
                ? args.tagIds
                    .map((tagId) => allTags.find((tag) => tag._id === tagId))
                    .filter((tag): tag is FullTag => tag !== undefined)
                : n.tags,
            };
          })
        );
      }
    }
  );

  // Get the full tag objects for editing
  const editTags = editTagIds
    .map((id) => allTags.find((t) => t._id === id))
    .filter((t): t is FullTag => t !== undefined);

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
      <div className="bg-(--card-bg) border border-(--accent)/50 rounded-xl p-6 transition-all duration-200">
        <div className="mb-4">
          <label className="block text-xs font-medium text-(--muted) mb-2">Tags</label>
          <TagSelector
            selectedTags={editTags}
            onTagsChange={setEditTagIds}
            allTags={allTags}
          />
        </div>
        <div className="mb-4">
          <label className="block text-xs font-medium text-(--muted) mb-2">Content (Markdown)</label>
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full min-h-[120px] px-3 py-2 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors resize-none font-mono text-sm"
            placeholder="Write your note in markdown..."
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={cancelEditing}
            className="px-4 py-2 text-sm text-(--muted) hover:text-foreground transition-colors rounded-lg hover:bg-(--card-border)"
          >
            Cancel
          </button>
          <button
            onClick={() => void saveChanges()}
            className="px-4 py-2 text-sm bg-accent hover:bg-(--accent-hover) text-white rounded-lg transition-colors font-medium"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group bg-(--card-bg) border border-(--card-border) rounded-xl p-6 transition-all duration-200 hover:border-(--accent)/30">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex flex-wrap gap-2">
          {tags.length === 0 ? (
            <span className="text-xs text-(--muted)">No tags</span>
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
            className="opacity-0 group-hover:opacity-100 text-(--muted) hover:text-accent transition-all duration-200 p-1 rounded-lg hover:bg-(--accent)/10 shrink-0"
            title="Edit note"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={() => remove({ id })}
            className="opacity-0 group-hover:opacity-100 text-(--muted) hover:text-red-400 transition-all duration-200 p-1 rounded-lg hover:bg-red-400/10 shrink-0"
            title="Delete note"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
      <div className="prose dark:prose-invert prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-a:text-accent">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </div>
  );
}

function NotesList() {
  const [searchText, setSearchText] = useState("");
  const [debouncedSearchText, setDebouncedSearchText] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);

  const tagsQuery = useQuery(api.tags.list);
  const allTags = useMemo(() => tagsQuery ?? [], [tagsQuery]);

  // Convert tags to the expected format
  const allTagsFormatted: Tag[] = allTags.map((tag) => ({
    _id: tag._id,
    name: tag.name,
    color: tag.color,
  }));

  // Use the shared tag selection hook
  const validTagIds = useMemo(() => allTags.map(t => t._id), [allTags]);
  const { selectedTagId, handleTagChange } = useSelectedTag(tagsQuery !== undefined ? validTagIds : undefined);

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

  const selectedTag = selectedTagId
    ? allTagsFormatted.find((t) => t._id === selectedTagId) ?? null
    : null;

  const clearSearch = () => {
    setSearchText("");
    handleTagChange(null);
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
                  placeholder="Search notes..."
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

              {/* Tag filter */}
              <SearchTagSelector
                selectedTag={selectedTag}
                onTagChange={handleTagChange}
                allTags={allTagsFormatted}
              />

              <button
                onClick={() => setShowCreateModal(true)}
                className="h-[38px] px-4 bg-accent hover:bg-(--accent-hover) text-white rounded-lg transition-colors font-medium text-sm flex items-center gap-2 shrink-0"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create Note
              </button>
            </div>

            {/* Search status */}
            <div className="flex items-center justify-between">
              <p className="text-(--muted) text-sm">
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
                  className="text-sm text-accent hover:underline"
                >
                  Clear search
                </button>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {notes === undefined ? (
              <div className="text-center py-8 text-(--muted)">Loading...</div>
            ) : notes.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-(--card-bg) border border-(--card-border) flex items-center justify-center">
                  <svg className="w-8 h-8 text-(--muted)" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                {isSearching ? (
                  <>
                    <p className="text-(--muted) mb-2">No matching notes</p>
                    <p className="text-sm text-(--muted)/60">
                      Try adjusting your search criteria
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-(--muted) mb-2">No notes yet</p>
                    <p className="text-sm text-(--muted)/60">
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
                  allTags={allTags}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <CreateNoteModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        allTags={allTagsFormatted}
        initialTagId={selectedTagId}
      />
    </>
  );
}

export default function NotesPage() {
  const { session, isPending } = useAuthSession();

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return session ? <NotesList /> : <SignIn />;
}
