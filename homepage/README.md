# Tasky homepage

A private, pre-rendered homepage at `https://home.davidw.tech`, backed by a
Cloudflare Worker. Signed-in page loads verify a local session and read one
user-specific KV entry; they do not call Convex or external data providers.

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
- `../convex/homepage.ts`: enrollment, Tasky exports, and delivery retries.
- `src/auth`: OAuth login, signed sessions and encrypted refresh credentials.
- `src/publishing`: a Durable Object per user assembles HTML and JSON into one KV
  entry, preserving the last successful edition when updates fail.
- `src/modules`: validation, rendering and freshness policies.
- `src/ingestion`: signed Tasky service requests.
- `gateway`: Cloudflare Pages forwards the custom hostname to the private Worker
  through a service binding. DNS remains at Squarespace.

To add sports or another source, define its payload in `packages/home-feed` and
add its renderer to `src/modules/registry.ts`. Authentication and page delivery
stay shared.

## Tasky updates

Tasky exports every **10 minutes** after a successful delivery. The first export
runs immediately after enrollment. `HOMEPAGE_EXPORT_INTERVAL_MS` controls that
success interval in Convex; `600000` is ten minutes. Delivery failures have a
separate retry backoff, and a one-minute recovery cron picks up overdue jobs.
That cron does not export every user's data every minute.

Each export includes task/inbox counts, up to 3 attention signals plus signals
logged today (12 total), and 8 top-level scorecards. Task and capture details
are omitted. Queries and text lengths are bounded; truncated results are labeled.
Dates follow the user's timezone. The export excludes notes, attachments and
credentials. Retries reuse the same serialized export and revision until it is
acknowledged.

Tasky data is fresh for 15 minutes and outdated after one hour. The source time
is separate from publication time. Failed updates retain the original source
age. KV can briefly return an older complete edition, including a cached miss.

The cover edition counts calendar days, with September 15, 2026 as Edition 1.
The generated time changes with each publication; the internal revision still
increments per publication so automatic updates work throughout the day.

## Agent-published widgets

MCP agents publish strongly validated, immutable widget rows to Convex. The
registered kinds are `briefing@2` (a structured report date plus bounded
Markdown body), `weather@1` (current conditions plus hourly and location-aware
daily forecasts), `on-this-day@1` (a dated
Markdown list of journal facts from prior years), `strava@1` (normalized
latest-run and latest-ride summaries), `releases@1` (dated upcoming TV and
movie releases), and `recurring-expenses@1` (payments due within seven days and
monthly totals by category). Strava stores source units and links;
web and mobile format distance, moving time, run pace or ride speed, optional
elevation gain, ride power, and average heart rate. Optional stats are hidden
when absent. Activity titles and raw provider responses are intentionally
excluded. Releases may be published weekly: clients filter expired entries
against the viewer's current local date whenever they render.
Recurring expenses use the same render-time filtering window. Their housing
category total remains in the payload but is currently hidden from both clients.

Convex generates each row ID. An optional retry idempotency key prevents
duplicate publication. The `widgetData.by_user_kind` index implicitly orders
equal user/kind rows by `_creationTime`, so clients select the newest row.
Publishing requests a fresh homepage export; the generic widget snapshot list
lets new registered kinds reuse the same delivery machinery. Mobile reads each
latest row reactively.

### Adding another widget

1. Add its strict, versioned Zod payload under
   `packages/home-feed/src/widgets/`, then register it in `widgets.ts`
   (`WIDGET_KINDS`, `widgetDefinitions`, and `widgetDataInputSchema`).
2. Add the same kind literal to `widgetKind` in `convex/schema.ts`.
3. Add a trusted web renderer under `homepage/src/modules/` and register it in
   `modules/registry.ts`; registry order is display order.
4. Add the mobile card, reading `widgetData.latest` for the new kind.
5. Extend the MCP, projection, renderer, and publication tests, and document
   the agent payload in `MCP.md`.

Keep time-sensitive filtering in a shared pure helper and call it from both
renderers. Publication freshness controls when data is considered stale; it
does not replace render-time filtering for data that changes meaning each day.

