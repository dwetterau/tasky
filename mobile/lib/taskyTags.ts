import type { FunctionReturnType } from "convex/server";
import { taskyApi } from "./tasky";

export type TaskyTag = FunctionReturnType<typeof taskyApi.tags.list>[number];
export type TaskyTagId = TaskyTag["_id"];

export function taskyTagPath(
  tag: TaskyTag,
  tagsById: ReadonlyMap<string, TaskyTag>,
): string {
  const names = [tag.name];
  const seen = new Set<string>([String(tag._id)]);
  let parentId = tag.parentId;

  while (parentId !== null) {
    const key = String(parentId);
    if (seen.has(key)) break;
    seen.add(key);
    const parent = tagsById.get(key);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }

  return names.join(" › ");
}

export function sortTaskyTags(tags: TaskyTag[]): TaskyTag[] {
  const tagsById = new Map(tags.map((tag) => [String(tag._id), tag]));
  return [...tags].sort((left, right) =>
    taskyTagPath(left, tagsById).localeCompare(
      taskyTagPath(right, tagsById),
      undefined,
      { sensitivity: "base" },
    ),
  );
}
