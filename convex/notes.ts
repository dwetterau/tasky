import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "./auth";
import { Id } from "./_generated/dataModel";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();

    // Fetch tags for each note
    const notesWithTags = await Promise.all(
      notes.map(async (note) => {
        const tags = await Promise.all(
          note.tagIds.map((tagId) => ctx.db.get(tagId))
        );
        return {
          ...note,
          tags: tags.filter((t) => t !== null),
        };
      })
    );

    return notesWithTags;
  },
});

export const create = mutation({
  args: {
    content: v.string(),
    tagIds: v.optional(v.array(v.id("tags"))),
    createdFromCaptureId: v.optional(v.id("captures")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    return await ctx.db.insert("notes", {
      userId,
      content: args.content,
      tagIds: args.tagIds ?? [],
      createdFromCaptureId: args.createdFromCaptureId,
    });
  },
});

export const createFromCapture = mutation({
  args: {
    captureId: v.id("captures"),
    tagIds: v.optional(v.array(v.id("tags"))),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const capture = await ctx.db.get(args.captureId);
    if (!capture || capture.userId !== userId) {
      throw new Error("Capture not found or access denied");
    }

    // Create a note with the capture text as initial content
    const noteId = await ctx.db.insert("notes", {
      userId,
      content: capture.text,
      tagIds: args.tagIds ?? [],
      createdFromCaptureId: args.captureId,
    });

    // Delete the capture after converting to note
    await ctx.db.delete(args.captureId);

    return noteId;
  },
});

export const update = mutation({
  args: {
    id: v.id("notes"),
    content: v.optional(v.string()),
    tagIds: v.optional(v.array(v.id("tags"))),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const note = await ctx.db.get(args.id);
    if (!note || note.userId !== userId) {
      throw new Error("Note not found or access denied");
    }

    const updates: { content?: string; tagIds?: typeof args.tagIds } = {};
    if (args.content !== undefined) updates.content = args.content;
    if (args.tagIds !== undefined) updates.tagIds = args.tagIds;

    await ctx.db.patch(args.id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id("notes") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const note = await ctx.db.get(args.id);
    if (!note || note.userId !== userId) {
      throw new Error("Note not found or access denied");
    }
    await ctx.db.delete(args.id);
  },
});

// Search notes by full-text search and/or tag filtering (with recursive child tags)
export const search = query({
  args: {
    searchText: v.optional(v.string()),
    tagId: v.optional(v.id("tags")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    // If no search criteria, return empty (use list() for all notes)
    if (!args.searchText && !args.tagId) {
      return [];
    }

    let notes;

    if (args.searchText && args.searchText.trim()) {
      // Full-text search using Convex search index
      notes = await ctx.db
        .query("notes")
        .withSearchIndex("search_content", (q) =>
          q.search("content", args.searchText!).eq("userId", userId)
        )
        .collect();
    } else {
      // No text search, get all user's notes for tag filtering
      notes = await ctx.db
        .query("notes")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
    }

    // If tag filtering is requested, filter by tag and all its recursive children
    if (args.tagId) {
      const tag = await ctx.db.get(args.tagId);
      if (!tag || tag.userId !== userId) {
        return [];
      }

      // Get all tag IDs to match: the selected tag + all its recursive children
      const matchingTagIds = new Set<Id<"tags">>([args.tagId]);
      if (tag.childrenRecursive) {
        for (const childId of tag.childrenRecursive) {
          matchingTagIds.add(childId);
        }
      }

      // Filter notes that have at least one matching tag
      notes = notes.filter((note) =>
        note.tagIds.some((tagId) => matchingTagIds.has(tagId))
      );
    }

    // Fetch tags for each note
    const notesWithTags = await Promise.all(
      notes.map(async (note) => {
        const tags = await Promise.all(
          note.tagIds.map((tagId) => ctx.db.get(tagId))
        );
        return {
          ...note,
          tags: tags.filter((t) => t !== null),
        };
      })
    );

    return notesWithTags;
  },
});
