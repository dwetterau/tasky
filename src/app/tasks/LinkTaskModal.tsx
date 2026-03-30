"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import {
  type TaskStatus,
  type TaskPriority,
  type TaskListArgs,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  createTaskListArgs,
} from "./constants";

type HydratedTask = {
  _id: Id<"tasks">;
  content: string;
  status: string;
  priority: string;
  tags: Array<{ _id: Id<"tags">; name: string; color?: string }>;
  agents: Array<{ _id: Id<"agents">; externalId: string }>;
};

export function LinkTaskModal({
  isOpen,
  onClose,
  onSelect,
  tagId,
  noTag,
  excludeTaskIds,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (taskId: Id<"tasks">) => void;
  tagId?: Id<"tags"> | null;
  noTag?: boolean;
  excludeTaskIds?: Set<string>;
}) {
  const [searchText, setSearchText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const mouseDownTargetRef = useRef<EventTarget | null>(null);

  const hasFilters = Boolean(tagId) || Boolean(noTag);
  const [listArgs] = useState<TaskListArgs>(() => createTaskListArgs());
  const searchArgs = useMemo(() => {
    if (searchText.trim() || tagId || noTag) {
      return {
        searchText: searchText.trim() || undefined,
        tagId: tagId ?? undefined,
        noTag: noTag || undefined,
      };
    }
    return null;
  }, [searchText, tagId, noTag]);

  const allTasks = useQuery(api.tasks.list, hasFilters ? "skip" : listArgs);
  const searchResults = useQuery(
    api.tasks.search,
    searchArgs ?? "skip"
  );

  const tasks = useMemo((): HydratedTask[] => {
    const raw = searchArgs ? searchResults : allTasks;
    if (!raw) return [];
    return (raw as HydratedTask[]).filter(
      (t) => t.status !== "closed" && !excludeTaskIds?.has(t._id)
    );
  }, [allTasks, searchResults, searchArgs, excludeTaskIds]);

  const handleClose = useCallback(() => {
    setSearchText("");
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen]);

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) handleClose();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  const isLoading = searchArgs ? searchResults === undefined : allTasks === undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] p-4"
      onMouseDown={(e) => { mouseDownTargetRef.current = e.target; }}
      onClick={(e) => { if (e.target === mouseDownTargetRef.current) handleClose(); }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-(--card-bg) border border-(--card-border) rounded-2xl max-w-lg w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-3">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-(--accent)/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold">Link to Existing Task</h3>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search tasks..."
            className="w-full h-[38px] px-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-2 min-h-[200px]">
          {isLoading ? (
            <div className="text-center py-8 text-(--muted) text-sm">Loading tasks...</div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-8 text-(--muted) text-sm">
              {searchText.trim() ? "No matching tasks found." : "No open tasks."}
            </div>
          ) : (
            <div className="space-y-1.5">
              {tasks.map((task) => {
                const statusCfg = STATUS_CONFIG[task.status as TaskStatus];
                const priorityCfg = PRIORITY_CONFIG[task.priority as TaskPriority];
                return (
                  <button
                    key={task._id}
                    type="button"
                    onClick={() => {
                      onSelect(task._id);
                      handleClose();
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-lg border border-(--card-border) hover:border-accent/30 bg-background hover:bg-(--card-bg) transition-colors group"
                  >
                    <p className="text-sm line-clamp-2 mb-1.5">
                      {task.content || <span className="text-(--muted) italic">No content</span>}
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {statusCfg && (
                        <span
                          className="px-1.5 py-0.5 rounded text-[11px] font-medium"
                          style={{
                            backgroundColor: `${statusCfg.color}20`,
                            color: statusCfg.color,
                          }}
                        >
                          {statusCfg.label}
                        </span>
                      )}
                      {priorityCfg && (
                        <span
                          className="px-1.5 py-0.5 rounded text-[11px] font-medium"
                          style={{
                            backgroundColor: `${priorityCfg.color}20`,
                            color: priorityCfg.color,
                          }}
                        >
                          {priorityCfg.label}
                        </span>
                      )}
                      {task.tags.map((tag) => (
                        <span
                          key={tag._id}
                          className="px-1.5 py-0.5 rounded-full text-[11px] font-medium"
                          style={{
                            backgroundColor: tag.color ? `${tag.color}20` : "var(--accent-muted)",
                            color: tag.color || "var(--accent)",
                          }}
                        >
                          {tag.name}
                        </span>
                      ))}
                      {task.agents.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-(--card-border) text-(--muted)">
                          {task.agents.length} agent{task.agents.length !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-(--card-border)">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm text-(--muted) hover:text-foreground transition-colors rounded-lg hover:bg-(--card-border)"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
