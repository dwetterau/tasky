"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SignIn } from "@/components/SignIn";
import { TaskyWordmark } from "@/components/TaskyWordmark";
import { useAuthSession } from "@/lib/useAuthSession";
import { authClient } from "@/lib/auth-client";
import { oauthApplicationName, oauthAuthorizeUrl } from "@/lib/oauth";

function OAuthLoginPageContent() {
  const { session, isPending } = useAuthSession();
  const searchParams = useSearchParams();
  const [continueError, setContinueError] = useState<string | null>(null);
  const userId = session?.user.id;
  const applicationName = oauthApplicationName(searchParams);
  const continueUrl = useMemo(() => {
    const issuer = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
    return issuer ? oauthAuthorizeUrl(issuer, searchParams.toString()) : null;
  }, [searchParams]);

  useEffect(() => {
    if (!userId || !continueUrl) return;
    const controller = new AbortController();

    async function resumeAuthorization() {
      try {
        const response = await fetch("/api/oauth/mcp/continue", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            authorizeUrl: continueUrl,
            betterAuthCookie: authClient.getCookie(),
          }),
        });
        const data = (await response.json()) as { location?: string };
        if (!response.ok || !data.location) {
          throw new Error("Could not continue sign-in. Please try again.");
        }
        if (!controller.signal.aborted) window.location.replace(data.location);
      } catch (error) {
        if (!controller.signal.aborted) {
          setContinueError(
            error instanceof Error
              ? error.message
              : "Could not continue sign-in.",
          );
        }
      }
    }

    void resumeAuthorization();
    return () => controller.abort();
  }, [continueUrl, userId]);

  if (isPending) return <Loading />;
  if (!session) return <SignIn applicationName={applicationName} />;

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="bg-(--card-bg) border border-(--card-border) rounded-2xl p-8 max-w-xl w-full shadow-2xl">
        <TaskyWordmark
          className="mb-4"
          imageClassName="h-[1.7rem] w-auto shrink-0"
          textClassName="text-lg"
        />
        <h1 className="text-2xl font-semibold mb-2">
          Connecting to {applicationName}
        </h1>
        {!continueUrl ? (
          <p className="text-(--muted)">
            This sign-in link is incomplete. Open {applicationName} to start
            again.
          </p>
        ) : continueError ? (
          <>
            <p role="alert" className="mb-4 text-sm text-red-400">
              {continueError}
            </p>
            <button
              className="px-4 py-2 rounded-lg bg-accent text-white"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          </>
        ) : (
          <p role="status" className="text-(--muted)">
            You’re signed in. Continuing to {applicationName}…
          </p>
        )}
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function OAuthLoginPage() {
  return (
    <Suspense fallback={<Loading />}>
      <OAuthLoginPageContent />
    </Suspense>
  );
}
