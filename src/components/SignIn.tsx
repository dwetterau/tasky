"use client";

import { useState, useEffect } from "react";
import { useSearchParams, usePathname } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { AUTH_PENDING_KEY } from "@/lib/useAuthSession";

export function SignIn() {
  const [isLoading, setIsLoading] = useState(false);
  const [isAwaitingCallback, setIsAwaitingCallback] = useState(false);
  const searchParams = useSearchParams();
  const pathname = usePathname();

  // Check if we're in the middle of an OAuth callback
  // The crossDomain plugin uses /ott route with a token parameter
  const isAuthCallback =
    pathname === "/ott" ||
    searchParams.has("token") ||
    searchParams.has("code");

  // On mount, check if we started an auth flow (flag in sessionStorage)
  useEffect(() => {
    const authPending = sessionStorage.getItem(AUTH_PENDING_KEY);
    if (authPending || isAuthCallback) {
      setIsAwaitingCallback(true);
      setIsLoading(true);
    }
  }, [isAuthCallback]);

  const handleGitHubSignIn = async () => {
    setIsLoading(true);
    // Set a flag so we know to show loading after redirect
    sessionStorage.setItem(AUTH_PENDING_KEY, "true");
    await authClient.signIn.social({
      provider: "github",
    });
  };

  // Show a full-page loading spinner if we're awaiting auth callback
  if (isAwaitingCallback || isAuthCallback) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-(--muted)">Completing sign in...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-(--card-bg) border border-(--card-border) rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2 bg-linear-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            Tasky
          </h1>
          <p className="text-(--muted)">Your personal task manager</p>
        </div>
        <button
          onClick={() => void handleGitHubSignIn()}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-3 bg-[#24292e] hover:bg-[#2f363d] text-white py-3 px-4 rounded-xl transition-all duration-200 font-medium cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
          )}
          {isLoading ? "Signing in..." : "Sign in with GitHub"}
        </button>
      </div>
    </div>
  );
}
