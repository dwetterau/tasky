import {
  APIError,
  createAuthEndpoint,
  getSessionFromCtx,
} from "better-auth/api";
import type { mcp } from "better-auth/plugins";
import { z } from "zod";

const bytes = new TextEncoder();
function b64(value: Uint8Array) {
  return btoa(String.fromCharCode(...value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function unb64(value: string) {
  return Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
}
async function key(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    bytes.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
type Binding = {
  resource: string;
  purpose: "access" | "refresh";
  nonce: string;
  consentId: string;
};
async function bind(secret: string, binding: Binding) {
  const payload = b64(bytes.encode(JSON.stringify(binding)));
  return `tmcp1.${payload}.${b64(new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), bytes.encode(payload))))}`;
}
async function verify(
  secret: string,
  token: unknown,
  resource: string,
  purpose: Binding["purpose"],
): Promise<Binding | null> {
  if (typeof token !== "string" || token.length > 4096) return null;
  try {
    const [version, payload, signature, extra] = token.split(".");
    if (version !== "tmcp1" || !payload || !signature || extra !== undefined)
      return null;
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        await key(secret),
        unb64(signature),
        bytes.encode(payload),
      ))
    )
      return null;
    const value = JSON.parse(
      new TextDecoder().decode(unb64(payload)),
    ) as Binding;
    return value.resource === resource &&
      value.purpose === purpose &&
      typeof value.nonce === "string" &&
      typeof value.consentId === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}
function unexpired(value: unknown) {
  const timestamp =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : NaN;
  return Number.isFinite(timestamp) && timestamp > Date.now();
}
const denied = () => new APIError("UNAUTHORIZED", { error: "invalid_grant" });
type Client = {
  id: string;
  clientId: string;
  clientSecret?: string;
  disabled?: boolean;
  type: string;
  name: string;
};
type Grant = {
  id: string;
  clientId: string;
  userId: string;
  scopes: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
};
type Consent = {
  id: string;
  clientId: string;
  userId: string;
  scopes: string;
  consentGiven: boolean;
};
const covers = (allowed: string, requested: string) =>
  requested
    .split(/\s+/)
    .filter(Boolean)
    .every((s) => new Set(allowed.split(/\s+/)).has(s));

/** Harden the pinned provider without changing its shared Better Auth schema.
 * Signed token envelopes bind opaque grants to a resource and consent record.
 * Pre-upgrade, unbound tokens deliberately require new authorization. */
export function isolateHomepageFromMcp(
  provider: ReturnType<typeof mcp>,
  homepageClientId: string,
  claimRefresh?: (tokenHash: string, expiresAt: number) => Promise<boolean>,
) {
  const resource = provider.options.resource!;
  return {
    ...provider,
    // Tasky's /oauth/login resumes authorization explicitly. The upstream login
    // hook bypasses this authorize wrapper and does not persist resource binding.
    hooks: undefined,
    endpoints: {
      ...provider.endpoints,
      mcpOAuthAuthorize: createAuthEndpoint(
        "/mcp/authorize",
        provider.endpoints.mcpOAuthAuthorize.options,
        async (ctx) => {
          if (
            ctx.query.resource !== undefined &&
            ctx.query.resource !== resource
          )
            throw new APIError("BAD_REQUEST", { error: "invalid_target" });
          if (ctx.query.client_id === homepageClientId) throw denied();
          if (
            ctx.query.code_challenge_method !== "S256" ||
            typeof ctx.query.code_challenge !== "string" ||
            !/^[\w-]{43}$/.test(ctx.query.code_challenge)
          )
            throw new APIError("BAD_REQUEST", {
              error: "invalid_request",
              error_description: "S256 PKCE is required",
            });
          // Always obtain fresh, explicit consent. Never let a requesting client
          // bypass journal consent with an omitted or manipulated prompt parameter.
          ctx.query.prompt = "consent";
          const response = await provider.endpoints.mcpOAuthAuthorize({
            ...ctx,
            asResponse: true,
          });
          let location = response.headers.get("location");
          if (!location && response.ok)
            location = (
              await response
                .clone()
                .json()
                .catch(() => null)
            )?.url;
          if (location) {
            const code = new URL(location).searchParams.get("consent_code");
            if (code) {
              const stored =
                await ctx.context.internalAdapter.findVerificationValue(code);
              if (!stored) throw denied();
              await ctx.context.internalAdapter.updateVerificationValue(
                stored.id,
                {
                  value: JSON.stringify({
                    ...JSON.parse(stored.value),
                    resource,
                  }),
                },
              );
            }
          }
          return response;
        },
      ),
      // Load canonical consent text with an authenticated session; URL scope and
      // client_name parameters are never authoritative UI permission descriptions.
      mcpConsentDetails: createAuthEndpoint(
        "/mcp/consent-details",
        { method: "GET", query: z.object({ code: z.string().max(256) }) },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          const stored =
            await ctx.context.internalAdapter.findVerificationValue(
              ctx.query.code,
            );
          if (!session || !stored || !unexpired(stored.expiresAt))
            throw denied();
          const value = JSON.parse(stored.value);
          if (value.userId !== session.user.id || !value.requireConsent)
            throw denied();
          const client = await ctx.context.adapter.findOne<Client>({
            model: "oauthApplication",
            where: [{ field: "clientId", value: value.clientId }],
          });
          const isHomepage = value.clientId === homepageClientId;
          if (
            !isHomepage &&
            (!client || client.disabled || value.resource !== resource)
          )
            throw denied();
          ctx.setHeader("Cache-Control", "private, no-store");
          return ctx.json({
            clientName: isHomepage ? "Tasky Homepage" : client!.name,
            scopes: value.scope,
            isHomepage,
          });
        },
      ),
      oAuthConsent: createAuthEndpoint(
        "/oauth2/consent",
        provider.endpoints.oAuthConsent.options,
        async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          const code =
            ctx.body.consent_code ||
            (await ctx.getSignedCookie(
              "oidc_consent_prompt",
              ctx.context.secret,
            ));
          const stored = code
            ? await ctx.context.internalAdapter.findVerificationValue(code)
            : null;
          if (!session || !stored || !unexpired(stored.expiresAt))
            throw denied();
          const value = JSON.parse(stored.value);
          if (
            value.userId !== session.user.id ||
            (value.clientId !== homepageClientId && value.resource !== resource)
          )
            throw denied();
          return provider.endpoints.oAuthConsent({ ...ctx, asResponse: true });
        },
      ),
      mcpOAuthToken: createAuthEndpoint(
        "/mcp/token",
        provider.endpoints.mcpOAuthToken.options,
        async (ctx) => {
          const field = (name: string): unknown =>
            ctx.body instanceof FormData
              ? ctx.body.getAll(name).at(-1)
              : ctx.body[name];
          const isRefresh = field("grant_type") === "refresh_token";
          const credential = field(isRefresh ? "refresh_token" : "code");
          if (typeof credential !== "string")
            throw new APIError("BAD_REQUEST", { error: "invalid_request" });
          if (field("resource") !== undefined && field("resource") !== resource)
            throw new APIError("BAD_REQUEST", { error: "invalid_target" });
          let oldGrant: Grant | null = null;
          let consent: Consent | null = null;
          let clientId: string;
          let userId: string;
          let scopes: string;
          if (isRefresh) {
            const binding = await verify(
              ctx.context.secret,
              credential,
              resource,
              "refresh",
            );
            if (!binding) throw denied();
            oldGrant = await ctx.context.adapter.findOne<Grant>({
              model: "oauthAccessToken",
              where: [{ field: "refreshToken", value: credential }],
            });
            if (!oldGrant || !unexpired(oldGrant.refreshTokenExpiresAt))
              throw denied();
            ({ clientId, userId, scopes } = oldGrant);
            consent = await ctx.context.adapter.findOne<Consent>({
              model: "oauthConsent",
              where: [{ field: "id", value: binding.consentId }],
            });
          } else {
            const stored =
              await ctx.context.internalAdapter.findVerificationValue(
                credential,
              );
            if (!stored || !unexpired(stored.expiresAt)) throw denied();
            const value = JSON.parse(stored.value);
            if (
              value.resource !== resource ||
              value.requireConsent ||
              value.codeChallengeMethod !== "S256"
            )
              throw denied();
            ({ clientId, userId } = value);
            scopes = value.scope.join(" ");
            const consents = await ctx.context.adapter.findMany<Consent>({
              model: "oauthConsent",
              where: [
                { field: "clientId", value: clientId },
                { field: "userId", value: userId },
              ],
            });
            consent =
              consents.find(
                (c) => c.consentGiven && covers(c.scopes, scopes),
              ) ?? null;
          }
          if (
            clientId === homepageClientId ||
            !consent?.consentGiven ||
            consent.clientId !== clientId ||
            consent.userId !== userId ||
            !covers(consent.scopes, scopes)
          )
            throw denied();
          const client = await ctx.context.adapter.findOne<Client>({
            model: "oauthApplication",
            where: [{ field: "clientId", value: clientId }],
          });
          const user = await ctx.context.adapter.findOne({
            model: "user",
            where: [{ field: "id", value: userId }],
          });
          if (!client || client.disabled || !user) throw denied();
          // The pinned refresh branch does not authenticate confidential clients.
          let requestedClient = field("client_id"),
            secret = field("client_secret");
          const authorization = ctx.headers?.get("authorization");
          if (authorization?.startsWith("Basic ")) {
            try {
              const decoded = atob(authorization.slice(6));
              const colon = decoded.indexOf(":");
              if (colon < 0) throw denied();
              requestedClient = decoded.slice(0, colon);
              secret = decoded.slice(colon + 1);
            } catch {
              throw denied();
            }
          }
          if (
            requestedClient !== clientId ||
            (client.type !== "public" && secret !== client.clientSecret)
          )
            throw denied();
          if (isRefresh && oldGrant) {
            if (!claimRefresh) throw denied();
            const tokenHash = b64(
              new Uint8Array(
                await crypto.subtle.digest("SHA-256", bytes.encode(credential)),
              ),
            );
            if (
              !(await claimRefresh(
                tokenHash,
                new Date(oldGrant.refreshTokenExpiresAt).getTime(),
              ))
            )
              throw denied();
          }
          const response = await provider.endpoints.mcpOAuthToken({
            ...ctx,
            asResponse: true,
          });
          if (!response.ok) return response;
          const issued = await response.json();
          const grant = await ctx.context.adapter.findOne<Grant>({
            model: "oauthAccessToken",
            where: [{ field: "accessToken", value: issued.access_token }],
          });
          if (!grant) throw denied();
          const accessToken = await bind(ctx.context.secret, {
            resource,
            purpose: "access",
            nonce: grant.accessToken,
            consentId: consent.id,
          });
          const refreshToken = await bind(ctx.context.secret, {
            resource,
            purpose: "refresh",
            nonce: grant.refreshToken,
            consentId: consent.id,
          });
          await ctx.context.adapter.update({
            model: "oauthAccessToken",
            where: [{ field: "id", value: grant.id }],
            update: { accessToken, refreshToken },
          });
          if (oldGrant)
            await ctx.context.adapter.delete({
              model: "oauthAccessToken",
              where: [{ field: "id", value: oldGrant.id }],
            });
          return new Response(
            JSON.stringify({
              ...issued,
              access_token: accessToken,
              ...(issued.refresh_token ? { refresh_token: refreshToken } : {}),
            }),
            {
              status: response.status,
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
                Pragma: "no-cache",
              },
            },
          );
        },
      ),
      getMcpSession: createAuthEndpoint(
        "/mcp/get-session",
        provider.endpoints.getMcpSession.options,
        async (ctx) => {
          ctx.setHeader("Cache-Control", "private, no-store");
          const authorization = ctx.headers?.get("authorization") ?? "";
          const token = /^Bearer ([^\s]+)$/i.exec(authorization)?.[1];
          const binding = await verify(
            ctx.context.secret,
            token,
            resource,
            "access",
          );
          if (!binding) return null;
          const grant = await ctx.context.adapter.findOne<Grant>({
            model: "oauthAccessToken",
            where: [{ field: "accessToken", value: token! }],
          });
          if (
            !grant ||
            grant.clientId === homepageClientId ||
            !unexpired(grant.accessTokenExpiresAt)
          )
            return null;
          const client = await ctx.context.adapter.findOne<Client>({
            model: "oauthApplication",
            where: [{ field: "clientId", value: grant.clientId }],
          });
          const user = await ctx.context.adapter.findOne({
            model: "user",
            where: [{ field: "id", value: grant.userId }],
          });
          const consent = await ctx.context.adapter.findOne<Consent>({
            model: "oauthConsent",
            where: [{ field: "id", value: binding.consentId }],
          });
          if (
            !client ||
            client.disabled ||
            !user ||
            !consent?.consentGiven ||
            consent.userId !== grant.userId ||
            consent.clientId !== grant.clientId ||
            !covers(consent.scopes, grant.scopes)
          )
            return null;
          // Never expose refresh credentials from the session/introspection route.
          return {
            userId: grant.userId,
            clientId: grant.clientId,
            scopes: grant.scopes,
            accessTokenExpiresAt: grant.accessTokenExpiresAt,
          };
        },
      ),
      mcpRevokeClient: createAuthEndpoint(
        "/mcp/revoke-client",
        { method: "POST", body: z.object({ clientId: z.string().max(256) }) },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          if (!session || ctx.body.clientId === homepageClientId)
            throw denied();
          // Delete consent first. Even a concurrent refresh cannot resurrect it;
          // all descendants remain bound to the deleted consent ID.
          const where = [
            { field: "userId", value: session.user.id },
            { field: "clientId", value: ctx.body.clientId },
          ];
          await ctx.context.adapter.deleteMany({
            model: "oauthConsent",
            where,
          });
          await ctx.context.adapter.deleteMany({
            model: "oauthAccessToken",
            where,
          });
          ctx.setHeader("Cache-Control", "private, no-store");
          return ctx.json({ revoked: true });
        },
      ),
    },
  };
}

export function withMcpAuth(
  auth: {
    api: {
      getMcpSession: (args: {
        headers: Headers;
      }) => Promise<{
        userId: string;
        clientId: string;
        scopes: string;
        accessTokenExpiresAt: Date;
      } | null>;
    };
  },
  handler: (
    req: Request,
    session: { userId: string; clientId: string; scopes: string },
  ) => Promise<Response>,
) {
  return async (req: Request) => {
    const session = await auth.api.getMcpSession({ headers: req.headers });
    if (!session)
      return Response.json(
        { error: "Unauthorized" },
        {
          status: 401,
          headers: {
            "Cache-Control": "private, no-store",
            "WWW-Authenticate": `Bearer resource_metadata="${new URL(req.url).origin}/.well-known/oauth-protected-resource"`,
          },
        },
      );
    const response = await handler(req, session);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };
}
