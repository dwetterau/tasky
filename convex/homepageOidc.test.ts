// @vitest-environment node
import { expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import { jwt, mcp, withMcpAuth } from "better-auth/plugins";
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify } from "jose";
import { symmetricEncrypt } from "better-auth/crypto";
import { homepageOidc } from "./lib/homepageOidc";
import { isolateHomepageFromMcp } from "./lib/mcp";

const issuer = "https://issuer.example.test";
const home = "https://home.example.test";
const front = "https://tasky.example.test";
const clientId = "tasky-homepage";
const clientSecret = "fixture-homepage-secret-at-least-32-characters";
const scope = "openid profile email offline_access";
const verifier = "fixture-pkce-verifier-at-least-forty-three-characters-long";

function createAuth(db: MemoryDB, homepageEnabled = true) {
  return betterAuth({
    baseURL: issuer,
    secret: "fixture-better-auth-secret-at-least-32-characters",
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    trustedOrigins: [issuer, front],
    logger: { disabled: true },
    plugins: [
      jwt({
        jwks: { keyPairConfig: { alg: "RS256" } },
        jwt: { issuer, audience: `${issuer}/api/mcp` },
        disableSettingJwtHeader: true,
      }),
      isolateHomepageFromMcp(
        mcp({
          loginPage: `${front}/oauth/login`,
          resource: `${issuer}/api/mcp`,
          oidcConfig: {
            loginPage: `${front}/oauth/login`,
            consentPage: `${front}/oauth/consent`,
            scopes: ["tasks:read", "tasks:write"],
          },
        }),
        clientId,
      ),
      ...(homepageEnabled
        ? [
            homepageOidc({
              origin: home,
              clientId,
              clientSecret,
              loginPage: `${front}/oauth/login`,
              consentPage: `${front}/oauth/consent`,
            }),
          ]
        : []),
    ],
  });
}
type Auth = ReturnType<typeof createAuth>;
type Tokens = {
  access_token: string;
  refresh_token: string;
  id_token: string;
  scope: string;
};

