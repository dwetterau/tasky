"use client";

import { useEffect, useState } from "react";
import { authClient } from "./auth-client";

export const AUTH_PENDING_KEY = "tasky_auth_pending";

/**
 * Hook that wraps authClient.useSession and handles clearing
 * the auth pending flag when session is established.
 * 
 * Also tracks if user was previously authenticated to avoid
 * showing loading spinner during sign-out.
 */
export function useAuthSession() {
  const { data: session, isPending } = authClient.useSession();
  const hasSession = Boolean(session);
  const [authHistory, setAuthHistory] = useState(() => ({
    hasSession,
    wasAuthenticated: hasSession,
  }));
  let wasAuthenticated = authHistory.wasAuthenticated;

  if (authHistory.hasSession !== hasSession) {
    wasAuthenticated = authHistory.wasAuthenticated || hasSession;
    setAuthHistory({ hasSession, wasAuthenticated });
  }

  useEffect(() => {
    if (session) {
      sessionStorage.removeItem(AUTH_PENDING_KEY);
    }
  }, [session]);

  // If user was authenticated before and now isPending with no session,
  // they're signing out - don't show the loading spinner
  const isSigningOut = wasAuthenticated && !session && isPending;
  const effectiveIsPending = isPending && !isSigningOut;

  return { session, isPending: effectiveIsPending };
}
