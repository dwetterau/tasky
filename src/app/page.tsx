"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useState } from "react";
import { Id } from "../../convex/_generated/dataModel";
import { Navigation } from "../components/Navigation";

function SignIn() {
  const { signIn } = useAuthActions();

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            Tasky
          </h1>
          <p className="text-[var(--muted)]">Your personal task manager</p>
        </div>
        <button
          onClick={() => void signIn("github")}
          className="w-full flex items-center justify-center gap-3 bg-[#24292e] hover:bg-[#2f363d] text-white py-3 px-4 rounded-xl transition-all duration-200 font-medium"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
          Sign in with GitHub
        </button>
      </div>
    </div>
  );
}

function CaptureItem({
  id,
  text,
  completed,
}: {
  id: Id<"captures">;
  text: string;
  completed: boolean;
}) {
  const toggle = useMutation(api.captures.toggle).withOptimisticUpdate(
    (localStore, args) => {
      const captures = localStore.getQuery(api.captures.list, {});
      if (captures !== undefined) {
        localStore.setQuery(
          api.captures.list,
          {},
          captures.map((capture) =>
            capture._id === args.id ? { ...capture, completed: !capture.completed } : capture
          )
        );
      }
    }
  );

  const remove = useMutation(api.captures.remove).withOptimisticUpdate(
    (localStore, args) => {
      const captures = localStore.getQuery(api.captures.list, {});
      if (captures !== undefined) {
        localStore.setQuery(
          api.captures.list,
          {},
          captures.filter((capture) => capture._id !== args.id)
        );
      }
    }
  );

  return (
    <div className="group flex items-center gap-3 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 transition-all duration-200 hover:border-[var(--accent)]/30">
      <button
        onClick={() => toggle({ id })}
        className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all duration-200 ${
          completed
            ? "bg-[var(--accent)] border-[var(--accent)]"
            : "border-[var(--muted)] hover:border-[var(--accent)]"
        }`}
      >
        {completed && (
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>
      <span className={`flex-1 ${completed ? "line-through text-[var(--muted)]" : ""}`}>
        {text}
      </span>
      <button
        onClick={() => remove({ id })}
        className="opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-red-400 transition-all duration-200"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function CaptureList() {
  const captures = useQuery(api.captures.list);
  const create = useMutation(api.captures.create).withOptimisticUpdate(
    (localStore, args) => {
      const captures = localStore.getQuery(api.captures.list, {});
      if (captures !== undefined) {
        // Create a temporary capture - it will be replaced when the server responds
        const tempCapture = {
          _id: crypto.randomUUID() as Id<"captures">,
          _creationTime: Date.now(),
          userId: "" as Id<"users">,
          text: args.text,
          completed: false,
        };
        localStore.setQuery(api.captures.list, {}, [...captures, tempCapture]);
      }
    }
  );
  const [newCapture, setNewCapture] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCapture.trim()) return;
    create({ text: newCapture.trim() });
    setNewCapture("");
  };

  const completedCount = captures?.filter((c) => c.completed).length ?? 0;
  const totalCount = captures?.length ?? 0;

  return (
    <>
      <Navigation />
      <div className="min-h-screen pt-24 pb-12 px-4">
        <div className="max-w-xl mx-auto">
          <div className="mb-6">
            <p className="text-[var(--muted)] text-sm">
              {totalCount === 0
                ? "No tasks yet"
                : `${completedCount} of ${totalCount} completed`}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mb-6">
            <div className="flex gap-3">
              <input
                type="text"
                value={newCapture}
                onChange={(e) => setNewCapture(e.target.value)}
                placeholder="Capture something..."
                className="flex-1 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl px-4 py-3 focus:outline-none focus:border-[var(--accent)] transition-colors placeholder:text-[var(--muted)]"
              />
              <button
                type="submit"
                className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white px-6 py-3 rounded-xl font-medium transition-colors"
              >
                Add
              </button>
            </div>
          </form>

          <div className="space-y-3">
            {captures === undefined ? (
              <div className="text-center py-8 text-[var(--muted)]">Loading...</div>
            ) : captures.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-[var(--muted)] mb-2">No captures yet</p>
                <p className="text-sm text-[var(--muted)]/60">Add your first capture above</p>
              </div>
            ) : (
              captures.map((capture) => (
                <CaptureItem
                  key={capture._id}
                  id={capture._id}
                  text={capture.text}
                  completed={capture.completed}
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
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return isAuthenticated ? <CaptureList /> : <SignIn />;
}
