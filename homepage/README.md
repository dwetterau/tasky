# Tasky private homepage

An independently deployed Cloudflare Worker for `home.davidw.tech`. It serves a complete, pre-rendered personal edition and a reusable JSON feed. There is no React hydration or database/provider call on the authenticated read path.

The domain's DNS stays at Squarespace. A tiny Cloudflare Pages gateway accepts the custom subdomain via CNAME and forwards the original request through a private service binding to the Worker. The gateway has no credentials, KV binding, snapshots or static page fallback. Both layers reject alternate origins. This adds one internal Cloudflare service invocation; the Worker still verifies the session locally and reads exactly one KV envelope.

## Local development

```sh
cd homepage
npm ci
npm test
npm run typecheck
npm run build
npm run preview:fixture
```

The standalone preview at `http://localhost:8788` uses **labeled fictional data**, omits JavaScript, and writes `artifacts/fixture.html`. It is not a production route or an authentication bypass. Production Wrangler has no fixture entry point. The Worker build is separate from Next.js; the root TypeScript and ESLint configs exclude this package.

For authenticated local integration, use a development HTTPS origin and its own exact OAuth redirect, service secrets, allowlist, and KV/DO namespaces. `wrangler dev` alone does not connect production cookies to localhost. Use test bindings for automated local work; never reuse a production keyring in test fixtures.

## Boundaries

```
Convex enrollment → durable export outbox → signed ingestion
                                               ↓
Background collectors → per-user publisher → one KV envelope
                                               ↓
Browser cookie → local signature check → one KV read → HTML / JSON
```

