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
registered kinds are `briefing@1` (bounded Markdown), `strava@1` (normalized
latest-run and latest-ride summaries), and `releases@1` (dated upcoming TV and
movie releases). Strava stores source units and links;
web and mobile format distance, moving time, run pace or ride speed, optional
elevation gain, ride power, and average heart rate. Optional stats are hidden
when absent. Activity titles and raw provider responses are intentionally
excluded. Releases may be published weekly: clients filter expired entries
against the viewer's current local date whenever they render.

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
Recent day-return data is derived from the two latest complete account snapshot
days after a successful combined portfolio sync, then retained in the saved
homepage snapshot between exports.
“Checked” is the snapshot retrieval time, not a market quote timestamp. Failed
reads preserve the last successful snapshot and its age; missing credentials
hide the module.

**Sync prices** posts to `/api/sync-prices`. The Worker checks the homepage
session and calls Convex `POST /api/homepage/sync-prices` with the same
provisioning signature as the weather-key route. Convex runs the app's price
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
Sessions last 24 hours by default. Remembered refresh credentials are encrypted
in a Durable Object and can renew for at most 30 days, subject to provider expiry.
Renewal checks UserInfo against the original user ID. Logout deletes the
remembered grant; an already copied session remains valid until its expiry.
Logout clears the homepage cookies and returns to its sign-in screen. Visiting
the homepage again requires clicking “Sign in with Tasky” to reconnect.
Tasky logout and homepage logout are separate.

## Weather

Save an **AccuWeather (personal homepage)** key in Tasky Settings. The background
Worker calls the signed `/api/homepage/weather-key` service route to retrieve
only that enrolled user's AccuWeather key from Tasky's encrypted key store.
The route accepts no arbitrary key type. Keys never enter the browser, feed,
KV edition or collector state. This keeps Tasky as the credential store while
the Worker owns weather collection.

Defaults are New York (`349727`), Fahrenheit and English. Current conditions
update every two hours; the five-day and 12-hour forecasts every six hours.
The hourly rain chart shows the upcoming hours from the 12-hour forecast, including hours after midnight.
The collector allows at most 20 provider calls per rolling 24 hours, with
persisted accounting and rate-limit backoff. A missing key is rechecked every
30 minutes. Weather failures do not block Tasky updates. Weather data becomes
stale after seven hours and is removed after twelve.

Daily rain percentages use AccuWeather's daytime `RainProbability` from detailed
forecasts; missing values show a dash. The weather header's info control reveals
collection time, observation time, and separate daily/hourly forecast download
times. The provider's `Last-Modified`/`Date` still informs daily forecast freshness
internally; it is not displayed as a forecast creation time. The hourly chart
uses `PrecipitationProbability` from the standard 12-hour forecast (not the
details-only `RainProbability` field) and renders as HTML/CSS, with a fixed
0–100% scale and no charting library.

## Page loading

HTML is rendered in the background and stays private with `no-store`. The small
public refresh script uses a content-derived URL and immutable browser caching.
There is no React hydration or provider request on the page-loading path.

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

- `/api/setup` shows authenticated enrollment, publication status, and weather
  collector counters (budget used, next fetch times, last error). It does not
  include provider keys or forecast payloads.
- Missing Tasky updates: inspect `homepageEnrollments` for the next run and coarse
  error code, then check scheduling and matching ingestion secrets. Avoid logging
  the pending export body.
- Missing weather: check the key in Tasky Settings and allow for the retry
  interval. The Weather **Refresh** control (or `POST /api/refresh`) collects
  immediately, then publishes a **new** edition from the current snapshots. It
  does not edit the frozen KV HTML. A Refresh click is allowed to call AccuWeather
  even if the rolling daily budget is already spent (at most current, 5-day, and
  12-hour). Do not click it repeatedly.
- After auth changes, check sign-in, renewal and logout with the real account.
  Local integration tests do not establish live provider/account behavior.
- Keep Durable Object namespaces during deployments: they store enrollment,
  delivery receipts and remembered-grant revocations.
- Rotate session keys by adding a new key and switching `SESSION_ACTIVE_KID`;
  retain the old verification key for at least 24 hours after its last issuance.
  Changing `GRANT_ENCRYPTION_KEY` requires signing in again.