async function fixture() {
  const db: MemoryDB = {
    user: [],
    session: [],
    account: [],
    verification: [],
    jwks: [],
    oauthApplication: [],
    oauthAccessToken: [],
    oauthConsent: [],
  };
  const auth = createAuth(db);
  const signup = await auth.handler(
    new Request(`${issuer}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: issuer },
      body: JSON.stringify({
        name: "Fixture User",
        email: "fixture@example.test",
        password: "fixture-password-only-12345",
      }),
    }),
  );
  expect(signup.status).toBe(200);
  const account = await signup.json();
  const cookies = signup.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const challenge = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  ).toString("base64url");
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${home}/auth/callback`,
    response_type: "code",
    scope,
    state: "fixture-state",
    nonce: "fixture-nonce",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return { auth, db, account, cookies, query };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

it("signs homepage identity with an existing Convex RSA key without stored algorithm metadata", async () => {
  const f = await fixture();
  const pair = await generateKeyPair("RS256", { extractable: true });
  // The Convex component stores the key material but its schema omits `alg`.
  f.db.jwks.push({
    id: "existing-convex-key",
    publicKey: JSON.stringify(await exportJWK(pair.publicKey)),
    privateKey: JSON.stringify(
      await symmetricEncrypt({
        key: "fixture-better-auth-secret-at-least-32-characters",
        data: JSON.stringify(await exportJWK(pair.privateKey)),
      }),
    ),
    createdAt: new Date(),
  });
  const issued = await homepageTokens(f);
  const keys = await (
    await f.auth.handler(new Request(`${issuer}/api/auth/jwks`))
  ).json();
  const verified = await jwtVerify(issued.id_token, createLocalJWKSet(keys), {
    issuer,
    audience: clientId,
    algorithms: ["RS256"],
  });
  expect(verified.payload.sub).toBe(f.account.user.id);
});

async function authorizationCode(
  f: Fixture,
  route = "oauth2",
  query = f.query,
) {
  const response = await f.auth.handler(
    new Request(`${issuer}/api/auth/${route}/authorize?${query}`, {
      headers: { cookie: f.cookies },
    }),
  );
  expect(response.status).toBe(302);
  const consentUrl = new URL(response.headers.get("location")!);
  expect(consentUrl.origin + consentUrl.pathname).toBe(
    `${front}/oauth/consent`,
  );
  if (route === "oauth2") {
    expect(consentUrl.searchParams.get("client_name")).toBe("Tasky Homepage");
    expect(consentUrl.searchParams.get("flow")).toBe("homepage");
  }
  const consent = await f.auth.handler(
    new Request(`${issuer}/api/auth/oauth2/consent`, {
      method: "POST",
      headers: {
        cookie: f.cookies,
        origin: issuer,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        accept: true,
        consent_code: consentUrl.searchParams.get("consent_code"),
      }),
    }),
  );
  expect(consent.status).toBe(200);
  const callback = new URL((await consent.json()).redirectURI);
  expect(callback.searchParams.get("state")).toBe("fixture-state");
  return callback.searchParams.get("code")!;
}
function codeBody(code: string) {
  return new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: `${home}/auth/callback`,
    code_verifier: verifier,
  });
}
function token(
  auth: Auth,
  body: URLSearchParams,
  route = "oauth2",
  headers: Record<string, string> = {},
) {
  return auth.handler(
    new Request(`${issuer}/api/auth/${route}/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body,
    }),
  );
}
async function homepageTokens(f: Fixture) {
  const response = await token(f.auth, codeBody(await authorizationCode(f)));
  expect(response.status).toBe(200);
  return (await response.json()) as Tokens;
}
function userInfo(auth: Auth, accessToken: string) {
  return auth.handler(
    new Request(`${issuer}/api/auth/oauth2/userinfo`, {
      headers: { authorization: `Bearer ${accessToken}` },
    }),
  );
}

it("keeps homepage login, signed identity, single-use codes, confidential renewal and UserInfo working", async () => {
  const f = await fixture();
  const initial = await f.auth.handler(
    new Request(`${issuer}/api/auth/oauth2/authorize?${f.query}`),
  );
  expect(initial.status).toBe(302);
  expect(initial.headers.get("location")).toBe(
    `${front}/oauth/login?${f.query}&flow=homepage`,
  );
  expect(initial.headers.get("set-cookie") ?? "").not.toContain(
    "oidc_login_prompt",
  );
  const body = codeBody(await authorizationCode(f));
  const issued = await token(f.auth, body);
  expect(issued.status).toBe(200);
  const tokens = (await issued.json()) as Tokens;
  expect(tokens).toHaveProperty("id_token", expect.any(String));
  expect(tokens.scope).toBe(scope);
  const keys = await (
    await f.auth.handler(new Request(`${issuer}/api/auth/jwks`))
  ).json();
  const { payload } = await jwtVerify(
    tokens.id_token,
    createLocalJWKSet(keys),
    { issuer, audience: clientId },
  );
  expect(payload.sub).toBe(f.account.user.id);
  expect(payload.nonce).toBe("fixture-nonce");
  expect((await token(f.auth, body)).status).toBe(401);
  const refresh = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });
  expect((await token(f.auth, refresh)).status).toBe(401);
  refresh.set("client_secret", "wrong");
  expect((await token(f.auth, refresh)).status).toBe(401);
  refresh.set("client_secret", clientSecret);
  const renewed = await token(f.auth, refresh);
  expect(renewed.status).toBe(200);
  const refreshed = (await renewed.json()) as Tokens;
  expect(refreshed.scope).toBe(scope);
  const info = await userInfo(f.auth, refreshed.access_token);
  expect(info.status).toBe(200);
  expect(await info.json()).toMatchObject({
    sub: f.account.user.id,
    email: "fixture@example.test",
    name: "Fixture User",
  });
});

it.each([
  "form",
  "wrong-secret",
  "correct-secret",
  "basic",
  "json",
  "json-client-array",
  "different-client",
  "missing-client",
])(
  "rejects homepage refresh at MCP (%s) without issuing or modifying grants",
  async (encoding) => {
    const f = await fixture();
    const issued = await homepageTokens(f);
    const before = structuredClone(f.db.oauthAccessToken);
    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: issued.refresh_token,
    });
    const headers: Record<string, string> = {};
    if (encoding === "wrong-secret") body.set("client_secret", "wrong");
    if (encoding === "correct-secret") body.set("client_secret", clientSecret);
    if (encoding === "different-client")
      body.set("client_id", "another-client");
    if (encoding === "missing-client" || encoding === "basic")
      body.delete("client_id");
    if (encoding === "basic")
      headers.authorization = `Basic ${Buffer.from(`${clientId}:wrong`).toString("base64")}`;
    const json = encoding.startsWith("json");
    const response = json
      ? await f.auth.handler(
          new Request(`${issuer}/api/auth/mcp/token`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ...Object.fromEntries(body),
              ...(encoding === "json-client-array"
                ? { client_id: [clientId] }
                : {}),
            }),
          }),
        )
      : await token(f.auth, body, "mcp", headers);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_grant" });
    expect(f.db.oauthAccessToken).toEqual(before);
    // A rejected cross-endpoint attempt must not break legitimate renewal.
    const renewal = await token(
      f.auth,
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: issued.refresh_token,
      }),
    );
    expect(renewal.status).toBe(200);
    const info = await userInfo(f.auth, (await renewal.json()).access_token);
    expect((await info.json()).sub).toBe(f.account.user.id);
  },
);

it("rejects coercible JSON refresh credentials at MCP", async () => {
  const f = await fixture();
  const issued = await homepageTokens(f);
  const before = structuredClone(f.db.oauthAccessToken);
  const response = await f.auth.handler(
    new Request(`${issuer}/api/auth/mcp/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: [issued.refresh_token],
      }),
    }),
  );
  expect(response.status).toBe(400);
  expect(f.db.oauthAccessToken).toEqual(before);
});

