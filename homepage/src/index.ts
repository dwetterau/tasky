import {
  editionSchema,
  exportSchema,
  LIMITS,
  withFreshness,
  type Edition,
} from "@tasky/home-feed";
import {
  HttpError,
  objectCall,
  origin,
  sessionLifetime,
  allowed,
  type Env,
} from "./env";
import { digest, limitedBody, randomToken, verifyRequest } from "./transport";
import {
  cookie,
  readCookie,
  verifySession,
  SESSION_COOKIE,
  REMEMBER_COOKIE,
  LOGIN_COOKIE,
  REMEMBER_SECONDS,
} from "./auth/credentials";
import {
  beginAuthorization,
  exchangeCode,
  type LoginAttempt,
} from "./auth/oauth";
import { browserScript, freshnessBanner, shell } from "./rendering/page";

export { UserPublisher } from "./publishing/publisher";
export { HomepageSession } from "./auth/session-object";
export { Coordinator } from "./ingestion/coordinator";

function privateResponse(
  body: BodyInit | null,
  status = 200,
  type = "text/html; charset=utf-8",
  extra?: HeadersInit,
) {
  const headers = new Headers(extra);
  headers.set("content-type", type);
  headers.set("cache-control", "private, no-store");
  headers.set(
    "content-security-policy",
    "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  headers.set("x-content-type-options", "nosniff");
  // Same-origin forms need an Origin header for CSRF validation.
  headers.set("referrer-policy", "same-origin");
  headers.set("permissions-policy", "geolocation=(), camera=(), microphone=()");
  headers.set("strict-transport-security", "max-age=31536000");
  headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(body, { status, headers });
}
function redirect(path: string, cookies: string[] = []) {
  const headers = new Headers({ location: path });
  for (const value of cookies) headers.append("set-cookie", value);
  return privateResponse(null, 303, "text/html", headers);
}
function json(value: unknown, status = 200, headers?: HeadersInit) {
  return privateResponse(
    JSON.stringify(value),
    status,
    "application/json; charset=utf-8",
    headers,
  );
}
function csrf(request: Request, env: Env) {
  if (
    request.headers.get("origin") !== origin(env.HOME_ORIGIN) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new HttpError(403, "Request origin not allowed");
}
function handle(value?: string) {
  return value && /^[\w-]{43}$/.test(value) ? value : undefined;
}
function preparing() {
  return shell(
    '<main class="preparation"><p class="eyebrow">Getting things ready</p><h2>Your first edition is on its way.</h2><p>We’re gathering a private summary from Tasky. This usually takes a minute or two. This page will check for updates automatically.</p><p><a href="/">Check again</a> · <a href="/api/setup">View setup status</a></p><noscript><p>JavaScript is off. Use “Check again” to load your edition.</p></noscript></main>',
    { script: true },
  );
}

export async function handleRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  // Aliases are rejected rather than inadvertently becoming alternative login origins.
  if (url.origin !== origin(env.HOME_ORIGIN))
    return privateResponse("Unknown homepage host", 421, "text/plain");
  if (request.method === "GET" && url.pathname === "/assets/home.js")
    return privateResponse(
      browserScript,
      200,
      "text/javascript; charset=utf-8",
    );
  if (request.method === "POST" && url.pathname === "/internal/tasky") {
    const body = await limitedBody(request, LIMITS.bytes);
    if (!(await verifyRequest(request, body, env.INGESTION_SECRET)))
      return json({ error: "Unauthorized ingestion" }, 401);
    const parsed = exportSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return json({ error: "Invalid export" }, 400);
    const result = await objectCall(
      env.PUBLISHERS,
      parsed.data.userId,
      "/accept-tasky",
      { body },
    );
    return json(result, 202);
  }
  if (request.method === "GET" && url.pathname === "/auth/sign-in") {
    return privateResponse(
      shell(
        `<main class="preparation">
          <h2>Sign in to Tasky Homepage</h2>
          <p>Connect your Tasky account to open your private edition.</p>
          <p><a href="/auth/login">Sign in with Tasky →</a></p>
        </main>`,
        { showSignOut: false },
      ),
    );
  }
  if (request.method === "GET" && url.pathname === "/auth/login") {
    const { attempt, url: authorizationUrl } = await beginAuthorization(env);
    const browserHandle = randomToken();
    await objectCall(
      env.SESSIONS,
      `login:${await digest(browserHandle)}`,
      "/begin",
      attempt,
    );
    return redirect(authorizationUrl, [
      cookie(LOGIN_COOKIE, browserHandle, 600),
    ]);
  }
  if (request.method === "GET" && url.pathname === "/auth/error") {
    return privateResponse(
      shell(
        '<main class="preparation"><h2>We couldn’t finish signing you in.</h2><p>Please start again to connect your Tasky account to Tasky Homepage.</p><p><a href="/auth/login">Sign in to Tasky Homepage</a></p></main>',
        { showSignOut: false },
      ),
      401,
    );
  }
  if (request.method === "GET" && url.pathname === "/auth/callback") {
    const loginHandle = handle(readCookie(request, LOGIN_COOKIE));
    if (!loginHandle || !url.searchParams.get("state"))
      throw new HttpError(401, "Login expired. Start again.");
    const attempt = await objectCall<LoginAttempt>(
      env.SESSIONS,
      `login:${await digest(loginHandle)}`,
      "/consume",
      { state: url.searchParams.get("state") },
    );
    const { identity, refreshToken } = await exchangeCode(env, url, attempt);
    if (!allowed(env, identity.userId, identity.email, identity.emailVerified))
      throw new HttpError(
        403,
        "This account is not on the homepage allowlist.",
      );
    const remember = randomToken();
    const sid = await digest(remember);
    await objectCall(env.PUBLISHERS, identity.userId, "/enroll", {
      userId: identity.userId,
      displayName: identity.displayName,
      timezone: env.DEFAULT_TIMEZONE,
    });
    await objectCall(env.COORDINATOR, "users", "/enroll", {
      userId: identity.userId,
    });
    const { token } = await objectCall<{ token: string }>(
      env.SESSIONS,
      sid,
      "/remember",
      { sid, identity, refreshToken },
    );
    return redirect("/", [
      cookie(LOGIN_COOKIE, "", 0),
      cookie(REMEMBER_COOKIE, remember, REMEMBER_SECONDS),
      cookie(SESSION_COOKIE, token, sessionLifetime(env)),
    ]);
  }
  if (request.method === "GET" && url.pathname === "/auth/renew") {
    if (!handle(readCookie(request, REMEMBER_COOKIE)))
      return redirect("/auth/sign-in");
    return privateResponse(
      shell(
        '<main class="preparation"><p class="eyebrow">Welcome back</p><h2>Continue to your private edition.</h2><p>Your homepage session needs to be renewed before your information can be shown.</p><form action="/auth/renew" method="post"><button>Continue securely →</button></form><p><a href="/auth/login">Sign in with Tasky again</a></p></main>',
      ),
    );
  }
  if (request.method === "POST" && url.pathname === "/auth/renew") {
    csrf(request, env);
    const remember = handle(readCookie(request, REMEMBER_COOKIE));
    if (!remember)
      return request.headers.get("accept") === "application/json"
        ? json({ error: "Sign in again" }, 401)
        : redirect("/auth/sign-in");
    try {
      const { token } = await objectCall<{ token: string }>(
        env.SESSIONS,
        await digest(remember),
        "/renew",
        {},
      );
      const cookies = [cookie(SESSION_COOKIE, token, sessionLifetime(env))];
      if (request.headers.get("accept") === "application/json")
        return json(
          {
            renewed: true,
            renewAt:
              Date.now() +
              (sessionLifetime(env) -
                Math.min(300, sessionLifetime(env) / 10)) *
                1000,
          },
          200,
          { "set-cookie": cookies[0] },
        );
      return redirect("/", cookies);
    } catch {
      const cookies = [
        cookie(SESSION_COOKIE, "", 0),
        cookie(REMEMBER_COOKIE, "", 0),
      ];
      if (request.headers.get("accept") === "application/json") {
        const response = json({ error: "Sign in again" }, 401);
        cookies.forEach((value) =>
          response.headers.append("set-cookie", value),
        );
        return response;
      }
      return redirect("/auth/sign-in", cookies);
    }
  }
  if (request.method === "POST" && url.pathname === "/auth/logout") {
    csrf(request, env);
    const remember = handle(readCookie(request, REMEMBER_COOKIE));
    const session = await verifySession(
      env,
      readCookie(request, SESSION_COOKIE),
    );
    const ids = new Set(
      [remember ? await digest(remember) : undefined, session?.sid].filter(
        (id): id is string => !!id,
      ),
    );
    for (const sid of ids) await objectCall(env.SESSIONS, sid, "/revoke", {});
    return redirect("/auth/sign-in", [
      cookie(SESSION_COOKIE, "", 0),
      cookie(REMEMBER_COOKIE, "", 0),
      cookie(LOGIN_COOKIE, "", 0),
    ]);
  }
  if (request.method !== "GET")
    return json({ error: "Method not allowed" }, 405);
  if (
    !["/", "/api/edition", "/api/status", "/api/setup"].includes(url.pathname)
  )
    return json({ error: "Not found" }, 404);
  const start = performance.now();
  const session = await verifySession(env, readCookie(request, SESSION_COOKIE));
  const authMs = performance.now() - start;
  if (!session) {
    if (url.pathname !== "/") return json({ error: "Sign in required" }, 401);
    return redirect(
      handle(readCookie(request, REMEMBER_COOKIE))
        ? "/auth/renew"
        : "/auth/sign-in",
    );
  }
  // Setup diagnostics are explicitly a slower path and never choose a URL userId.
  if (url.pathname === "/api/setup")
    return json(
      await objectCall(env.PUBLISHERS, session.userId, "/status", {}),
    );
  const kvStart = performance.now();
  const raw = await env.EDITIONS.get(`edition:${session.userId}`, "json");
  const kvMs = performance.now() - kvStart;
  const headers = new Headers({
    "server-timing": `auth;dur=${authMs.toFixed(2)}, kv;dur=${kvMs.toFixed(2)}`,
  });
  if (!raw)
    return url.pathname === "/"
      ? privateResponse(preparing(), 202, "text/html; charset=utf-8", headers)
      : json({ status: "preparing", feed: null }, 202, headers);
  const parsed = editionSchema.safeParse(raw);
  if (!parsed.success || parsed.data.feed.userId !== session.userId)
    throw new HttpError(503, "Your edition is temporarily unavailable.");
  const edition: Edition = parsed.data;
  headers.set("x-edition-revision", String(edition.feed.revision));
  const source = edition.feed.modules.find((m) => m.id === "tasky");
  headers.set(
    "x-snapshot-age-ms",
    String(
      source?.sourceDataAt ? Math.max(0, Date.now() - source.sourceDataAt) : -1,
    ),
  );
  if (url.pathname === "/api/status")
    return json(
      {
        status: source?.payload ? "ready" : "preparing",
        revision: edition.feed.revision,
        publishedAt: edition.feed.publishedAt,
      },
      200,
      headers,
    );
  if (url.pathname === "/api/edition")
    return json(
      {
        feed: edition.feed,
        delivery: {
          checkedAt: Date.now(),
          modules: edition.feed.modules.map((m) => ({
            id: m.id,
            status: withFreshness(m, Date.now()).status,
          })),
        },
      },
      200,
      headers,
    );
  if (!source?.payload)
    return privateResponse(
      preparing(),
      202,
      "text/html; charset=utf-8",
      headers,
    );
  const banner = freshnessBanner(edition.feed, Date.now());
  const html = edition.html
    .replace("<!--FRESHNESS-->", banner)
    .replace(
      "<!--RENEW_AT-->",
      String(
        session.exp * 1000 - Math.min(300, sessionLifetime(env) / 10) * 1000,
      ),
    );
  return privateResponse(html, 200, "text/html; charset=utf-8", headers);
}

export default {
  async fetch(request: Request, env: Env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      const status =
        error instanceof HttpError
          ? error.status
          : error instanceof SyntaxError
            ? 400
            : 503;
      // Coarse operational codes only. OAuth URLs, tokens, and source content are private.
      console.warn(
        JSON.stringify({ event: "homepage_request_failed", status }),
      );
      if (new URL(request.url).pathname === "/auth/callback") {
        // Never leave an authorization code in the address bar after failure.
        return redirect("/auth/error", [cookie(LOGIN_COOKIE, "", 0)]);
      }
      const heading =
        status === 403
          ? "This request was not allowed. Reload the homepage and try again."
          : status === 401
            ? "Please sign in again."
            : "Your homepage is temporarily unavailable.";
      return privateResponse(
        shell(
          `<main class="preparation">
            <h2>${heading}</h2>
            <p><a href="/auth/sign-in">Sign in</a> · <a href="/">Try again</a></p>
          </main>`,
        ),
        status,
      );
    }
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      objectCall(env.COORDINATOR, "users", "/tick", {}).catch(() => {
        console.warn(JSON.stringify({ event: "homepage_schedule_retry" }));
      }),
    );
  },
} satisfies ExportedHandler<Env>;
