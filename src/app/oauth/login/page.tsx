"use client";

import { Suspense, useMemo } from "react";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { SignIn } from "@/components/SignIn";
import { useAuthSession } from "@/lib/useAuthSession";
import { authClient } from "@/lib/auth-client";
import { UserIdentity } from "@/components/UserIdentity";

function OAuthLoginPageContent() {
  const { session, isPending } = useAuthSession();
  const searchParams = useSearchParams();
  const [isContinuing, setIsContinuing] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);

  const continueUrl = useMemo(() => {
    const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
    if (!convexSiteUrl) return null;
    const query = searchParams.toString();
    if (!query) return null;
    return `${convexSiteUrl}/api/auth/mcp/authorize?${query}`;
  }, [searchParams]);

  const onContinue = async () => {
    if (!continueUrl) return;
    setIsContinuing(true);
    setContinueError(null);
    try {
      const betterAuthCookie = authClient.getCookie();
      const response = await fetch("/api/oauth/mcp/continue", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          authorizeUrl: continueUrl,
          betterAuthCookie,
        }),
      });

      const data = (await response.json()) as {
        location?: string;
        error?: string;
        status?: number;
      };

      if (!response.ok || !data.location) {
        throw new Error(data.error ?? "Failed to continue authorization");
      }

      window.location.href = data.location;
    } catch (error) {
      setContinueError(
        error instanceof Error ? error.message : "Failed to continue authorization"
      );
    } finally {
      setIsContinuing(false);
    }
  };

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
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="bg-(--card-bg) border border-(--card-border) rounded-2xl p-8 max-w-xl w-full shadow-2xl">
        <p className="text-sm font-semibold bg-linear-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent mb-4">
          Tasky
        </p>
        <div className="mb-6">
          <UserIdentity
            name={session.user.name}
            email={session.user.email}
            image={session.user.image}
            showEmail
            imageSize={36}
          />
        </div>
        <h1 className="text-2xl font-semibold mb-2">Signed in</h1>
        <p className="text-(--muted) mb-6">
          Click continue to complete MCP authorization and return to Cursor.
        </p>
        {continueError ? (
          <p className="mb-4 text-sm text-red-400 border border-red-400/30 rounded-lg px-3 py-2">{continueError}</p>
        ) : null}
        {continueUrl ? (
          <button
            className="inline-block px-4 py-2 rounded-lg bg-accent hover:bg-(--accent-hover) text-white transition-colors"
            onClick={() => void onContinue()}
            disabled={isContinuing}
          >
            {isContinuing ? "Continuing..." : "Continue authorization"}
          </button>
        ) : (
          <p className="text-sm text-(--muted)">
            Missing OAuth query parameters. Start authorization again from Cursor.
          </p>
        )}
      </div>
    </div>
  );
}

export default function OAuthLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <OAuthLoginPageContent />
    </Suspense>
  );
}
