"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useTrackedMutation } from "@/lib/useTrackedMutation";
import { useState, useSyncExternalStore, useCallback, useRef, useEffect } from "react";
import { Id } from "../../convex/_generated/dataModel";
import { CaptureItem } from "./CaptureItem";

const SIDEBAR_COLLAPSED_KEY = "tasky-captures-sidebar-collapsed";

function useSidebarCollapsed() {
  const subscribe = useCallback((callback: () => void) => {
    window.addEventListener("storage", callback);
    return () => window.removeEventListener("storage", callback);
  }, []);

  const getSnapshot = useCallback(() => {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  }, []);

  const getServerSnapshot = useCallback(() => false, []);

  const isCollapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setCollapsed = useCallback((value: boolean) => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(value));
    // Dispatch storage event to trigger re-render
    window.dispatchEvent(new StorageEvent("storage", { key: SIDEBAR_COLLAPSED_KEY }));
  }, []);

  return [isCollapsed, setCollapsed] as const;
}

export function CapturesSidebar({
  pageSelectedTagId,
}: {
  pageSelectedTagId?: Id<"tags"> | null;
} = {}) {
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [isCollapsed, setCollapsed] = useSidebarCollapsed();

  const toggleCollapsed = () => {
    setCollapsed(!isCollapsed);
  };

  const queryArgs = { includeCompleted };
  const captures = useQuery(api.captures.list, queryArgs);
  const create = useTrackedMutation(api.captures.create).withOptimisticUpdate(
    (localStore, args) => {
      const captures = localStore.getQuery(api.captures.list, queryArgs);
      if (captures !== undefined) {
        const tempCapture = {
          _id: crypto.randomUUID() as Id<"captures">,
          _creationTime: Number.MAX_SAFE_INTEGER,
          userId: "",
          text: args.text,
          completed: false,
        };
        localStore.setQuery(api.captures.list, queryArgs, [tempCapture, ...captures]);
      }
    }
  );
  const [newCapture, setNewCapture] = useState("");
  const mainTextareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCapture.trim()) return;
    create({ text: newCapture.trim() });
    setNewCapture("");
    // Reset textarea height after clearing
    if (mainTextareaRef.current) {
      mainTextareaRef.current.style.height = "auto";
    }
  };

  const handleMainKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  useEffect(() => {
    if (mainTextareaRef.current) {
      const textarea = mainTextareaRef.current;
      textarea.style.height = "auto";
      textarea.style.height = textarea.scrollHeight + "px";
    }
  }, [newCapture]);

  const completedCount = captures?.filter((c) => c.completed).length ?? 0;
  const totalCount = captures?.length ?? 0;

  // Collapsed view - just a thin strip with expand button
  if (isCollapsed) {
    return (
      <div className="w-10 shrink-0 flex flex-col h-full border-l border-(--card-border) bg-background">
        <button
          onClick={toggleCollapsed}
          className="p-2 text-(--muted) hover:text-foreground hover:bg-(--card-border) transition-colors"
          title="Expand captures sidebar"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        {totalCount > 0 && (
          <div className="flex-1 flex items-start justify-center pt-2">
            <span className="text-xs text-(--muted) [writing-mode:vertical-rl] rotate-180">
              {totalCount} capture{totalCount !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-80 shrink-0 flex flex-col h-full border-l border-(--card-border) bg-background">
      <div className="px-3 py-2 border-b border-(--card-border) space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-(--muted) text-xs">
            {totalCount === 0
              ? "No captures yet"
              : includeCompleted
                ? `${completedCount}/${totalCount} done`
                : `${totalCount} pending`}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIncludeCompleted(!includeCompleted)}
              className={`flex items-center gap-1.5 text-xs transition-colors duration-200 ${
                includeCompleted ? "text-accent" : "text-(--muted) hover:text-foreground"
              }`}
            >
              <span
                className={`relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors duration-200 ${
                  includeCompleted ? "bg-accent" : "bg-(--card-border)"
                }`}
              >
                <span
                  className={`inline-block h-2 w-2 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    includeCompleted ? "translate-x-[12px]" : "translate-x-1"
                  }`}
                />
              </span>
              Show done
            </button>
            <button
              onClick={toggleCollapsed}
              className="p-1 text-(--muted) hover:text-foreground hover:bg-(--card-border) rounded transition-colors"
              title="Collapse sidebar"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="flex gap-2 items-start">
          <textarea
            ref={mainTextareaRef}
            value={newCapture}
            onChange={(e) => setNewCapture(e.target.value)}
            onKeyDown={handleMainKeyDown}
            placeholder="Capture something..."
            rows={1}
            className="flex-1 bg-(--card-bg) border border-(--card-border) rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent transition-colors placeholder:text-(--muted) resize-none overflow-hidden max-h-32"
          />
          <button
            type="submit"
            className="bg-accent hover:bg-(--accent-hover) text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
          >
            Add
          </button>
        </form>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {captures === undefined ? (
          <div className="text-center py-4 text-(--muted) text-sm">Loading...</div>
        ) : captures.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-(--muted) text-sm mb-1">
              {includeCompleted ? "No captures yet" : "No pending captures"}
            </p>
            <p className="text-xs text-(--muted)/60">
              {includeCompleted ? "Add your first capture above" : "All caught up!"}
            </p>
          </div>
        ) : (
          captures.map((capture) => (
            <CaptureItem
              key={capture._id}
              id={capture._id}
              text={capture.text}
              completed={capture.completed}
              includeCompleted={includeCompleted}
              pageSelectedTagId={pageSelectedTagId}
            />
          ))
        )}
      </div>
    </div>
  );
}
