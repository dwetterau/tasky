"use client";

import { useRef, useEffect } from "react";

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  itemPreview,
  warning,
  confirmLabel = "Delete",
  variant = "danger",
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  itemPreview?: string;
  warning?: string;
  confirmLabel?: string;
  variant?: "danger" | "warning";
}) {
  const mouseDownTargetRef = useRef<EventTarget | null>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const displayPreview =
    itemPreview && itemPreview.length > 100
      ? itemPreview.slice(0, 100) + "..."
      : itemPreview;

  const iconColor = variant === "danger" ? "text-red-500" : "text-amber-500";
  const iconBg = variant === "danger" ? "bg-red-500/10" : "bg-amber-500/10";
  const btnBg =
    variant === "danger"
      ? "bg-red-500 hover:bg-red-600"
      : "bg-amber-500 hover:bg-amber-600";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 cursor-default"
      onMouseDown={(e) => {
        mouseDownTargetRef.current = e.target;
      }}
      onClick={(e) => {
        if (e.target === mouseDownTargetRef.current) onClose();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      <div
        className="relative bg-(--card-bg) border border-(--card-border) rounded-2xl p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div
            className={`w-10 h-10 rounded-full ${iconBg} flex items-center justify-center`}
          >
            <svg
              className={`w-5 h-5 ${iconColor}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold">{title}</h3>
        </div>

        <p className="text-(--muted) mb-2">{message}</p>

        {warning && (
          <p className="text-amber-500 text-sm mb-2">{warning}</p>
        )}

        {displayPreview && (
          <div className="bg-background border border-(--card-border) rounded-lg p-3 mb-6">
            <p className="text-sm text-foreground line-clamp-3">
              {displayPreview}
            </p>
          </div>
        )}

        {!displayPreview && <div className="mb-4" />}

        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-(--muted) hover:text-foreground transition-colors rounded-lg hover:bg-(--card-border)"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm ${btnBg} text-white rounded-lg transition-colors font-medium`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
