import { expect, it } from "vitest";
import {
  oauthApplicationName,
  oauthAuthorizeUrl,
  signInCallbackUrl,
} from "./oauth";

it("preserves the homepage transaction through GitHub sign-in and removes used callback metadata", () => {
  const query = new URLSearchParams({
    flow: "homepage",
    client_id: "configured-client",
    redirect_uri: "https://home.example.test/auth/callback",
    state: "transaction-state",
    nonce: "transaction-nonce",
    code_challenge: "s256-challenge",
    code_challenge_method: "S256",
    scope: "openid profile email offline_access",
  });
  const current = new URL(`https://tasky.example.test/oauth/login?${query}`);
  current.searchParams.set("ott", "consumed-sign-in-token");
  current.searchParams.set("error", "previous-error");
  const callback = new URL(signInCallbackUrl(current.toString()));
  expect(callback.pathname).toBe("/oauth/login");
  expect(callback.searchParams.toString()).toBe(query.toString());
  const authorize = new URL(
    oauthAuthorizeUrl("https://issuer.example.test", callback.search)!,
  );
  expect(authorize.pathname).toBe("/api/auth/oauth2/authorize");
  query.delete("flow");
  expect(authorize.searchParams.toString()).toBe(query.toString());
});

it("preserves consent after signing back in and names the homepage", () => {
  const url =
    "https://tasky.example.test/oauth/consent?flow=homepage&consent_code=consent-transaction&client_id=configured-client";
  const callback = new URL(signInCallbackUrl(url));
  expect(callback.searchParams.get("consent_code")).toBe("consent-transaction");
  expect(oauthApplicationName(callback.searchParams)).toBe("Tasky Homepage");
});

it("keeps other clients on MCP and rejects incomplete continuation URLs", () => {
  const url = oauthAuthorizeUrl(
    "https://issuer.example.test",
    "client_id=mcp-client&redirect_uri=https://client.example.test/callback",
  );
  expect(new URL(url!).pathname).toBe("/api/auth/mcp/authorize");
  expect(
    oauthAuthorizeUrl("https://issuer.example.test", "flow=homepage"),
  ).toBeNull();
});
