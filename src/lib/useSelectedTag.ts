"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo } from "react";
import { Id } from "../../convex/_generated/dataModel";

const SELECTED_TAG_KEY = "tasky_selected_tag";

// Special constant for "no tag" filter - matches the one in TagSelector
export const NO_TAG_FILTER = "__no_tag__" as const;
export type TagFilterValue = Id<"tags"> | typeof NO_TAG_FILTER | null;

/**
 * Get the stored tag filter value from sessionStorage.
 * This can be called from any component (like Navigation).
 */
export function getStoredTagId(): TagFilterValue {
  if (typeof window === "undefined") return null;
  const stored = sessionStorage.getItem(SELECTED_TAG_KEY);
  if (stored === NO_TAG_FILTER) return NO_TAG_FILTER;
  return stored as Id<"tags"> | null;
}

/**
 * Store the tag filter value in sessionStorage.
 */
export function setStoredTagId(tagId: TagFilterValue): void {
  if (typeof window === "undefined") return;
  if (tagId) {
    sessionStorage.setItem(SELECTED_TAG_KEY, tagId);
  } else {
    sessionStorage.removeItem(SELECTED_TAG_KEY);
  }
}

/**
 * Hook to manage selected tag state that persists across navigation.
 * - Reads from URL first, falls back to sessionStorage
 * - Syncs changes to both URL and sessionStorage
 * - Supports special NO_TAG_FILTER value for filtering untagged items
 * 
 * @param validTagIds - Array of valid tag IDs to validate against
 * @returns selectedTagId (or null), selectedNoTag boolean, and handleTagChange function
 */
export function useSelectedTag(validTagIds: Id<"tags">[] | undefined) {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Derive selected tag from URL, falling back to sessionStorage
  const tagFilterValue = useMemo((): TagFilterValue => {
    const tagParam = searchParams.get("tag");
    
    // Check for "no tag" filter
    if (tagParam === NO_TAG_FILTER) {
      return NO_TAG_FILTER;
    }
    
    // If URL has a tag, validate and use it
    if (tagParam && validTagIds !== undefined) {
      const isValid = validTagIds.includes(tagParam as Id<"tags">);
      if (isValid) {
        return tagParam as Id<"tags">;
      }
    }
    
    // If no URL tag, check sessionStorage
    if (validTagIds !== undefined) {
      const storedTag = getStoredTagId();
      if (storedTag === NO_TAG_FILTER) {
        return NO_TAG_FILTER;
      }
      if (storedTag && validTagIds.includes(storedTag as Id<"tags">)) {
        return storedTag;
      }
    }
    
    return null;
  }, [searchParams, validTagIds]);

  // Derived values for convenience
  const selectedTagId = tagFilterValue !== null && tagFilterValue !== NO_TAG_FILTER 
    ? tagFilterValue as Id<"tags"> 
    : null;
  const selectedNoTag = tagFilterValue === NO_TAG_FILTER;

  // Sync URL with stored tag on mount if URL is missing the tag
  useEffect(() => {
    if (validTagIds === undefined) return;
    
    const urlTag = searchParams.get("tag");
    const storedTag = getStoredTagId();
    
    // If URL doesn't have a tag but we have a stored one, update URL
    if (!urlTag && storedTag) {
      const isValidStoredTag = storedTag === NO_TAG_FILTER || validTagIds.includes(storedTag as Id<"tags">);
      if (isValidStoredTag) {
        const params = new URLSearchParams(searchParams.toString());
        params.set("tag", storedTag);
        router.replace(`?${params.toString()}`);
      }
    }
  }, [validTagIds, searchParams, router]);

  // Keep sessionStorage in sync with the selected tag (e.g., if user arrives with URL tag)
  useEffect(() => {
    if (tagFilterValue !== null) {
      setStoredTagId(tagFilterValue);
    }
  }, [tagFilterValue]);

  // Update URL and sessionStorage when tag changes
  const handleTagChange = useCallback((tagId: TagFilterValue) => {
    // Update sessionStorage
    setStoredTagId(tagId);
    
    // Update URL
    const params = new URLSearchParams(searchParams.toString());
    if (tagId) {
      params.set("tag", tagId);
    } else {
      params.delete("tag");
    }
    
    const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
    router.replace(newUrl);
  }, [searchParams, router]);

  return { selectedTagId, selectedNoTag, handleTagChange };
}
