"use client";

import { useQuery } from "convex/react";
import { useCallback, useMemo } from "react";
import { api } from "../../convex/_generated/api";
import { Tag, TagFilterValue } from "@/components/TagSelector";
import { NO_TAG_FILTER, useSelectedTag } from "@/lib/useSelectedTag";

type UsePageTagFilterOptions = {
  allowNoTag?: boolean;
};

export function usePageTagFilter(options?: UsePageTagFilterOptions) {
  const { allowNoTag = false } = options ?? {};
  const tagsQuery = useQuery(api.tags.list);
  const allTagsRaw = useMemo(() => tagsQuery ?? [], [tagsQuery]);
  const allTags = useMemo<Tag[]>(() => {
    return allTagsRaw.map((tag) => ({
      _id: tag._id,
      name: tag.name,
      color: tag.color,
    }));
  }, [allTagsRaw]);

  const validTagIds = useMemo(() => allTags.map((tag) => tag._id), [allTags]);
  const { selectedTagId, selectedNoTag, handleTagChange: handleSharedTagChange } =
    useSelectedTag(tagsQuery !== undefined ? validTagIds : undefined);

  const handleTagChange = useCallback(
    (tagId: TagFilterValue) => {
      if (!allowNoTag && tagId === NO_TAG_FILTER) {
        handleSharedTagChange(null);
        return;
      }
      handleSharedTagChange(tagId);
    },
    [allowNoTag, handleSharedTagChange]
  );

  const selectedTag = useMemo(
    () => allTags.find((tag) => tag._id === selectedTagId) ?? null,
    [allTags, selectedTagId]
  );

  return {
    allTagsRaw,
    allTags,
    selectedTag,
    selectedTagId,
    selectedNoTag: allowNoTag ? selectedNoTag : false,
    handleTagChange,
  };
}
