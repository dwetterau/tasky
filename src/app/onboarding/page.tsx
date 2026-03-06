"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Navigation } from "@/components/Navigation";
import { SignIn } from "@/components/SignIn";
import { TaskyWordmark } from "@/components/TaskyWordmark";
import { useAuthSession } from "@/lib/useAuthSession";
import { useTrackedMutation } from "@/lib/useTrackedMutation";

const sections = [
  {
    title: "Captures",
    description:
      "Capture thoughts quickly so they do not live in your head. From here, either file to a Task or Note, or knock it out immediately if it takes under 2 minutes.",
  },
  {
    title: "Tasks",
    description:
      "Tasks are your execution lane: most start from captures, then move to Done. Integrate Cursor Agents and GitHub to automate progress updates.",
  },
  {
    title: "Notes",
    description: "Write markdown notes for context and reference, either directly or from captures.",
  },
  {
    title: "Tags",
    description:
      "Use hierarchical tags across Tasks and Notes. They work like folders, while still letting one item belong to multiple contexts.",
  },
  {
    title: "MCP",
    description:
      "Configure the Tasky MCP server in Settings so external tools can read and manipulate your captures and tasks.",
  },
  {
    title: "Dashboard",
    description:
      "Track insights and activity stats to understand where your attention is going.",
  },
] as const;

export default function OnboardingPage() {
  const { session, isPending } = useAuthSession();
  const onboardingState = useQuery(api.onboarding.getState, session ? {} : "skip");
  const completeOnboarding = useTrackedMutation(api.onboarding.complete);
  const router = useRouter();
  const [clickedSections, setClickedSections] = useState<Set<string>>(() => new Set());

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

  const hasCompletedOnboarding = onboardingState?.hasCompletedOnboarding ?? false;

  const handleContinue = async () => {
    await completeOnboarding({});
    router.push("/settings");
  };

  return (
    <>
      {hasCompletedOnboarding ? <Navigation /> : null}
      <main
        className={`min-h-screen ${hasCompletedOnboarding ? "pt-24 pb-12 px-4" : "px-4 py-8"} bg-background`}
      >
        <div className={`mx-auto ${hasCompletedOnboarding ? "max-w-5xl" : "max-w-6xl"}`}>
          <div className="rounded-2xl border border-(--card-border) bg-(--card-bg) shadow-2xl shadow-black/20 overflow-hidden">
            <div className="border-b border-(--card-border) px-6 py-8 sm:px-10">
              <TaskyWordmark
                priority
                className="mb-4"
                imageClassName="h-8 w-auto shrink-0"
                textClassName="text-2xl"
              />
              <h1 className="text-3xl sm:text-4xl font-semibold">Organize your thoughts in an agent-first world</h1>
            </div>

            <section className="px-6 py-8 sm:px-10">
              <ul className="space-y-3">
                {sections.map((section) => {
                  const isClicked = clickedSections.has(section.title);
                  return (
                    <li key={section.title}>
                      <button
                        type="button"
                        onClick={() =>
                          setClickedSections((prev) => {
                            if (prev.has(section.title)) return prev;
                            const next = new Set(prev);
                            next.add(section.title);
                            return next;
                          })
                        }
                        className={`w-full rounded-xl border bg-background/70 px-4 py-3 text-left transition-colors cursor-pointer ${
                          isClicked
                            ? "border-(--card-border) text-(--muted)"
                            : "border-(--card-border) hover:border-accent/40"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                              isClicked
                                ? "bg-(--card-border) text-(--muted)"
                                : "border border-(--card-border) bg-transparent text-transparent"
                            }`}
                          >
                            {isClicked ? (
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : null}
                          </span>
                          <div>
                            <h2 className={`text-base font-medium mb-1 ${isClicked ? "text-(--muted)" : ""}`}>
                              {section.title}
                            </h2>
                            <p className={`text-sm leading-relaxed ${isClicked ? "text-(--muted)/90" : "text-(--muted)"}`}>
                              {section.description}
                            </p>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="border-t border-(--card-border) px-6 py-6 sm:px-10">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <p className="text-sm text-(--muted)">
                  Configure your GitHub and Cursor Agent SDK keys to enable even more magic.
                </p>
                <div className="flex gap-2">
                  {hasCompletedOnboarding ? (
                    <Link
                      href="/settings"
                      className="inline-flex items-center justify-center px-4 py-2 text-sm rounded-lg border border-(--card-border) hover:bg-(--card-border) transition-colors"
                    >
                      Go to Settings
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleContinue()}
                      className="inline-flex items-center justify-center px-4 py-2 text-sm rounded-lg bg-accent hover:bg-(--accent-hover) text-white font-medium transition-colors cursor-pointer"
                    >
                      Continue to Settings
                    </button>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}

