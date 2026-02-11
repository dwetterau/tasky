"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useTrackedMutation } from "@/lib/useTrackedMutation";
import { useState, useRef, useEffect } from "react";
import { Id } from "../../convex/_generated/dataModel";
import { Navigation } from "../components/Navigation";
import { SignIn } from "../components/SignIn";
import { useAuthSession } from "@/lib/useAuthSession";
import { CaptureItem } from "../components/CaptureItem";

function CaptureList() {
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const queryArgs = { includeCompleted };
  const captures = useQuery(api.captures.list, queryArgs);
  const create = useTrackedMutation(api.captures.create).withOptimisticUpdate(
    (localStore, args) => {
      const captures = localStore.getQuery(api.captures.list, queryArgs);
      if (captures !== undefined) {
        // Create a temporary capture - it will be replaced when the server responds
        // New captures are added at the beginning since we sort by creation time desc
        // Use MAX_SAFE_INTEGER so it sorts to the top until server responds with real timestamp
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

  return (
    <>
      <Navigation />
      <div className="min-h-screen pt-24 pb-12 px-4">
        <div className="max-w-xl mx-auto">
          <div className="mb-6 flex items-center justify-between">
            <p className="text-(--muted) text-sm">
              {totalCount === 0
                ? "No captures yet"
                : includeCompleted
                  ? `${completedCount} of ${totalCount} completed`
                  : `${totalCount} pending`}
            </p>
            <button
              onClick={() => setIncludeCompleted(!includeCompleted)}
              className={`flex items-center gap-2 text-sm transition-colors duration-200 ${
                includeCompleted ? "text-accent" : "text-(--muted) hover:text-foreground"
              }`}
            >
              <span
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${
                  includeCompleted ? "bg-accent" : "bg-(--card-border)"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    includeCompleted ? "translate-x-[18px]" : "translate-x-1"
                  }`}
                />
              </span>
              Show completed
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mb-6">
            <div className="flex gap-3 items-start">
              <textarea
                ref={mainTextareaRef}
                value={newCapture}
                onChange={(e) => setNewCapture(e.target.value)}
                onKeyDown={handleMainKeyDown}
                placeholder="Capture something..."
                autoFocus
                rows={1}
                className="flex-1 bg-(--card-bg) border border-(--card-border) rounded-xl px-4 py-3 focus:outline-none focus:border-accent transition-colors placeholder:text-(--muted) resize-none overflow-hidden max-h-48"
              />
              <button
                type="submit"
                className="bg-accent hover:bg-(--accent-hover) text-white px-6 py-3 rounded-xl font-medium transition-colors"
              >
                Add
              </button>
            </div>
          </form>

          <div className="space-y-3">
            {captures === undefined ? (
              <div className="text-center py-8 text-(--muted)">Loading...</div>
            ) : captures.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-(--muted) mb-2">
                  {includeCompleted ? "No captures yet" : "No pending captures"}
                </p>
                <p className="text-sm text-(--muted)/60">
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
                />
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default function Home() {
  const { session, isPending } = useAuthSession();

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return session ? <CaptureList /> : <SignIn />;
}
