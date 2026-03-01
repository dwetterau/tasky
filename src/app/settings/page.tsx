"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Navigation } from "../../components/Navigation";
import { SignIn } from "../../components/SignIn";
import { useAuthSession } from "@/lib/useAuthSession";
import { useTrackedMutation } from "@/lib/useTrackedMutation";

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function SettingsContent() {
  const keys = useQuery(api.apiKeys.list, {});
  const [name, setName] = useState("");
  const [type, setType] = useState<"github" | "cursor_agent_sdk">("github");
  const [value, setValue] = useState("");

  const create = useTrackedMutation(api.apiKeys.create).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(api.apiKeys.list, {});
    if (current === undefined) return;
    const tempKey = {
      _id: crypto.randomUUID() as Id<"apiKeys">,
      _creationTime: Number.MAX_SAFE_INTEGER,
      userId: "",
      name: args.name,
      type: args.type,
      keyVersion: 1,
      updatedAt: 0,
    };
    localStore.setQuery(api.apiKeys.list, {}, [tempKey, ...current]);
  });

  const remove = useTrackedMutation(api.apiKeys.remove).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(api.apiKeys.list, {});
    if (current === undefined) return;
    localStore.setQuery(
      api.apiKeys.list,
      {},
      current.filter((key) => key._id !== args.id)
    );
  });

  const canCreate = name.trim() && value.trim();

  const handleCreate = () => {
    if (!canCreate) return;
    create({
      name: name.trim(),
      type,
      value: value.trim(),
    });
    setValue("");
  };

  return (
    <div className="min-h-screen pt-20 pb-10 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold mb-2">Settings</h1>
          <p className="text-sm text-(--muted)">
            Manage user-scoped API keys used by integrations. Keys are encrypted at rest and never shown
            again after saving.
          </p>
        </div>

        <div className="bg-(--card-bg) border border-(--card-border) rounded-xl p-5 mb-6">
          <h2 className="text-base font-medium mb-4">Add API Key</h2>
          <div className="grid sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-(--muted) mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Production GitHub token"
                className="w-full h-[38px] px-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-(--muted) mb-1">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as "github" | "cursor_agent_sdk")}
                className="w-full h-[38px] px-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm"
              >
                <option value="github">GitHub</option>
                <option value="cursor_agent_sdk">Cursor Agent SDK</option>
              </select>
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-xs font-medium text-(--muted) mb-1">Key Value</label>
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Paste API key"
              className="w-full h-[38px] px-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleCreate}
              disabled={!canCreate}
              className="px-4 py-2 text-sm bg-accent hover:bg-(--accent-hover) text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save Key
            </button>
          </div>
        </div>

        <div className="bg-(--card-bg) border border-(--card-border) rounded-xl p-5">
          <h2 className="text-base font-medium mb-4">Saved API Keys</h2>
          {keys === undefined ? (
            <p className="text-sm text-(--muted)">Loading...</p>
          ) : keys.length === 0 ? (
            <p className="text-sm text-(--muted)">No keys saved yet.</p>
          ) : (
            <div className="space-y-2">
              {keys.map((key) => (
                <div
                  key={key._id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-(--card-border) px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{key.name}</p>
                    <p className="text-xs text-(--muted)">
                      {key.type} · saved {formatTimestamp(key._creationTime)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove({ id: key._id })}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { session, isPending } = useAuthSession();

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    return <SignIn />;
  }

  return (
    <>
      <Navigation />
      <SettingsContent />
    </>
  );
}