Storage, MCP dispatch, homepage export, and publication are generic and should
not need kind-specific changes. Pushes to `main` deploy Convex through Vercel
and the homepage Worker through its GitHub workflow. Deployment does not seed
data: an agent must publish the first row. Reconnect MCP clients that cached the
older tool schema.

## Portfolio

The export reuses Tasky's configured Airtable Positions views and shared
portfolio credentials. Each named portfolio includes total value and the five
largest positions initially, with up to 20 holdings embedded for expansion and
client-side sorting. The page switches between portfolios locally and remembers
the selection; page loads make no provider requests. Every export refreshes
current values and cost basis from each Positions view.
Each portfolio also embeds up to 90 days of complete account snapshot totals
and renders its value chart directly into the published HTML. History is
refetched only after a successful combined portfolio sync (or when the cached
series is missing), so the browser loads no chart library or additional data.
The embedded series also supports pointer, touch and keyboard inspection of
past values and daily percentage changes without making a network request.
Recent day-return data is derived from the two latest complete account snapshot
days after a successful combined portfolio sync, then retained in the saved
homepage snapshot between exports.
“Checked” is the snapshot retrieval time, not a market quote timestamp. Failed
reads preserve the last successful snapshot and its age; missing credentials
hide the module.

**Sync prices** posts to `/api/sync-prices`. The Worker checks the homepage
session and calls Convex `POST /api/homepage/sync-prices` with the same
provisioning signature as the enrollment route. Convex runs the app's price
and account snapshot sync for that enrolled user only, then exports a new
edition. A click while a
sync is already running does nothing. One run reads all configured portfolio
views, fetches each ticker once, updates every unique Airtable Position record,
and publishes one new edition.

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
Sessions last 7 days by default. Remembered refresh credentials are encrypted in
a Durable Object and can renew for at most 30 days, subject to provider expiry.
Renewal checks UserInfo against the original user ID. Logout deletes the
remembered grant; an already copied session remains valid until its expiry.
Logout clears the homepage cookies and returns to its sign-in screen. Visiting
the homepage again requires clicking “Sign in with Tasky” to reconnect. Tasky
logout and homepage logout are separate.

## Weather

Weather is an agent-published `weather@1` widget. The shared strict schema is
used by MCP publication, homepage rendering, and the mobile card. Publishing a
new row requests a fresh homepage export; clients reactively select the newest
row. Weather data becomes stale after seven hours and unavailable after twelve.

Daily rain percentages are the daytime chance of rain; missing values show a
dash. A daily forecast may override the top-level location so an agent can
publish an itinerary spanning multiple cities; every daily row displays its
effective location. The weather header's info control reveals publication,
observation, and optional forecast update times. The hourly rain chart renders
the supplied hourly probabilities as HTML/CSS, with a fixed 0–100% scale and no
charting library.

## Page loading

HTML is rendered in the background and stays private with `no-store`. The small
public refresh script uses a content-derived URL and immutable browser caching.
There is no React hydration or provider request on the page-loading path.

## Deployment and configuration

The Worker, KV, Durable Objects, Pages gateway and production Convex endpoints
are already provisioned. Ordinary releases reuse the IDs in `wrangler.jsonc`.

```sh
git push origin main
```

Pushing `main` deploys Next.js and Convex through Vercel and the homepage Worker
through its GitHub workflow. Do not manually deploy Convex for ordinary
production releases.
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

- `/api/setup` shows authenticated enrollment and publication status. It does
  not include widget payloads.
- Missing Tasky updates: inspect `homepageEnrollments` for the next run and coarse
  error code, then check scheduling and matching ingestion secrets. Avoid logging
  the pending export body.
- Missing weather: use `readWidgetData` for `weather` to confirm a current row,
  then publish a schema-valid replacement through `publishWidgetData`.
- After auth changes, check sign-in, renewal and logout with the real account.
  Local integration tests do not establish live provider/account behavior.
- Keep Durable Object namespaces during deployments: they store enrollment,
  delivery receipts and remembered-grant revocations.
- Rotate session keys by adding a new key and switching `SESSION_ACTIVE_KID`;
  retain the old verification key for at least 24 hours after its last issuance.
  Changing `GRANT_ENCRYPTION_KEY` requires signing in again.
