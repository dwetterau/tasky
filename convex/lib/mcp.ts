import { APIError, createAuthEndpoint } from "better-auth/api";
import type { mcp } from "better-auth/plugins";

/** MCP and OIDC share grant storage in Better Auth 1.4.9. Keep homepage
 * credentials out of MCP, whose refresh endpoint does not authenticate the
 * confidential client. Install this even when homepage OIDC is disabled, so
 * previously issued grants cannot fall back to MCP. */
export function isolateHomepageFromMcp(
  provider: ReturnType<typeof mcp>,
  homepageClientId: string,
) {
  return {
    ...provider,
    endpoints: {
      ...provider.endpoints,
      mcpOAuthToken: createAuthEndpoint(
        "/mcp/token",
        provider.endpoints.mcpOAuthToken.options,
        async (ctx) => {
          // Match the provider's last-value FormData conversion without relying
          // on DOM.Iterable, which Convex's TypeScript runtime does not include.
          const field = (name: string): unknown =>
            ctx.body instanceof FormData
              ? ctx.body.getAll(name).at(-1)
              : ctx.body[name];
          const isRefresh = field("grant_type") === "refresh_token";
          const credential = field(isRefresh ? "refresh_token" : "code");
          if (credential != null) {
            // Reject coercible JSON arrays/objects rather than letting the pinned
            // provider turn them into token strings after the boundary check.
            if (typeof credential !== "string")
              throw new APIError("BAD_REQUEST", { error: "invalid_request" });
            let clientId: unknown;
            if (isRefresh) {
              const grant = await ctx.context.adapter.findOne<{
                clientId: string;
              }>({
                model: "oauthAccessToken",
                where: [{ field: "refreshToken", value: credential }],
              });
              clientId = grant?.clientId;
            } else {
              const grant =
                await ctx.context.internalAdapter.findVerificationValue(
                  credential,
                );
              if (grant)
                clientId = (JSON.parse(grant.value) as { clientId?: unknown })
                  .clientId;
            }
            // Check the stored owner, not the caller's client_id or auth header.
            // Reject before MCP can mint tokens or consume an authorization code.
            if (clientId === homepageClientId)
              throw new APIError("UNAUTHORIZED", { error: "invalid_grant" });
          }
          return provider.endpoints.mcpOAuthToken({ ...ctx, asResponse: true });
        },
      ),
      getMcpSession: createAuthEndpoint(
        "/mcp/get-session",
        provider.endpoints.getMcpSession.options,
        async (ctx) => {
          const session = await provider.endpoints.getMcpSession({
            ...ctx,
            asResponse: false,
            returnHeaders: false,
            returnStatus: false,
          });
          // The MCP session includes its refresh token. A homepage access token
          // must neither disclose that record nor authenticate to withMcpAuth.
          ctx.setHeader("Cache-Control", "private, no-store");
          return ctx.json(
            session?.clientId === homepageClientId ? null : session,
          );
        },
      ),
    },
  };
}
