"use client";

import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexReactClient, useConvexAuth, useMutation } from "convex/react";
import { ReactNode, useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { SavingProvider } from "@/lib/SavingContext";
import { api } from "../../convex/_generated/api";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

function TimezoneSync() {
  const { isAuthenticated } = useConvexAuth();
  const updateTimezone = useMutation(api.users.updateTimezone);

  useEffect(() => {
    if (!isAuthenticated) return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone) {
      void updateTimezone({ timezone });
    }
  }, [isAuthenticated, updateTimezone]);

  return null;
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      <SavingProvider>
        <TimezoneSync />
        {children}
      </SavingProvider>
    </ConvexBetterAuthProvider>
  );
}
