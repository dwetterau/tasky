"use client";

import { useAction } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { CURSOR_ICON_PATH, CURSOR_ICON_VIEWBOX } from "./constants";
import { getLastSelectedRepoStorageKey, readStoredRepoSelection } from "./startAgentStorage";

type RepoSummary = {
  id: number;
  name: string;
  fullName: string;
  ownerLogin: string;
  htmlUrl: string;
  description?: string;
  isPrivate: boolean;
};

type RepoSearchResult =
  | {
      status: "ok";
      repos: RepoSummary[];
      totalCachedRepos: number;
      cacheComplete: boolean;
    }
  | {
      status: "no_token" | "github_error";
      message: string;
      repos: RepoSummary[];
      totalCachedRepos: number;
      cacheComplete: boolean;
    };

function matchesPrefix(repo: RepoSummary, prefix: string): boolean {
  const normalizedPrefix = prefix.trim().toLowerCase();
  if (!normalizedPrefix) {
    return true;
  }
  return (
    repo.fullName.toLowerCase().startsWith(normalizedPrefix) ||
    repo.name.toLowerCase().startsWith(normalizedPrefix)
  );
}

export function StartAgentModal({
  isOpen,
  onClose,
  storageKeySuffix,
  initialPrompt,
  onStart,
}: {
  isOpen: boolean;
  onClose: () => void;
  storageKeySuffix: string;
  initialPrompt: string;
  onStart: (args: { repository: string; branch: string; prompt: string }) => Promise<void>;
}) {
  const searchRepos = useAction(api.githubRepos.search);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);
  const mouseDownTargetRef = useRef<EventTarget | null>(null);

  const [prefix, setPrefix] = useState(() => readStoredRepoSelection(storageKeySuffix));
  const [selectedRepoFullName, setSelectedRepoFullName] = useState<string | null>(() => {
    const storedRepo = readStoredRepoSelection(storageKeySuffix);
    return storedRepo || null;
  });
  const [result, setResult] = useState<RepoSearchResult | null>(null);
  const [lastResolvedPrefix, setLastResolvedPrefix] = useState(() =>
    readStoredRepoSelection(storageKeySuffix)
  );
  const [branch, setBranch] = useState("main");
  const [prompt, setPrompt] = useState(initialPrompt);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [unexpectedError, setUnexpectedError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setBranch("main");
    setPrompt(initialPrompt);
    setSubmitError(null);
  }, [isOpen, initialPrompt]);

  useEffect(() => {
    if (!isOpen) return;

    const currentRequestId = requestIdRef.current + 1;
    requestIdRef.current = currentRequestId;

    const timeoutId = window.setTimeout(() => {
      setIsLoading(true);
      setUnexpectedError(null);

      void searchRepos({ prefix })
        .then((nextResult) => {
          if (requestIdRef.current !== currentRequestId) return;
          setResult(nextResult as RepoSearchResult);
          setLastResolvedPrefix(prefix);
          setSelectedRepoFullName((currentSelection) => {
            if (!currentSelection) return currentSelection;
            return nextResult.repos.some((repo) => repo.fullName === currentSelection)
              ? currentSelection
              : null;
          });
        })
        .catch((error) => {
          if (requestIdRef.current !== currentRequestId) return;
          const message = error instanceof Error ? error.message : "Failed to load GitHub repositories.";
          setUnexpectedError(message);
          setResult(null);
        })
        .finally(() => {
          if (requestIdRef.current === currentRequestId) {
            setIsLoading(false);
          }
        });
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [isOpen, prefix, searchRepos]);

  useEffect(() => {
    if (!isOpen) return;

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [isOpen, onClose]);

  const selectedRepo = useMemo(
    () => result?.repos.find((repo) => repo.fullName === selectedRepoFullName) ?? null,
    [result, selectedRepoFullName]
  );

  const visibleRepos = useMemo(() => {
    if (!result) {
      return [];
    }
    return result.repos.filter((repo) => matchesPrefix(repo, prefix));
  }, [result, prefix]);

  const isUsingClientSideFilteringWhileLoading =
    isLoading && result !== null && prefix.trim() !== lastResolvedPrefix.trim();

  const handleSelectRepo = (fullName: string) => {
    setSelectedRepoFullName(fullName);
    if (typeof window !== "undefined") {
      localStorage.setItem(getLastSelectedRepoStorageKey(storageKeySuffix), fullName);
    }
  };

  const handleClearRepoSelection = () => {
    setSelectedRepoFullName(null);
    setPrefix((currentPrefix) => {
      const fallbackPrefix = selectedRepoFullName ?? currentPrefix;
      return fallbackPrefix;
    });
    setSubmitError(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem(getLastSelectedRepoStorageKey(storageKeySuffix));
    }
  };

  const handleStart = async () => {
    const promptText = prompt.trim();
    const branchName = branch.trim();
    const repository =
      selectedRepo?.htmlUrl ??
      (selectedRepoFullName ? `https://github.com/${selectedRepoFullName}` : "");
    if (!repository || !branchName || !promptText) {
      return;
    }

    setIsStarting(true);
    setSubmitError(null);
    try {
      await onStart({ repository, branch: branchName, prompt: promptText });
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to start agent.");
    } finally {
      setIsStarting(false);
    }
  };

  if (!isOpen) return null;

  const statusText = isUsingClientSideFilteringWhileLoading
    ? "Loading more matches..."
    : result?.status === "no_token" || result?.status === "github_error"
      ? result.message
      : null;
  const hasRepoSelection = Boolean(selectedRepoFullName);
  const canStart = hasRepoSelection && branch.trim().length > 0 && prompt.trim().length > 0 && !isStarting;

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center p-4"
      onMouseDown={(e) => { mouseDownTargetRef.current = e.target; }}
      onClick={(e) => { if (e.target === mouseDownTargetRef.current) onClose(); }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-(--card-bg) border border-(--card-border) rounded-2xl p-6 max-w-2xl w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-(--accent)/10 flex items-center justify-center">
            <svg className="w-4.5 h-5 text-accent" viewBox={CURSOR_ICON_VIEWBOX} fill="currentColor" aria-hidden="true">
              <path d={CURSOR_ICON_PATH} />
            </svg>
          </div>
          <h3 className="text-lg font-semibold">Start a Cursor Cloud Agent</h3>
        </div>

        <div className="space-y-4">
          {!hasRepoSelection ? (
            <>
              <div>
                <label className="block text-xs font-medium text-(--muted) mb-1">Repo Prefix</label>
                <input
                  ref={inputRef}
                  type="text"
                  value={prefix}
                  onChange={(event) => setPrefix(event.target.value)}
                  placeholder="owner/repo or repo prefix"
                  className="w-full h-[38px] px-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm"
                />
              </div>

              <div className="min-h-[20px]">
                {statusText ? (
                  <p
                    className={`text-xs ${
                      result?.status === "github_error" || result?.status === "no_token"
                        ? "text-amber-400"
                        : "text-(--muted)"
                    }`}
                  >
                    {statusText}
                    {result?.status === "no_token" ? (
                      <>
                        {" "}
                        <a href="/settings" className="text-accent hover:underline">
                          Open Settings
                        </a>
                        .
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}

          {unexpectedError && <p className="text-xs text-red-400">{unexpectedError}</p>}

          {!hasRepoSelection ? (
            <div className="border border-(--card-border) rounded-xl overflow-hidden">
              <div className="max-h-[320px] overflow-y-auto divide-y divide-(--card-border)">
                {isLoading && !result ? (
                  <div className="px-4 py-8 text-sm text-(--muted) text-center">Loading repositories...</div>
                ) : visibleRepos.length > 0 ? (
                  <>
                    {visibleRepos.map((repo) => {
                    const isSelected = repo.fullName === selectedRepoFullName;
                    return (
                      <button
                        key={repo.id}
                        type="button"
                        onClick={() => handleSelectRepo(repo.fullName)}
                        className={`w-full px-4 py-3 text-left transition-colors ${
                          isSelected ? "bg-(--accent)/10" : "hover:bg-(--card-border)/60"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">{repo.fullName}</span>
                              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-(--card-border) text-(--muted)">
                                {repo.isPrivate ? "Private" : "Public"}
                              </span>
                            </div>
                            {repo.description ? (
                              <p className="mt-1 text-sm text-(--muted) line-clamp-2">{repo.description}</p>
                            ) : (
                              <p className="mt-1 text-sm text-(--muted)">No description</p>
                            )}
                          </div>
                          {isSelected && (
                            <span className="text-accent text-sm font-medium shrink-0">Selected</span>
                          )}
                        </div>
                      </button>
                    );
                    })}
                  </>
                ) : (
                  <div className="px-4 py-8 text-sm text-(--muted) text-center">
                    {isLoading
                      ? "Loading repositories..."
                      : result?.status === "no_token"
                      ? "Save a GitHub token to load repositories."
                      : prefix.trim()
                        ? "No repositories match that prefix yet."
                        : "No repositories found."}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-(--card-border) bg-background px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-(--muted)">Selected Repo</p>
                    <p className="text-sm font-medium truncate">
                      {selectedRepo?.fullName ?? selectedRepoFullName}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearRepoSelection}
                    className="px-2 py-1 text-xs text-(--muted) hover:text-foreground rounded-md hover:bg-(--card-border) transition-colors shrink-0"
                  >
                    Clear
                  </button>
                </div>
                {selectedRepo?.htmlUrl ? (
                  <a
                    href={selectedRepo.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 text-xs text-accent hover:underline truncate inline-block max-w-full"
                  >
                    {selectedRepo.htmlUrl}
                  </a>
                ) : null}
              </div>

              <div>
                <label className="block text-xs font-medium text-(--muted) mb-1">Branch</label>
                <input
                  type="text"
                  value={branch}
                  onChange={(event) => {
                    setBranch(event.target.value);
                    setSubmitError(null);
                  }}
                  placeholder="main"
                  className="w-full h-[38px] px-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-(--muted) mb-1">Prompt</label>
                <textarea
                  value={prompt}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    setSubmitError(null);
                  }}
                  rows={8}
                  placeholder="Tell the agent what to do"
                  className="w-full px-3 py-2 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm resize-y min-h-[160px]"
                />
              </div>

              {submitError ? <p className="text-xs text-red-400">{submitError}</p> : null}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-5">
          <button
            onClick={onClose}
            disabled={isStarting}
            className="px-4 py-2 text-sm text-(--muted) hover:text-foreground transition-colors rounded-lg hover:bg-(--card-border)"
          >
            Close
          </button>
          {hasRepoSelection ? (
            <button
              type="button"
              onClick={() => void handleStart()}
              disabled={!canStart}
              className="px-4 py-2 text-sm bg-accent hover:bg-(--accent-hover) text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isStarting ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>Starting...</span>
                </>
              ) : (
                "Start"
              )}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
