# Tasky homepage

A private, pre-rendered homepage at `https://home.davidw.tech`, backed by a
Cloudflare Worker. Signed-in page loads verify a local session and read one
user-specific KV entry; they do not call Convex or weather providers.

## Development

```sh
cd homepage
npm ci
npm test
npm run typecheck
npm run build
```

This package builds separately from Next.js. Tests use isolated Cloudflare
bindings and fictional data from `tests/fixtures.ts`.

## Structure

- `../packages/home-feed`: versioned feed schemas, timezone calculations and text
  normalization shared with Convex.
- `../convex/homepage.ts`: enrollment, Tasky exports, delivery retries and access
  to the enrolled user's weather key.
- `src/auth`: OAuth login, signed sessions and encrypted refresh credentials.
- `src/publishing`: a Durable Object per user assembles HTML and JSON into one KV
  entry, preserving the last successful edition when updates fail.
- `src/modules`: source collectors, validation, rendering and freshness policies.
- `src/ingestion`: Tasky delivery and background scheduling.
- `gateway`: Cloudflare Pages forwards the custom hostname to the private Worker
  through a service binding. DNS remains at Squarespace.

To add sports or another source, define its payload in `packages/home-feed`, add
its renderer to `src/modules/registry.ts`, and register any polling collector in
`src/modules/background.ts`. Authentication and page delivery stay shared.

## Tasky updates

Tasky exports every **10 minutes** after a successful delivery. The first export
runs immediately after enrollment. `HOMEPAGE_EXPORT_INTERVAL_MS` controls that
success interval in Convex; `600000` is ten minutes. Delivery failures have a
separate retry backoff, and a one-minute recovery cron picks up overdue jobs.
That cron does not export every user's data every minute.

Each export includes up to 12 tasks, 6 captures, 12 signals and 8 top-level
scorecards. Queries and text lengths are bounded; truncated results are labeled.
Dates follow the user's timezone. The export excludes notes, attachments and
credentials. Retries reuse the same serialized export and revision until it is
acknowledged.

Tasky data is fresh for 15 minutes and outdated after one hour. The source time
is separate from publication time. Failed updates retain the original source
age. KV can briefly return an older complete edition, including a cached miss.

## Authentication

The client ID is explicitly configured as `tasky-homepage` in both places:

- Convex: `HOMEPAGE_OAUTH_CLIENT_ID`.
- Worker: `OAUTH_CLIENT_ID` in `wrangler.jsonc`.

The matching client secret is stored as `HOMEPAGE_OAUTH_CLIENT_SECRET` in Convex
and `OAUTH_CLIENT_SECRET` in the Worker. Neither setting has a fallback. The
Next.js login page receives an explicit homepage flow from the issuer; it does
not need a separate client-ID environment variable.

The pinned Better Auth 1.4.9 provider uses `/api/auth/oauth2/authorize`,
`/api/auth/oauth2/token`, `/api/auth/oauth2/userinfo` and `/api/auth/jwks`. Login
validates state, nonce, S256 PKCE, the exact callback and the signed identity.
The allowlist accepts canonical user IDs or verified email addresses.

Better Auth's MCP and OIDC plugins share grant storage. `convex/lib/mcp.ts`
rejects homepage credentials at MCP's token and session endpoints, including
when homepage OIDC is disabled. Keep the client ID configured and reserved;
changing it requires revoking grants issued under the old ID. Integration tests
in `convex/homepageOidc.test.ts` cover that boundary and ordinary MCP clients.

Homepage cookies are Secure, HttpOnly, SameSite=Lax and scoped to the homepage.
Sessions last 24 hours by default. Remembered refresh credentials are encrypted
in a Durable Object and can renew for at most 30 days, subject to provider expiry.
Renewal checks UserInfo against the original user ID. Logout deletes the
remembered grant; an already copied session remains valid until its expiry.
Tasky logout and homepage logout are separate.

## Weather

Save an **AccuWeather (personal homepage)** key in Tasky Settings. The background
Worker calls the signed `/api/homepage/weather-key` service route to retrieve
only that enrolled user's AccuWeather key from Tasky's encrypted key store.
The route accepts no arbitrary key type. Keys never enter the browser, feed,
KV edition or collector state. This keeps Tasky as the credential store while
the Worker owns weather collection.

Defaults are New York (`349727`), Fahrenheit and English. Current conditions
update every two hours; the five-day forecast every six hours. The collector
allows at most 20 provider calls per rolling 24 hours (normally about 16), with
persisted accounting and rate-limit backoff. A missing key is rechecked every
30 minutes. Weather failures do not block Tasky updates. Weather data becomes
stale after seven hours and is removed after twelve.

## Deployment and configuration

The Worker, KV, Durable Objects, Pages gateway and production Convex endpoints
are already provisioned. Ordinary releases reuse the IDs in `wrangler.jsonc`.

```sh
# Repository root: deploy Convex changes
npx convex deploy

# Homepage Worker
cd homepage
npm run deploy

# Only when gateway routing changes
npm run deploy:gateway
```

Next.js changes deploy through the repository's existing main → Vercel flow.
The production issuer is `https://pleasant-nightingale-894.convex.site`, and
Tasky is `https://tasky.davidw.tech`.

For a new environment, `scripts/prepare-secrets.mjs` creates ignored files with
mode 0600 and refuses to overwrite existing secrets:

```sh
HOMEPAGE_ALLOWED_EMAILS=you@example.com node scripts/prepare-secrets.mjs
npx convex env set --prod --from-file .env.homepage-convex
npx wrangler deploy --secrets-file .env.homepage-secrets.json
```

Use separate bindings and credentials for development. Keep both client IDs and
client secrets consistent, and configure `HOMEPAGE_OAUTH_CLIENT_ID` even when
homepage OIDC is disabled so MCP cannot accept previously issued grants.

The Squarespace DNS record is `CNAME home → tasky-homepage.pages.dev`. The Pages
project's custom domain and certificate must remain active; public `pages.dev`
aliases are rejected.

## Troubleshooting

- `/api/setup` shows authenticated enrollment and publication status.
- Missing Tasky updates: inspect `homepageEnrollments` for the next run and coarse
  error code, then check scheduling and matching ingestion secrets. Avoid logging
  the pending export body.
- Missing weather: check the key in Tasky Settings and allow for the retry
  interval. Do not repeatedly force requests against the provider quota.
- After auth changes, check sign-in, renewal and logout with the real account.
  Local integration tests do not establish live provider/account behavior.
- Keep Durable Object namespaces during deployments: they store enrollment,
  delivery receipts and remembered-grant revocations.
- Rotate session keys by adding a new key and switching `SESSION_ACTIVE_KID`;
  retain the old verification key for at least 24 hours after its last issuance.
  Changing `GRANT_ENCRYPTION_KEY` requires signing in again.
