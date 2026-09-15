import { env as bindings } from "cloudflare:workers";
import { reset, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import * as oauth from "oauth4webapi";
import { beginAuthorization, exchangeCode } from "../src/auth/oauth";
import {
  verifySession,
  REMEMBER_COOKIE,
  SESSION_COOKIE,
  LOGIN_COOKIE,
} from "../src/auth/credentials";
import { digest } from "../src/transport";
import { objectCall, type Env } from "../src/env";
import worker from "../src/index";

const env = bindings as unknown as Env;
afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});
async function issuerMock(
  nonce: string,
  options: {
    nonce?: string;
    issuer?: string;
    audience?: string;
    userId?: string;
    badSignature?: boolean;
    expired?: boolean;
  } = {},
) {
  const pair = await generateKeyPair("RS256");
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = "provider";
  jwk.alg = "RS256";
  const signing = options.badSignature
    ? (await generateKeyPair("RS256")).privateKey
    : pair.privateKey;
  const token = await new SignJWT({
    nonce: options.nonce ?? nonce,
    name: "Test reader",
    email: "reader@example.test",
    email_verified: true,
  })
    .setProtectedHeader({ alg: "RS256", kid: "provider" })
    .setSubject(options.userId ?? "user-a")
    .setIssuer(options.issuer ?? env.TASKY_ISSUER)
    .setAudience(options.audience ?? env.OAUTH_CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(options.expired ? "-1h" : "1h")
    .sign(signing);
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/api/auth/jwks")) return Response.json({ keys: [jwk] });
      if (url.endsWith("/api/auth/oauth2/token")) {
        const params = new URLSearchParams(String(init?.body));
        expect(params.get("client_id")).toBe(env.OAUTH_CLIENT_ID);
        expect(params.get("client_secret")).toBe(env.OAUTH_CLIENT_SECRET);
        return Response.json({
          access_token: "opaque-provider-access",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "private-refresh-credential",
          id_token: token,
        });
      }
      throw new Error("Unexpected upstream");
    });
  return network;
}
describe("OAuth and remembered grants", () => {
  it("uses S256, state, nonce, exact redirects and verifies the provider signature", async () => {
    const { attempt, url } = await beginAuthorization(env);
    const auth = new URL(url);
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.searchParams.get("code_challenge")).toBe(
      await oauth.calculatePKCECodeChallenge(attempt.verifier),
    );
    expect(auth.searchParams.get("redirect_uri")).toBe(
      `${env.HOME_ORIGIN}/auth/callback`,
    );
    const network = await issuerMock(attempt.nonce);
    const result = await exchangeCode(
      env,
      new URL(
        `${env.HOME_ORIGIN}/auth/callback?code=one-use-code&state=${attempt.state}`,
      ),
      attempt,
    );
    expect(result.identity.userId).toBe("user-a");
    const tokenCall = network.mock.calls.find(([input]) =>
      String(input).endsWith("/oauth2/token"),
    );
    expect(
      new URLSearchParams(String(tokenCall![1]!.body)).get("code_verifier"),
    ).toBe(attempt.verifier);
  });
  it("rejects state and redirect tampering before code exchange", async () => {
    const { attempt } = await beginAuthorization(env);
    const network = vi.spyOn(globalThis, "fetch");
    for (const url of [
      `${env.HOME_ORIGIN}/auth/callback?code=x&state=wrong`,
      `https://evil.test/auth/callback?code=x&state=${attempt.state}`,
      `${env.HOME_ORIGIN}/wrong?code=x&state=${attempt.state}`,
    ]) {
      await expect(exchangeCode(env, new URL(url), attempt)).rejects.toThrow();
    }
    expect(network).not.toHaveBeenCalled();
  });
  it.each([
    { nonce: "wrong" },
    { issuer: "https://evil.test" },
    { audience: "mcp-resource" },
    { badSignature: true },
    { expired: true },
  ])("rejects invalid provider tokens: %o", async (options) => {
    const { attempt } = await beginAuthorization(env);
    await issuerMock(attempt.nonce, options);
    await expect(
      exchangeCode(
        env,
        new URL(
          `${env.HOME_ORIGIN}/auth/callback?code=x&state=${attempt.state}`,
        ),
        attempt,
      ),
    ).rejects.toThrow();
  });
  it("completes login, enrolls the verified subject, and makes callback state single use", async () => {
    const login = await worker.fetch(
      new Request(`${env.HOME_ORIGIN}/auth/login`),
      env,
    );
    const authorization = new URL(login.headers.get("location")!);
    const loginCookie = login.headers
      .getSetCookie()
      .find((value) => value.startsWith(LOGIN_COOKIE))!
      .split(";")[0];
    await issuerMock(authorization.searchParams.get("nonce")!);
    const callback = new Request(
      `${env.HOME_ORIGIN}/auth/callback?code=once&state=${authorization.searchParams.get("state")}&userId=user-b`,
      { headers: { cookie: loginCookie } },
    );
    const response = await worker.fetch(callback, env);
    expect(response.status).toBe(303);
    const sessionCookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith(SESSION_COOKIE))!
      .split(";")[0]
      .slice(SESSION_COOKIE.length + 1);
    expect((await verifySession(env, sessionCookie))!.userId).toBe("user-a");
    expect(
      await objectCall(env.PUBLISHERS, "user-a", "/status", {}),
    ).toMatchObject({ userId: "user-a", state: "preparing" });
    expect((await worker.fetch(callback, env)).status).toBe(401);
  });
  it("encrypts refresh credentials, renews only via the provider, and revokes remembered grants", async () => {
    const remember = "A".repeat(43);
    const sid = await digest(remember);
    const sessionStub = env.SESSIONS.get(env.SESSIONS.idFromName(sid));
    const { token } = await objectCall<{ token: string }>(
      env.SESSIONS,
      sid,
      "/remember",
      {
        sid,
        identity: { userId: "user-a", displayName: "Test" },
        refreshToken: "private-refresh-credential",
      },
    );
    const stored = await runInDurableObject(sessionStub, (_instance, state) =>
      state.storage.get("grant"),
    );
    expect(JSON.stringify(stored)).not.toContain("private-refresh-credential");
    const network = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        if (String(input).endsWith("/oauth2/token"))
          return Response.json({
            access_token: "refreshed-access",
            refresh_token: "rotated-refresh",
            token_type: "Bearer",
            expires_in: 3600,
          });
        if (String(input).endsWith("/oauth2/userinfo"))
          return Response.json({ sub: "user-a" });
        throw new Error("Unexpected upstream");
      });
    const renew = new Request(`${env.HOME_ORIGIN}/auth/renew`, {
      method: "POST",
      headers: {
        origin: env.HOME_ORIGIN,
        accept: "application/json",
        cookie: `${REMEMBER_COOKIE}=${remember}`,
      },
    });
    expect((await worker.fetch(renew, env)).status).toBe(200);
    expect(network).toHaveBeenCalledTimes(2);
    const logout = await worker.fetch(
      new Request(`${env.HOME_ORIGIN}/auth/logout`, {
        method: "POST",
        headers: {
          origin: env.HOME_ORIGIN,
          cookie: `${REMEMBER_COOKIE}=${remember}; ${SESSION_COOKIE}=${token}`,
        },
      }),
      env,
    );
    expect(logout.status).toBe(200);
    expect(logout.headers.getSetCookie()).toHaveLength(3);
    expect((await worker.fetch(renew, env)).status).toBe(401);
    // Documented local-token revocation window: already-issued tokens retain expiry.
    expect(await verifySession(env, token)).not.toBeNull();
  });
});
