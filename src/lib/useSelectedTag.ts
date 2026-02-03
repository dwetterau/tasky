"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo } from "react";
import { Id } from "../../convex/_generated/dataModel";

const SELECTED_TAG_KEY = "tasky_selected_tag";

/**
 * Get the stored tag ID from sessionStorage.
 * This can be called from any component (like Navigation).
 */
export function getStoredTagId(): Id<"tags"> | null {
  if (typeof window === "undefined") return null;
  const stored = sessionStorage.getItem(SELECTED_TAG_KEY);
  return stored as Id<"tags"> | null;
}

/**
 * Store the tag ID in sessionStorage.
 */
export function setStoredTagId(tagId: Id<"tags"> | null): void {
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
 * 
 * @param validTagIds - Array of valid tag IDs to validate against
 * @returns selectedTagId and handleTagChange function
 */
export function useSelectedTag(validTagIds: Id<"tags">[] | undefined) {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Derive selected tag from URL, falling back to sessionStorage
  const selectedTagId = useMemo(() => {
    const tagParam = searchParams.get("tag");
    
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
      if (storedTag && validTagIds.includes(storedTag)) {
        return storedTag;
      }
    }
    
    return null;
  }, [searchParams, validTagIds]);

  // Sync URL with stored tag on mount if URL is missing the tag
  useEffect(() => {
    if (validTagIds === undefined) return;
    
    const urlTag = searchParams.get("tag");
    const storedTag = getStoredTagId();
    
    // If URL doesn't have a tag but we have a stored one, update URL
    if (!urlTag && storedTag && validTagIds.includes(storedTag)) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tag", storedTag);
      router.replace(`?${params.toString()}`);
    }
  }, [validTagIds, searchParams, router]);

  // Keep sessionStorage in sync with the selected tag (e.g., if user arrives with URL tag)
  useEffect(() => {
    if (selectedTagId !== null) {
      setStoredTagId(selectedTagId);
    }
  }, [selectedTagId]);

  // Update URL and sessionStorage when tag changes
  const handleTagChange = useCallback((tagId: Id<"tags"> | null) => {
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

  return { selectedTagId, handleTagChange };
}
