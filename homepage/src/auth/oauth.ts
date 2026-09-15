import * as oauth from "oauth4webapi";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { identitySchema } from "@tasky/home-feed";
import { origin, type Env } from "../env";
import type { Identity } from "./credentials";

// Pin the endpoints to Tasky's installed Better Auth 1.4.9 OIDC provider.
// Its general discovery route is overridden by the Convex auth plugin.
export function provider(env: Env): oauth.AuthorizationServer {
  const issuer = origin(env.TASKY_ISSUER);
  return {
    issuer,
    authorization_endpoint: `${issuer}/api/auth/oauth2/authorize`,
    token_endpoint: `${issuer}/api/auth/oauth2/token`,
    userinfo_endpoint: `${issuer}/api/auth/oauth2/userinfo`,
    jwks_uri: `${issuer}/api/auth/jwks`,
    code_challenge_methods_supported: ["S256"],
  };
}
export type LoginAttempt = {
  state: string;
  nonce: string;
  verifier: string;
  expiresAt: number;
};
export async function beginAuthorization(env: Env) {
  const attempt: LoginAttempt = {
    state: oauth.generateRandomState(),
    nonce: oauth.generateRandomNonce(),
    verifier: oauth.generateRandomCodeVerifier(),
    expiresAt: Date.now() + 600_000,
  };
  const url = new URL(provider(env).authorization_endpoint!);
  url.search = new URLSearchParams({
    client_id: env.OAUTH_CLIENT_ID,
    redirect_uri: `${origin(env.HOME_ORIGIN)}/auth/callback`,
    response_type: "code",
    scope: "openid profile email offline_access",
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge: await oauth.calculatePKCECodeChallenge(attempt.verifier),
    code_challenge_method: "S256",
  }).toString();
  return { attempt, url: url.toString() };
}
export async function exchangeCode(
  env: Env,
  callback: URL,
  attempt: LoginAttempt,
) {
  if (
    callback.origin !== origin(env.HOME_ORIGIN) ||
    callback.pathname !== "/auth/callback" ||
    attempt.expiresAt <= Date.now()
  )
    throw new Error("Invalid OAuth callback");
  const as = provider(env);
  const client = { client_id: env.OAUTH_CLIENT_ID };
  const params = oauth.validateAuthResponse(
    as,
    client,
    callback,
    attempt.state,
  );
  const response = await oauth.authorizationCodeGrantRequest(
    as,
    client,
    oauth.ClientSecretPost(env.OAUTH_CLIENT_SECRET),
    params,
    `${origin(env.HOME_ORIGIN)}/auth/callback`,
    attempt.verifier,
    { signal: AbortSignal.timeout(15_000) },
  );
  const tokens = await oauth.processAuthorizationCodeResponse(
    as,
    client,
    response,
    { expectedNonce: attempt.nonce, requireIdToken: true },
  );
  // oauth4webapi validates protocol claims; verify the ID token signature explicitly.
  const { payload } = await jwtVerify(
    tokens.id_token!,
    createRemoteJWKSet(new URL(as.jwks_uri!), { timeoutDuration: 10_000 }),
    {
      algorithms: ["RS256", "EdDSA", "ES256"],
      issuer: as.issuer,
      audience: client.client_id,
      requiredClaims: ["sub", "iat", "exp", "nonce"],
    },
  );
  if (
    payload.nonce !== attempt.nonce ||
    typeof tokens.refresh_token !== "string"
  )
    throw new Error("Missing identity or refresh grant");
  const identity: Identity = {
    userId: identitySchema.parse(payload.sub),
    displayName:
      typeof payload.name === "string" ? payload.name.slice(0, 80) : "Your",
    email: typeof payload.email === "string" ? payload.email : undefined,
    emailVerified: payload.email_verified === true,
  };
  return { identity, refreshToken: tokens.refresh_token };
}
export async function refreshGrant(
  env: Env,
  refreshToken: string,
  userId: string,
) {
  const as = provider(env);
  const client = { client_id: env.OAUTH_CLIENT_ID };
  const response = await oauth.refreshTokenGrantRequest(
    as,
    client,
    oauth.ClientSecretPost(env.OAUTH_CLIENT_SECRET),
    refreshToken,
    { signal: AbortSignal.timeout(15_000) },
  );
  const tokens = await oauth.processRefreshTokenResponse(as, client, response);
  // Better Auth 1.4.9 does not return an ID token on refresh. UserInfo binds the
  // refreshed grant to the original canonical subject and checks current access.
  const infoResponse = await oauth.userInfoRequest(
    as,
    client,
    tokens.access_token,
    { signal: AbortSignal.timeout(15_000) },
  );
  await oauth.processUserInfoResponse(as, client, userId, infoResponse);
  return tokens.refresh_token ?? refreshToken;
}
