"use client";

import { useEffect, useRef, useState } from "react";
import { Id } from "../../../convex/_generated/dataModel";
import { PR_ICON_PATHS } from "./constants";

export function AttachPrModal({
  isOpen,
  taskId,
  onClose,
  onAttach,
}: {
  isOpen: boolean;
  taskId: Id<"tasks"> | null;
  onClose: () => void;
  onAttach: (args: { taskId: Id<"tasks">; url: string }) => void;
}) {
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen) {
        setUrl("");
        onClose();
      }
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const timeoutId = window.setTimeout(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.select();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen]);

  if (!isOpen || !taskId) return null;

  const handleClose = () => {
    setUrl("");
    onClose();
  };

  const canSubmit = Boolean(url.trim());

  const handleSubmit = () => {
    if (!canSubmit) return;
    onAttach({
      taskId,
      url: url.trim(),
    });
    handleClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-(--card-bg) border border-(--card-border) rounded-2xl p-6 max-w-lg w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-(--accent)/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-accent" viewBox="0 0 16 16" fill="currentColor">
              <path d={PR_ICON_PATHS.open} />
            </svg>
          </div>
          <h3 className="text-lg font-semibold">Attach Pull Request</h3>
        </div>

        <div>
          <label className="block text-xs font-medium text-(--muted) mb-1">GitHub PR URL</label>
          <input
            ref={inputRef}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="https://github.com/owner/repo/pull/123"
            className="w-full h-[38px] px-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm"
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-5">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm text-(--muted) hover:text-foreground transition-colors rounded-lg hover:bg-(--card-border)"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm bg-accent hover:bg-(--accent-hover) text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Attach PR
          </button>
        </div>
      </div>
    </div>
  );
}
