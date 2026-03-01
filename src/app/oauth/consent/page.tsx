"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SignIn } from "@/components/SignIn";
import { useAuthSession } from "@/lib/useAuthSession";
import { authClient } from "@/lib/auth-client";
import { UserIdentity } from "@/components/UserIdentity";

function OAuthConsentPageContent() {
  const { session, isPending } = useAuthSession();
  const searchParams = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [didLaunchCursor, setDidLaunchCursor] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientName = useMemo(() => searchParams.get("client_name") ?? "", [searchParams]);
  const requestedScope = useMemo(() => searchParams.get("scope") ?? "", [searchParams]);
  const consentCode = useMemo(() => searchParams.get("consent_code") ?? "", [searchParams]);
  const consentUrl = useMemo(() => {
    const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
    if (!convexSiteUrl) return null;
    return `${convexSiteUrl}/api/auth/oauth2/consent`;
  }, []);

  const scopeList = useMemo(
    () => requestedScope.split(/\s+/).map((s) => s.trim()).filter((s) => s.length > 0),
    [requestedScope]
  );

  const submitConsent = async (accept: boolean) => {
    if (!consentUrl) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const betterAuthCookie = authClient.getCookie();
      const response = await fetch(consentUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Better-Auth-Cookie": betterAuthCookie,
        },
        body: JSON.stringify({
          accept,
          consent_code: consentCode || undefined,
        }),
      });

      const data = (await response.json()) as {
        redirectURI?: string;
        error?: string;
        error_description?: string;
      };

      if (!response.ok || !data.redirectURI) {
        const details = data.error_description
          ? ` (${data.error_description})`
          : data.error
            ? ` (${data.error})`
            : "";
        throw new Error(
          `Failed to submit consent${details}`
        );
      }

      setDidLaunchCursor(true);
      window.location.href = data.redirectURI;
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to submit consent"
      );
    } finally {
      setIsSubmitting(false);
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
      <div className="bg-(--card-bg) border border-(--card-border) rounded-2xl p-8 max-w-2xl w-full shadow-2xl">
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
        <h1 className="text-2xl font-semibold mb-2">Authorize client access</h1>
        <p className="text-(--muted) mb-6">
          Review and approve the scopes this MCP client is requesting.
        </p>
        {clientName ? (
          <p className="text-sm text-(--muted) mb-5">
            App requesting access: <span className="text-foreground font-medium">{clientName}</span>
          </p>
        ) : null}

        <div className="mb-6 border border-(--card-border) rounded-xl p-4">
          <p className="text-sm font-medium mb-3">Requested scopes</p>
          {scopeList.length === 0 ? (
            <p className="text-sm text-(--muted)">No scopes were explicitly requested.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {scopeList.map((scope) => (
                <li key={scope} className="text-xs px-2 py-1 rounded-full bg-(--accent-subtle) border border-(--card-border)">
                  {scope}
                </li>
              ))}
            </ul>
          )}
        </div>

        {error ? (
          <p className="mb-4 text-sm text-red-400 border border-red-400/30 rounded-lg px-3 py-2">{error}</p>
        ) : null}

        {didLaunchCursor ? (
          <p className="text-sm text-(--muted) border border-(--card-border) rounded-lg px-3 py-2">
            Authorization was sent to Cursor. You can close this window.
          </p>
        ) : (
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => void submitConsent(false)}
              disabled={isSubmitting || !consentUrl}
              className="px-4 py-2 rounded-lg border border-(--card-border) hover:border-red-400 hover:text-red-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Deny
            </button>
            <button
              onClick={() => void submitConsent(true)}
              disabled={isSubmitting || !consentUrl}
              className="px-4 py-2 rounded-lg bg-accent hover:bg-(--accent-hover) text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Submitting..." : "Allow"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function OAuthConsentPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <OAuthConsentPageContent />
    </Suspense>
  );
}
