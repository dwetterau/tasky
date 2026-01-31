"use client";

import { useEffect, useRef } from "react";
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
  const wasAuthenticated = useRef(false);

  // Track if user was ever authenticated in this session
  useEffect(() => {
    if (session) {
      wasAuthenticated.current = true;
      sessionStorage.removeItem(AUTH_PENDING_KEY);
    }
  }, [session]);

  // If user was authenticated before and now isPending with no session,
  // they're signing out - don't show the loading spinner
  const isSigningOut = wasAuthenticated.current && !session && isPending;
  const effectiveIsPending = isPending && !isSigningOut;

  return { session, isPending: effectiveIsPending };
}
