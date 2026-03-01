"use client";

import { useEffect, useState } from "react";
import { Id } from "../../../convex/_generated/dataModel";
import { CURSOR_ICON_VIEWBOX, CURSOR_ICON_PATH } from "./constants";

function extractExternalId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^bc-[A-Za-z0-9.-]+$/.test(trimmed)) {
    return trimmed;
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== "cursor.com" && hostname !== "www.cursor.com") {
      return null;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && parts[0] === "agents" && /^bc-[A-Za-z0-9.-]+$/.test(parts[1])) {
      return parts[1];
    }
  } catch {
    return null;
  }

  return null;
}

export function AttachAgentModal({
  isOpen,
  taskId,
  onClose,
  onAttach,
}: {
  isOpen: boolean;
  taskId: Id<"tasks"> | null;
  onClose: () => void;
  onAttach: (args: {
    taskId: Id<"tasks">;
    externalId: string;
  }) => void;
}) {
  const [agentInput, setAgentInput] = useState("");

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen) {
        setAgentInput("");
        onClose();
      }
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [isOpen, onClose]);

  if (!isOpen || !taskId) return null;

  const handleClose = () => {
    setAgentInput("");
    onClose();
  };

  const parsedExternalId = extractExternalId(agentInput);
  const canSubmit = Boolean(parsedExternalId);

  const handleSubmit = () => {
    if (!parsedExternalId) return;
    onAttach({
      taskId,
      externalId: parsedExternalId,
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
            <svg className="w-4.5 h-5 text-accent" viewBox={CURSOR_ICON_VIEWBOX} fill="currentColor">
              <path d={CURSOR_ICON_PATH} />
            </svg>
          </div>
          <h3 className="text-lg font-semibold">Attach Agent</h3>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-(--muted) mb-1">Agent Link or ID</label>
            <input
              type="text"
              value={agentInput}
              onChange={(e) => setAgentInput(e.target.value)}
              placeholder="cursor.com/agents/bc-xxxx or bc-xxxx"
              className="w-full h-[38px] px-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm"
            />
          </div>
          {agentInput.trim() && (
            <p className={`text-xs ${parsedExternalId ? "text-(--muted)" : "text-red-400"}`}>
              {parsedExternalId
                ? `External ID: ${parsedExternalId}`
                : "Enter a Cursor agent URL or a bc-... external ID"}
            </p>
          )}
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
            Attach Agent
          </button>
        </div>
      </div>
    </div>
  );
}