it.each([clientId, "another-client"])(
  "rejects homepage codes at MCP before consuming them (claimed client %s)",
  async (claimedClient) => {
    const f = await fixture();
    const body = codeBody(await authorizationCode(f));
    const crossBody = new URLSearchParams(body);
    crossBody.set("client_id", claimedClient);
    crossBody.delete("client_secret");
    const response = await token(f.auth, crossBody, "mcp");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_grant" });
    expect(f.db.oauthAccessToken).toHaveLength(0);
    // MCP's unguarded code branch consumed shared codes before checking clients.
    expect((await token(f.auth, body)).status).toBe(200);
  },
);

it("does not expose homepage grant records or authenticate homepage access tokens through MCP", async () => {
  const f = await fixture();
  const issued = await homepageTokens(f);
  const headers = new Headers({
    authorization: `Bearer ${issued.access_token}`,
  });
  const response = await f.auth.handler(
    new Request(`${issuer}/api/auth/mcp/get-session`, { headers }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toBeNull();
  expect(await f.auth.api.getMcpSession({ headers })).toBeNull();
  const handler = vi.fn(async () => Response.json({ reached: true }));
  const protectedResponse = await withMcpAuth(
    f.auth,
    handler,
  )(new Request(`${issuer}/api/mcp`, { headers }));
  expect(protectedResponse.status).toBe(401);
  expect(handler).not.toHaveBeenCalled();
  expect((await userInfo(f.auth, issued.access_token)).status).toBe(200);
});

it("keeps existing homepage grants blocked when homepage OIDC is disabled", async () => {
  const f = await fixture();
  const issued = await homepageTokens(f);
  const disabled = createAuth(f.db, false);
  const response = await token(
    disabled,
    new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: issued.refresh_token,
    }),
    "mcp",
  );
  expect(response.status).toBe(401);
  expect(
    await disabled.api.getMcpSession({
      headers: new Headers({ authorization: `Bearer ${issued.access_token}` }),
    }),
  ).toBeNull();
});

it.each(["none", "client_secret_basic"] as const)(
  "preserves normal MCP registration, code exchange, refresh and resource access (%s)",
  async (method) => {
    const f = await fixture();
    const callback = "https://mcp.example.test/callback";
    const registered = await f.auth.handler(
      new Request(`${issuer}/api/auth/mcp/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Fixture MCP",
          redirect_uris: [callback],
          token_endpoint_auth_method: method,
          grant_types: ["authorization_code", "refresh_token"],
        }),
      }),
    );
    expect(registered.status).toBe(201);
    const client = await registered.json();
    const query = new URLSearchParams(f.query);
    query.set("client_id", client.client_id);
    query.set("redirect_uri", callback);
    query.set("scope", "openid offline_access tasks:read");
    query.set("prompt", "consent");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: await authorizationCode(f, "mcp", query),
      redirect_uri: callback,
      code_verifier: verifier,
    });
    const headers: Record<string, string> = {};
    if (method === "none") body.set("client_id", client.client_id);
    else
      headers.authorization = `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString("base64")}`;
    const response = await token(f.auth, body, "mcp", headers);
    expect(response.status).toBe(200);
    const issued = (await response.json()) as Tokens;
    const refresh = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: issued.refresh_token,
    });
    if (method === "none") refresh.set("client_id", client.client_id);
    const renewed = await token(f.auth, refresh, "mcp", headers);
    expect(renewed.status).toBe(200);
    const refreshed = (await renewed.json()) as Tokens;
    expect(refreshed.scope).toBe("openid offline_access tasks:read");
    const bearer = new Headers({
      authorization: `Bearer ${refreshed.access_token}`,
    });
    const session = await f.auth.api.getMcpSession({ headers: bearer });
    expect(session).toMatchObject({
      clientId: client.client_id,
      userId: f.account.user.id,
      scopes: "openid offline_access tasks:read",
    });
    const protectedResponse = await withMcpAuth(
      f.auth,
      async (_request, grant) => Response.json({ userId: grant.userId }),
    )(new Request(`${issuer}/api/mcp`, { headers: bearer }));
    expect(protectedResponse.status).toBe(200);
    expect(await protectedResponse.json()).toEqual({
      userId: f.account.user.id,
    });
  },
);
