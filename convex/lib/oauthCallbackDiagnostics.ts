import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";

function refererOrigin(referer: string | null | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/** Better Auth logs only the provider's error code. Record the description and
 * which correlation parameters arrived, never their values. */
export function oauthCallbackDiagnostics(): BetterAuthPlugin {
  return {
    id: "oauth-callback-diagnostics",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path?.startsWith("/callback/") ?? false,
          handler: createAuthMiddleware(async (ctx) => {
            const query = (ctx.query ?? {}) as Record<string, unknown>;
            if (typeof query.error !== "string") return;
            console.error("[auth.callback] Provider returned an error", {
              provider: ctx.params?.id ?? null,
              error: query.error,
              errorDescription:
                typeof query.error_description === "string"
                  ? query.error_description
                  : null,
              errorUri:
                typeof query.error_uri === "string" ? query.error_uri : null,
              hasState: typeof query.state === "string",
              hasCode: typeof query.code === "string",
              refererOrigin: refererOrigin(ctx.request?.headers.get("referer")),
            });
          }),
        },
      ],
    },
  };
}