- `../packages/home-feed`: versioned Zod contracts, portable timezone calculations, plain-text normalization. No server credentials, Cloudflare bindings, React or native dependencies.
- `../convex/homepage.ts`: narrowly scoped enrollment/key endpoints, scheduled consistent exports and durable retries. All export jobs are internal; identity comes from trusted enrollment records.
- `src/auth`: OAuth protocol, dedicated signed homepage sessions, encrypted server-side refresh grants.
- `src/publishing`: a per-user Durable Object serializes all acceptance, alarms and KV publication. Acknowledgment means the snapshot and receipt are stored durably, not that KV is already globally visible.
- `src/modules`: trusted validators, ingestion/collection code, freshness policy, and HTML renderers.
- `src/ingestion/coordinator.ts`: bounded, cursor-based scheduling across enrolled users and modules.
- `gateway/`: external-DNS entry point only. [Pages supports subdomains hosted by another DNS provider](https://developers.cloudflare.com/pages/configuration/custom-domains/); the [service binding](https://developers.cloudflare.com/pages/functions/bindings/#service-bindings) invokes the existing Worker inside Cloudflare. Gateway deployments are only needed when routing changes.

### Adding Mets, F1 or fantasy-football modules

1. Add a versioned structured payload schema to `packages/home-feed`. Prefer stable event IDs, start times with timezone/UTC, source timestamps and validated links. The feed is the future native-mobile boundary.
2. Add a module directory with a trusted `HomeModule<T>` validator/renderer and freshness policy. Register it in `src/modules/registry.ts`.
3. For polling sources, register a `BackgroundModule` in `src/modules/background.ts`. The coordinator provides a private per-user state namespace. Store next-attempt times and retry state before external effects; publish only normalized snapshots. For push sources, add an authenticated ingestor following Tasky's pattern.
4. Opt existing enrollments into the new module's configuration explicitly. An unrelated deployment does not silently enable a new provider for existing users.
5. Test two-user isolation, stable event identity, empty success, stale observations, and provider failure. Page serving, session verification and KV key selection need no changes.

Modules may be user-specific or shared in the contract. The current weather collector is intentionally scoped to the owner of its API key. Future public sports data can use a shared provider cache keyed by product/league/configuration, while enrollment preferences and private fantasy credentials remain per-user. Do not share account-bound responses just because locations or leagues match.

## Tasky projection

Exports run approximately every two minutes (cron recovery is every minute). Dates use the enrollment's IANA timezone, with DST-aware day/week/month bounds; weeks start Monday. Ranking is deterministic: overdue, due today, upcoming within seven days, later, undated; then priority, due date, creation time and ID.

The feed contains up to 12 tasks, 6 unprocessed captures, 12 signals needing attention, and 8 top-level scorecards. Scorecards reuse Tasky's evaluator and aggregate nested members. Text is plain and capped at 240 characters; task labels at three × 60 characters. It excludes notes, attachments, full events, provider keys and task bodies beyond the excerpt.

Bounded indexed scans cover at most 200 tasks per active status, plus separate priority/deadline candidates; 200 captures; 60 active signals; 30 active scorecards; 200 entries per period signal; 60 members per scorecard; 10 nested levels. Exports report `truncated` and label counts as lower bounds if a scan cap is reached. Empty successful exports remove completed/deleted content. These are a personal-dashboard projection, not an export of the entire database.

One pending serialized envelope is retained in each enrollment until acknowledged. Retry attempts reuse its exact ID, revision, timestamp and body and sign it with a fresh delivery timestamp. Network/server failures back off; configuration errors retry hourly. A crash or lost scheduled action is recovered by the cron after the lease expires. A delayed old delivery result cannot clear a newer outbox record.

## Authentication and identity

The homepage is a configured first-party client in Tasky's **pinned Better Auth 1.4.9** OIDC provider. Initial login uses `oauth4webapi` with state, nonce, S256 PKCE and an exact callback. `jose` additionally verifies the ID-token signature, issuer, audience and expiry. The canonical identity is the verified token `sub`, mapped to Better Auth's user ID. The account allowlist accepts a canonical ID or a **verified** email; the initial email is configured privately through `ALLOWED_EMAILS`. A browser userId never selects an enrollment or storage key.

Homepage grants are confined to its OIDC client endpoints. The MCP adapter rejects homepage refresh tokens and authorization codes using the stored grant owner, and homepage access tokens cannot retrieve an MCP session. This separation is required because the pinned providers share grant storage. See `docs/AUTH.md` for the compatibility and regression tests.

The installed Convex auth plugin overrides the general discovery route with Convex-specific metadata. Therefore this client pins the known OIDC endpoint paths under the configured HTTPS issuer and uses its JWKS endpoint. Endpoint compatibility is documented in `docs/AUTH.md`; production login still needs a live smoke test after setup.

The cookies are `__Host-home-session`, `__Host-home-remember`, and a ten-minute `__Host-home-login` transaction cookie. All are Secure, HttpOnly, SameSite=Lax, Path=/, with no Domain. Sessions use a dedicated issuer/audience and `homepage:read` scope. The default lifetime is 24 hours, configurable between 5 minutes and 24 hours.

Remembered credentials are encrypted with AES-GCM and bound to the random session ID. Their authoritative state is in a Durable Object, never KV. Renewal invokes the provider's refresh grant and checks UserInfo against the original subject; an old signed cookie alone cannot renew. A remembered grant has a hard 30-day ceiling, and provider expiry/revocation can end it earlier. An unverified renewal fails closed and requires sign-in again.

Logout deletes the server-side remembered grant and clears browser credentials. An already copied signed session can remain valid until its expiry (up to 24 hours). Tasky logout and homepage logout are separate. Removing an allowlist entry prevents enrollment and renewal, but does not override an existing local token's expiry. Immediate revocation would require a slower authoritative read or a shorter lifetime.

To rotate session keys, add a new key to `SESSION_KEYS` and switch `SESSION_ACTIVE_KID`. Keep the old verification key for at least 24 hours plus clock allowance after its last issuance; then remove it. Rotating `GRANT_ENCRYPTION_KEY` requires invalidating existing remembered grants/re-login. Never silently replace generated secret files as a rotation mechanism.

## Routes and freshness

| Route | Behavior |
| --- | --- |
| `GET /` | Verify locally, one user-scoped KV read, complete HTML |
| `GET /api/edition` | Same envelope's `feed`, plus delivery-time freshness |
| `GET /api/status` | Authenticated status from one KV read |
| `GET /api/setup` | Explicitly slower per-user publisher diagnostics |
| `GET /auth/login`, `/auth/callback` | OAuth transaction and enrollment |
| `GET /auth/renew` | No private content; renewal form usable without JS |
| `POST /auth/renew`, `/auth/logout` | Origin-protected session operations |
| `POST /internal/tasky` | Size-limited HMAC ingestion; no browser enrollment |

The source timestamp is distinct from publication time. Tasky is fresh for five minutes and outdated after one hour. Weather parts keep separate observation/check times; current observations are marked earlier after three hours. The combined weather module is stale after seven hours and removed after twelve. On failures, the last good snapshot retains its original age. Publication errors keep a dirty flag and retry alarm. HTML/JSON always refer to one complete edition revision.

The Worker adds a delivery-time stale/outdated banner to frozen HTML without fetching a source or rendering the page again. This works when JavaScript is off and when all background updates have failed. Missing first data produces an authenticated preparation screen with a status link. Optional JS checks for a newer **complete HTML response** and only swaps in a higher revision, so a later older KV read cannot regress the displayed edition.

KV is eventually consistent, including cached misses. A request can receive an older complete edition. Envelopes expire after 24 hours without publication; active publishers refresh their TTL. Weather is purged after twelve hours from mutable state; expired envelopes limit retention if all background services stop. No public static snapshot, service worker, Cache API, or browser cache is used. Alternate origins are rejected; private responses use `private, no-store`, a restrictive CSP, no-referrer and noindex.

## AccuWeather

Save an **AccuWeather (personal homepage)** key in Tasky Settings. It uses the existing user-scoped AES-GCM key store. Only the authenticated homepage service can retrieve that enrolled user's latest AccuWeather key; no arbitrary key type can be requested. Retrieval happens during background collection only. Keys are not stored in Cloudflare snapshots, module state, URLs or logs.

The initial saved configuration is New York (`349727`), Fahrenheit, English, current conditions every 120 minutes, five-day forecast every 360 minutes, and a hard rolling 24-hour budget of 20 calls per user. Normal collection is about 16 calls/day. Missing keys disable weather and are rechecked every 30 minutes. Provider 401/403 responses pause that product for six hours; 429 honors Retry-After with a one-hour minimum; server errors back off. Each request is reserved durably before the HTTP call so restarts cannot reset the quota counter. Header freshness can extend the interval.

Verified against AccuWeather's current [authentication documentation](https://developer.accuweather.com/documentation/authentication), [Starter FAQ](https://developer.accuweather.com/faq), [caching terms](https://developer.accuweather.com/documentation/terms-of-use), and [brand guide](https://developer.accuweather.com/documentation/brand-guidelines): Bearer header authentication; current conditions and five-day forecasts are available on Starter; caching is permitted for up to two weeks; linked logo attribution is required. The official RGB logo is vendored unmodified from the brand guide and served locally. Forecast check time uses Last-Modified when available, otherwise the HTTP Date/collection time; it is not claimed to be the model's issue time.

## Rollout

See [ROLLOUT.md](docs/ROLLOUT.md) for exact setup and [VERIFICATION.md](docs/VERIFICATION.md) for measured results and remaining live checks. Do not point preview deployments at production KV, session secrets or Durable Object namespaces.
