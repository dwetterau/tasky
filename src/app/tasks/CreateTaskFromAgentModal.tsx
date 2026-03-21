"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Id } from "../../../convex/_generated/dataModel";
import { TagSelector, Tag } from "../../components/TagSelector";
import { StyledSelect, type SelectOption } from "../../components/StyledSelect";
import { CURSOR_ICON_PATH, CURSOR_ICON_VIEWBOX } from "./constants";
import { PRIORITY_CONFIG, PRIORITY_ORDER, type TaskPriority } from "./constants";
import { getAgentAttachmentErrorMessage } from "./attachmentErrors";
import { StartAgentModal } from "./StartAgentModal";
import { extractCursorAgentExternalId } from "../../../convex/cursorAgentUrl";

export function CreateTaskFromAgentModal({
  isOpen,
  onClose,
  onCreateFromAgent,
  onStartAgent,
  storageKeySuffix,
  allTags,
  initialTagId,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreateFromAgent: (args: {
    externalId: string;
    tagIds: Id<"tags">[];
    priority: TaskPriority;
  }) => Promise<void> | void;
  onStartAgent: (args: {
    repository: string;
    branch: string;
    prompt: string;
    tagIds: Id<"tags">[];
    priority: TaskPriority;
  }) => Promise<void> | void;
  storageKeySuffix: string;
  allTags: Tag[];
  initialTagId?: Id<"tags"> | null;
}) {
  const [agentInput, setAgentInput] = useState("");
  const [tagIds, setTagIds] = useState<Id<"tags">[]>([]);
  const [priority, setPriority] = useState<TaskPriority>("triage");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showStartAgentModal, setShowStartAgentModal] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mouseDownTargetRef = useRef<EventTarget | null>(null);

  const handleClose = useCallback(() => {
    setAgentInput("");
    setTagIds(initialTagId ? [initialTagId] : []);
    setPriority("triage");
    setSubmitError(null);
    setIsSubmitting(false);
    setShowStartAgentModal(false);
    onClose();
  }, [initialTagId, onClose]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen) {
        handleClose();
      }
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [handleClose, isOpen]);

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

  useEffect(() => {
    if (!submitError) return;
    const timeoutId = window.setTimeout(() => setSubmitError(null), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [submitError]);

  useEffect(() => {
    if (!isOpen) return;
    setTagIds(initialTagId ? [initialTagId] : []);
    setPriority("triage");
  }, [initialTagId, isOpen]);

  if (!isOpen) return null;

  const parsedExternalId = extractCursorAgentExternalId(agentInput);
  const canSubmit = Boolean(parsedExternalId);
  const selectedTags = tagIds
    .map((id) => allTags.find((tag) => tag._id === id))
    .filter((tag): tag is Tag => tag !== undefined);

  const handleSubmit = async () => {
    if (!parsedExternalId) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onCreateFromAgent({
        externalId: parsedExternalId,
        tagIds,
        priority,
      });
      handleClose();
    } catch (error) {
      setSubmitError(getAgentAttachmentErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        mouseDownTargetRef.current = e.target;
      }}
      onClick={(e) => {
        if (e.target === mouseDownTargetRef.current) handleClose();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-(--card-bg) border border-(--card-border) rounded-2xl p-6 max-w-lg w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-(--accent)/10 flex items-center justify-center">
            <svg className="w-4.5 h-5 text-accent" viewBox={CURSOR_ICON_VIEWBOX} fill="currentColor" aria-hidden="true">
              <path d={CURSOR_ICON_PATH} />
            </svg>
          </div>
          <h3 className="text-lg font-semibold">Create Task From Agent</h3>
        </div>

        <p className="text-sm text-(--muted) mb-5">
          Create a task from an existing Cursor agent, or start a new one.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-(--muted) mb-1">Priority</label>
            <StyledSelect
              value={priority}
              onChange={(value) => setPriority(value as TaskPriority)}
              options={PRIORITY_ORDER.map((priorityValue): SelectOption => ({
                value: priorityValue,
                label: PRIORITY_CONFIG[priorityValue].label,
                color: PRIORITY_CONFIG[priorityValue].color,
              }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-(--muted) mb-1">Tags</label>
            <TagSelector
              selectedTags={selectedTags}
              onTagsChange={setTagIds}
              allTags={allTags}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-(--muted) mb-1">Agent Link or ID</label>
            <input
              ref={inputRef}
              type="text"
              value={agentInput}
              onChange={(e) => {
                setAgentInput(e.target.value);
                setSubmitError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder="cursor.com/agents/bc-xxxx or bc-xxxx"
              disabled={isSubmitting}
              className="w-full h-[38px] px-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>
          {(submitError || agentInput.trim()) && (
            <p
              className={`text-xs ${
                submitError || !parsedExternalId ? "text-red-400" : "text-(--muted)"
              }`}
            >
              {submitError ??
                (parsedExternalId
                  ? `External ID: ${parsedExternalId}`
                  : "Enter a Cursor agent URL or a bc-... external ID")}
            </p>
          )}
        </div>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-(--card-border)" />
          <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-(--muted)">Or</span>
          <div className="h-px flex-1 bg-(--card-border)" />
        </div>

        <div className="rounded-xl border border-(--card-border) bg-background/60 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Start a new Cursor cloud agent</p>
            </div>
            <button
              type="button"
              onClick={() => setShowStartAgentModal(true)}
              disabled={isSubmitting}
              className="shrink-0 px-4 py-2 text-sm text-accent hover:text-white border border-accent/30 hover:bg-accent rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-accent disabled:hover:bg-transparent"
            >
              Start Agent
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-5">
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm text-(--muted) hover:text-foreground transition-colors rounded-lg hover:bg-(--card-border)"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit || isSubmitting}
            className="px-4 py-2 text-sm bg-accent hover:bg-(--accent-hover) text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Creating..." : "Create Task"}
          </button>
        </div>

        <StartAgentModal
          isOpen={showStartAgentModal}
          onClose={() => setShowStartAgentModal(false)}
          storageKeySuffix={storageKeySuffix}
          initialPrompt=""
          onStart={async ({ repository, branch, prompt }) => {
            await onStartAgent({
              repository,
              branch,
              prompt,
              tagIds,
              priority,
            });
            handleClose();
          }}
        />
      </div>
    </div>
  );
}
