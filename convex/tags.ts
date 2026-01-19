import { v } from "convex/values";
import { mutation, query, MutationCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id, Doc } from "./_generated/dataModel";

// Get all ancestor tags from a parent ID up to root (null)
async function getAncestors(
  ctx: MutationCtx,
  parentId: Id<"tags"> | null
): Promise<Doc<"tags">[]> {
  const ancestors: Doc<"tags">[] = [];
  let currentId = parentId;

  while (currentId) {
    const tag = await ctx.db.get(currentId);
    if (!tag) break;
    ancestors.push(tag);
    currentId = tag.parentId;
  }

  return ancestors;
}

// Add tag IDs to all ancestors' childrenRecursive arrays
async function addToAncestorsChildrenRecursive(
  ctx: MutationCtx,
  parentId: Id<"tags"> | null,
  tagIds: Id<"tags">[]
): Promise<void> {
  const ancestors = await getAncestors(ctx, parentId);

  for (const ancestor of ancestors) {
    const currentChildren = ancestor.childrenRecursive || [];
    const newChildren = [...new Set([...currentChildren, ...tagIds])];
    await ctx.db.patch(ancestor._id, { childrenRecursive: newChildren });
  }
}

// Remove tag IDs from all ancestors' childrenRecursive arrays
async function removeFromAncestorsChildrenRecursive(
  ctx: MutationCtx,
  parentId: Id<"tags"> | null,
  tagIds: Id<"tags">[]
): Promise<void> {
  const ancestors = await getAncestors(ctx, parentId);
  const tagIdSet = new Set(tagIds);

  for (const ancestor of ancestors) {
    const currentChildren = ancestor.childrenRecursive || [];
    const newChildren = currentChildren.filter((id) => !tagIdSet.has(id));
    await ctx.db.patch(ancestor._id, { childrenRecursive: newChildren });
  }
}

// List all tags for the current user
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const tags = await ctx.db
      .query("tags")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return tags;
  },
});

// Get tags organized as a tree structure (returns array of top-level tags)
export const getTree = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const tags = await ctx.db
      .query("tags")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    if (tags.length === 0) {
      return [];
    }

    // Build a map of tags by ID with children array
    type TagWithChildren = Doc<"tags"> & { children: TagWithChildren[] };
    const tagMap = new Map<Id<"tags">, TagWithChildren>(
      tags.map((tag) => [tag._id, { ...tag, children: [] }])
    );

    // Build tree and collect top-level tags
    const topLevel: TagWithChildren[] = [];
    for (const tag of tags) {
      const tagWithChildren = tagMap.get(tag._id)!;
      if (tag.parentId === null) {
        topLevel.push(tagWithChildren);
      } else {
        const parent = tagMap.get(tag.parentId);
        if (parent) {
          parent.children.push(tagWithChildren);
        }
      }
    }

    return topLevel;
  },
});

// Create a new tag
export const create = mutation({
  args: {
    name: v.string(),
    parentId: v.optional(v.id("tags")),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Check for duplicate tag name
    const existing = await ctx.db
      .query("tags")
      .withIndex("by_user_name", (q) => q.eq("userId", userId).eq("name", args.name))
      .first();
    if (existing) {
      throw new Error("A tag with this name already exists");
    }

    const parentId = args.parentId ?? null;

    // Verify parent belongs to user if specified
    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.userId !== userId) {
        throw new Error("Invalid parent tag");
      }
    }

    // Create the tag with empty childrenRecursive
    const tagId = await ctx.db.insert("tags", {
      userId,
      name: args.name,
      parentId,
      color: args.color,
      childrenRecursive: [],
    });

    // Add this tag to all ancestors' childrenRecursive
    await addToAncestorsChildrenRecursive(ctx, parentId, [tagId]);

    return tagId;
  },
});

// Update a tag
export const update = mutation({
  args: {
    id: v.id("tags"),
    name: v.optional(v.string()),
    parentId: v.optional(v.union(v.id("tags"), v.null())),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const tag = await ctx.db.get(args.id);
    if (!tag || tag.userId !== userId) {
      throw new Error("Tag not found");
    }

    // Check for duplicate tag name if name is changing
    if (args.name !== undefined && args.name !== tag.name) {
      const newName = args.name;
      const existing = await ctx.db
        .query("tags")
        .withIndex("by_user_name", (q) => q.eq("userId", userId).eq("name", newName))
        .first();
      if (existing) {
        throw new Error("A tag with this name already exists");
      }
    }

    const oldParentId = tag.parentId;
    const newParentId = args.parentId;

    // If changing parent, validate
    if (newParentId !== undefined) {
      if (newParentId !== null) {
        // Prevent circular references
        if (newParentId === args.id) {
          throw new Error("Tag cannot be its own parent");
        }

        // Check if new parent is a descendant
        let current = await ctx.db.get(newParentId);
        while (current && current.parentId) {
          if (current.parentId === args.id) {
            throw new Error("Cannot move tag to its own descendant");
          }
          current = await ctx.db.get(current.parentId);
        }

        const parent = await ctx.db.get(newParentId);
        if (!parent || parent.userId !== userId) {
          throw new Error("Invalid parent tag");
        }
      }

      // If parent is actually changing, update childrenRecursive for ancestors
      if (newParentId !== oldParentId) {
        // Get this tag and all its descendants
        const tagIdsToMove = [args.id, ...(tag.childrenRecursive || [])];

        // Remove from old ancestors
        await removeFromAncestorsChildrenRecursive(ctx, oldParentId, tagIdsToMove);

        // Add to new ancestors
        await addToAncestorsChildrenRecursive(ctx, newParentId, tagIdsToMove);
      }
    }

    const updates: Partial<Doc<"tags">> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (newParentId !== undefined) updates.parentId = newParentId;
    if (args.color !== undefined) updates.color = args.color;

    await ctx.db.patch(args.id, updates);
    return args.id;
  },
});

// Delete a tag and reparent children to the deleted tag's parent
export const remove = mutation({
  args: {
    id: v.id("tags"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const tag = await ctx.db.get(args.id);
    if (!tag || tag.userId !== userId) {
      throw new Error("Tag not found");
    }

    // Remove only this tag from ancestors' childrenRecursive
    // (descendants stay because they're being reparented to this tag's parent)
    await removeFromAncestorsChildrenRecursive(ctx, tag.parentId, [args.id]);

    // Get direct children
    const children = await ctx.db
      .query("tags")
      .withIndex("by_parent", (q) => q.eq("userId", userId).eq("parentId", args.id))
      .collect();

    // Reparent children to deleted tag's parent
    const newParentId = tag.parentId;
    for (const child of children) {
      await ctx.db.patch(child._id, { parentId: newParentId });
    }

    await ctx.db.delete(args.id);
    return args.id;
  },
});

// Get current user (for nav display)
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    const user = await ctx.db.get(userId);
    return user;
  },
});
