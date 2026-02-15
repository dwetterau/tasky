"use client";

import { useState, useEffect } from "react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { useTrackedMutation } from "@/lib/useTrackedMutation";
import { TagSelector, Tag } from "../../components/TagSelector";
import { MarkdownEditor } from "../../components/MarkdownEditor";

export function NoteModal({
  isOpen,
  onClose,
  allTags,
  initialTagId,
  initialContent,
  createdFromCaptureId,
}: {
  isOpen: boolean;
  onClose: () => void;
  allTags: Tag[];
  initialTagId: Id<"tags"> | null;
  /** Pre-fill content when creating a new note (e.g. from a capture) */
  initialContent?: string;
  /** When set, the source capture will be deleted after note creation */
  createdFromCaptureId?: Id<"captures">;
}) {
  const [content, setContent] = useState("");
  const [tagIds, setTagIds] = useState<Id<"tags">[]>(initialTagId ? [initialTagId] : []);

  const create = useTrackedMutation(api.notes.create).withOptimisticUpdate(
    (localStore, args) => {
      const notes = localStore.getQuery(api.notes.list, {});
      if (notes !== undefined) {
        const allTagsFull = localStore.getQuery(api.tags.list, {});
        const selectedTagsFull = (args.tagIds ?? [])
          .map((tagId) => allTagsFull?.find((t) => t._id === tagId))
          .filter((t): t is NonNullable<typeof t> => t !== undefined);

        const tempNote = {
          _id: crypto.randomUUID() as Id<"notes">,
          _creationTime: Number.MAX_SAFE_INTEGER,
          userId: "",
          content: args.content,
          tagIds: args.tagIds ?? [],
          tags: selectedTagsFull,
        };
        localStore.setQuery(api.notes.list, {}, [tempNote, ...notes]);
      }

      // If created from a capture, optimistically remove it from capture lists
      if (args.createdFromCaptureId) {
        for (const includeCompleted of [true, false]) {
          const captures = localStore.getQuery(api.captures.list, { includeCompleted });
          if (captures !== undefined) {
            localStore.setQuery(
              api.captures.list,
              { includeCompleted },
              captures.filter((c) => c._id !== args.createdFromCaptureId)
            );
          }
        }
      }
    }
  );

  // Reset form when modal opens with new initialTagId
  useEffect(() => {
    if (isOpen) {
      setContent(initialContent ?? "");
      setTagIds(initialTagId ? [initialTagId] : []);
    }
  }, [isOpen, initialTagId, initialContent]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  const selectedTags = tagIds
    .map((id) => allTags.find((t) => t._id === id))
    .filter((t): t is Tag => t !== undefined);

  const handleSubmit = () => {
    if (!content.trim()) return;
    create({
      content: content.trim(),
      tagIds: tagIds.length > 0 ? tagIds : undefined,
      createdFromCaptureId,
    });
    onClose();
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
            <label className="block text-xs font-medium text-(--muted) mb-1">Content</label>
            <MarkdownEditor
              value={content}
              onChange={setContent}
              onSubmit={handleSubmit}
              placeholder="Write your note in markdown..."
              minHeight="150px"
              autoFocus
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
              onClick={handleSubmit}
              disabled={!content.trim()}
              className="px-4 py-2 text-sm bg-accent hover:bg-(--accent-hover) text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create Note
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
