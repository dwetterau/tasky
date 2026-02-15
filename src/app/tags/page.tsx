"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useTrackedMutation } from "@/lib/useTrackedMutation";
import { useState, useEffect } from "react";
import { Id } from "../../../convex/_generated/dataModel";
import { Navigation } from "../../components/Navigation";
import { ConfirmModal } from "../../components/ConfirmModal";
import { useAuthSession } from "@/lib/useAuthSession";
import { SignIn } from "@/components/SignIn";

// Color palette for tags
const TAG_COLORS = [
  { name: "Gray", value: "#6b7280" },
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Yellow", value: "#eab308" },
  { name: "Lime", value: "#84cc16" },
  { name: "Green", value: "#22c55e" },
  { name: "Emerald", value: "#10b981" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "Sky", value: "#0ea5e9" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Indigo", value: "#6366f1" },
  { name: "Violet", value: "#8b5cf6" },
  { name: "Purple", value: "#a855f7" },
  { name: "Fuchsia", value: "#d946ef" },
  { name: "Pink", value: "#ec4899" },
  { name: "Rose", value: "#f43f5e" },
];

interface TagNode {
  _id: Id<"tags">;
  name: string;
  parentId: Id<"tags"> | null;
  color?: string;
  children: TagNode[];
}

function TagTreeItem({
  tag,
  level,
  allTags,
  onEdit,
  onDelete,
  onAddChild,
}: {
  tag: TagNode;
  level: number;
  allTags: TagNode[];
  onEdit: (tag: TagNode) => void;
  onDelete: (tag: TagNode) => void;
  onAddChild: (parentId: Id<"tags">) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = tag.children.length > 0;

  return (
    <div className="select-none">
      <div
        className="group flex items-center gap-2 py-2 px-3 rounded-lg transition-colors hover:bg-(--card-border)"
        style={{ paddingLeft: `${level * 24 + 12}px` }}
      >
        {/* Expand/Collapse Button */}
        <button
          onClick={() => setExpanded(!expanded)}
          className={`w-5 h-5 flex items-center justify-center text-(--muted) transition-transform ${
            hasChildren ? "" : "invisible"
          } ${expanded ? "rotate-90" : ""}`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Color Dot */}
        <div
          className="w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: tag.color || "#6b7280" }}
        />

        {/* Tag Name */}
        <span className="flex-1">{tag.name}</span>

        {/* Actions */}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
          <button
            onClick={() => onAddChild(tag._id)}
            className="p-1.5 text-(--muted) hover:text-accent transition-colors rounded"
            title="Add child tag"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={() => onEdit(tag)}
            className="p-1.5 text-(--muted) hover:text-foreground transition-colors rounded"
            title="Edit tag"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={() => onDelete(tag)}
            className="p-1.5 text-(--muted) hover:text-red-400 transition-colors rounded"
            title="Delete tag"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {tag.children.map((child) => (
            <TagTreeItem
              key={child._id}
              tag={child}
              level={level + 1}
              allTags={allTags}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TagModal({
  isOpen,
  onClose,
  tag,
  parentId,
  allTags,
}: {
  isOpen: boolean;
  onClose: () => void;
  tag?: TagNode;
  parentId?: Id<"tags"> | null;
  allTags: TagNode[];
}) {
  const createTag = useTrackedMutation(api.tags.create);
  const updateTag = useTrackedMutation(api.tags.update);
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_COLORS[0].value);
  const [selectedParentId, setSelectedParentId] = useState<Id<"tags"> | null | undefined>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!tag;

  // Reset form state when modal opens or props change
  useEffect(() => {
    if (isOpen) {
      setName(tag?.name || "");
      setColor(tag?.color || TAG_COLORS[0].value);
      setSelectedParentId(tag?.parentId ?? parentId ?? null);
      setError(null);
    }
  }, [isOpen, tag, parentId]);

  // Flatten tags for parent selector
  const flattenTags = (tags: TagNode[], excludeId?: Id<"tags">): { id: Id<"tags">; name: string; level: number }[] => {
    const result: { id: Id<"tags">; name: string; level: number }[] = [];
    const flatten = (tag: TagNode, level: number) => {
      if (tag._id !== excludeId) {
        result.push({ id: tag._id, name: tag.name, level });
        tag.children.forEach((child) => flatten(child, level + 1));
      }
    };
    tags.forEach((t) => flatten(t, 0));
    return result;
  };

  const parentOptions = flattenTags(allTags, tag?._id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      if (isEditing) {
        await updateTag({
          id: tag._id,
          name: name.trim(),
          color,
          parentId: selectedParentId,
        });
      } else {
        await createTag({
          name: name.trim(),
          color,
          parentId: selectedParentId ?? undefined,
        });
      }
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save tag";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-(--card-bg) border border-(--card-border) rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-xl font-semibold mb-4">
          {isEditing ? "Edit Tag" : "Create Tag"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name Input */}
          <div>
            <label className="block text-sm font-medium text-(--muted) mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter tag name..."
              className="w-full bg-background border border-(--card-border) rounded-xl px-4 py-2.5 focus:outline-none focus:border-accent transition-colors placeholder:text-(--muted)"
              autoFocus
            />
          </div>

          {/* Parent Selector */}
          <div>
            <label className="block text-sm font-medium text-(--muted) mb-1.5">
              Parent Tag
            </label>
            <select
              value={selectedParentId ?? ""}
              onChange={(e) => setSelectedParentId(e.target.value ? e.target.value as Id<"tags"> : null)}
              className="w-full bg-background border border-(--card-border) rounded-xl px-4 py-2.5 focus:outline-none focus:border-accent transition-colors"
            >
              <option value="">None</option>
              {parentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {"—".repeat(option.level + 1)} {option.name}
                </option>
              ))}
            </select>
          </div>

          {/* Color Picker */}
          <div>
            <label className="block text-sm font-medium text-(--muted) mb-1.5">
              Color
            </label>
            <div className="flex flex-wrap gap-2">
              {TAG_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  className={`w-7 h-7 rounded-full transition-transform hover:scale-110 ${
                    color === c.value ? "ring-2 ring-offset-2 ring-accent ring-offset-(--card-bg)" : ""
                  }`}
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                />
              ))}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="text-red-500 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-(--muted) hover:text-foreground transition-colors rounded-lg hover:bg-(--card-border)"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="px-4 py-2 bg-accent hover:bg-(--accent-hover) text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Saving..." : isEditing ? "Save Changes" : "Create Tag"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


function TagManager() {
  const tree = useQuery(api.tags.getTree);
  const removeTag = useTrackedMutation(api.tags.remove);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<TagNode | undefined>();
  const [parentIdForNew, setParentIdForNew] = useState<Id<"tags"> | null | undefined>();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [tagToDelete, setTagToDelete] = useState<TagNode | undefined>();

  const handleAddTopLevel = () => {
    setEditingTag(undefined);
    setParentIdForNew(null);
    setModalOpen(true);
  };

  const handleAddChild = (parentId: Id<"tags">) => {
    setEditingTag(undefined);
    setParentIdForNew(parentId);
    setModalOpen(true);
  };

  const handleEdit = (tag: TagNode) => {
    setEditingTag(tag);
    setParentIdForNew(undefined);
    setModalOpen(true);
  };

  const handleDelete = (tag: TagNode) => {
    setTagToDelete(tag);
    setDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (tagToDelete) {
      await removeTag({ id: tagToDelete._id });
      setDeleteModalOpen(false);
      setTagToDelete(undefined);
    }
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingTag(undefined);
    setParentIdForNew(undefined);
  };

  const hasTags = tree && tree.length > 0;

  return (
    <>
      <Navigation />
      <div className="min-h-screen pt-24 pb-12 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold">Tag Manager</h1>
              <p className="text-(--muted) text-sm mt-1">
                Organize your tags in a hierarchical structure
              </p>
            </div>
            <button
              onClick={handleAddTopLevel}
              className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-(--accent-hover) text-white rounded-xl font-medium transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Tag
            </button>
          </div>

          <div className="bg-(--card-bg) border border-(--card-border) rounded-2xl overflow-hidden">
            {tree === undefined ? (
              <div className="p-8 text-center text-(--muted)">Loading...</div>
            ) : !hasTags ? (
              <div className="p-8 text-center">
                <p className="text-(--muted) mb-4">No tags yet</p>
                <button
                  onClick={handleAddTopLevel}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-accent hover:bg-(--accent-hover) text-white rounded-xl font-medium transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create Your First Tag
                </button>
              </div>
            ) : (
              <div className="p-2">
                {tree.map((tag) => (
                  <TagTreeItem
                    key={tag._id}
                    tag={tag}
                    level={0}
                    allTags={tree}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onAddChild={handleAddChild}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Help text */}
          <div className="mt-6 text-sm text-(--muted)">
            <p className="mb-2">
              <strong>Tip:</strong> Tags are organized hierarchically. Create top-level tags like &quot;Work&quot; or &quot;Personal&quot;, 
              then add project-specific tags as children.
            </p>
          </div>
        </div>
      </div>

      <TagModal
        isOpen={modalOpen}
        onClose={handleCloseModal}
        tag={editingTag}
        parentId={parentIdForNew}
        allTags={tree || []}
      />

      <ConfirmModal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setTagToDelete(undefined);
        }}
        onConfirm={confirmDelete}
        title="Delete Tag"
        message={`Are you sure you want to delete "${tagToDelete?.name || ""}"?`}
        warning={(tagToDelete?.children.length || 0) > 0 ? "This tag has children. They will be moved to this tag's parent." : undefined}
        confirmLabel="Delete"
      />
    </>
  );
}

export default function TagsPage() {
  const { session, isPending } = useAuthSession();

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return session ? <TagManager /> : <SignIn />;
}
