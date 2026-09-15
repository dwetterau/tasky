# Verification record

Recorded September 15, 2026. The implementation is validated locally. **Live account/provider verification is still pending.** The production Convex integration, Cloudflare Worker, KV/Durable Objects and Pages gateway have been deployed. The Squarespace CNAME and Cloudflare domain/TLS are active. This release includes the Next.js Settings/login bridge. Saving the AccuWeather key and checking the signed-in experience with real data remain.

## Automated and build checks

| Check | Result |
| --- | --- |
| Root `npm test` | 71 tests passed, 9 files |
| Homepage `npm test` | 33 tests passed, 7 files |
| Root, Convex runtime and homepage TypeScript | Passed |
| Root `npm run build` | Passed; Next.js production build, 15 generated pages |
| Homepage `npm run build` | Passed; also deployed successfully to Cloudflare |
| ESLint on changed Tasky/backend/shared files | Passed |
| Repository-wide `npm run lint` | 14 errors and 5 warnings in unchanged files |
| `git diff --check` | Passed |
| Secret preparation script | Verified private file permissions, no secret values printed, refusal to overwrite |

Existing lint failures concern React ref/effect/purity rules in `NoteModal`, onboarding, `MarkdownEditor`, `StyledSelect`, `TagSelector` and `useAuthSession`; warnings concern generated files and an unused import in `events.ts`. They are outside this change. The Worker uses its separate TypeScript and test configuration.

Security coverage includes missing/expired/malformed credentials, invalid signatures/issuer/audience/scope, signing-key overlap, exact OAuth callback/state/nonce validation, PKCE parameters, verified identity claims, encrypted remembered grants, refresh/UserInfo binding, logout revocation and CSRF rejection. Worker OAuth protocol tests use a mock RSA issuer. A separate backend integration test uses the installed Better Auth package and an isolated in-memory adapter for login redirect, consent, signed identity, single-use code exchange, confidential renewal and UserInfo. This caught a missing OIDC endpoint registration that the mock tests did not detect; it does not replace production account verification.

A subsequent security review reproduced a cross-endpoint bypass: a homepage refresh grant exchanged at `/mcp/token` without a secret returned 200, and the resulting access token could read the fixture user's profile/email through UserInfo. The regression test failed before the fix. The MCP adapter now rejects homepage grants using their stored client ID, protects homepage authorization codes from consumption at MCP, and prevents homepage access tokens from exposing the full grant through MCP session lookup. All 16 installed-provider integration cases pass, including normal public/confidential MCP flows and valid homepage renewal after rejected bypass attempts. Homepage scopes remain `openid profile email offline_access`; no task scopes are added.

The MCP isolation fix is deployed to production Convex. Live probes with invalid test credentials confirmed the new token validation and session wrapper are active, both token endpoints reject invalid grants, homepage login still redirects through the issuer to Tasky, and private edition/setup routes reject unauthenticated reads. These probes did not create a production fixture user or access real account grants; complete account login and renewal require verification through the production Next.js bridge.

Before pushing this release, all 104 tests, both production builds, Convex and homepage TypeScript checks, and lint on the changed files passed again. The live probes above also passed again, and the release files contained none of the configured homepage secret values.

Two fixture users exercise authentication before storage, URL identity spoofing, HTML/JSON/status/setup isolation, mismatched envelopes and deployment aliases. HMAC tests cross-check the actual Convex and Worker implementations and reject changed methods, paths, bytes and stale timestamps. Delivery spies assert **one KV read and zero provider/database/Durable Object calls** on the normal read path.

The gateway tests verify canonical URL/cookie forwarding, alias rejection and failure without static fallback. Live Convex JWKS returns a usable RS256 public key and `no-store`; the weather-key endpoint returns 401 with `private, no-store` without service authentication. The Pages service binding and the Worker's secret/binding names were verified through the Cloudflare API without printing secret values. The Worker reports 38–44 ms startup time during deployment; this is not browser FCP or complete request latency.

The custom domain's `/api/edition`, `/api/status` and `/api/setup` return 401 and `private, no-store` without a session; `/` redirects to login. Live `/auth/login` produces state, nonce and S256 parameters with the fixed callback, and the deployed issuer returns a 302 to Tasky's frontend with the query preserved and without the MCP login cookie. An invalid client secret at the deployed token endpoint returns 401. Cloudflare initially rejected the generic Python/browser verification client with error 1010; a request with the explicit application User-Agent succeeds. The HMAC transports identify themselves as `Tasky-Homepage/1.0` for background requests. Browser-based live login remains to be verified with the user after the Next.js bridge release.

Reliability coverage includes consistent bounded projections, DST calendar boundaries, invalid legacy dates, exact outbox retries, empty/deleted content, replay conflicts, concurrent/out-of-order ingestion, interrupted publication, Durable Object eviction, KV failure/recovery, accurate setup diagnostics, independent module failures, retained observation timestamps, key absence, 429 backoff, rolling request budgets and configuration changes.

## Local performance and presentation

These results describe fictional local data, not a deployed Cloudflare site. They exclude real OAuth, Convex ingestion and AccuWeather collection.

| Measurement | Local result |
| --- | --- |
| Main HTML + inline CSS, no-script fixture | 11,496 bytes; 3,667 bytes gzip |
| Optional production browser script | 1,070 bytes; 523 bytes gzip |
| Framework hydration / external fonts | None |
| First measured local browser navigation | FCP 72 ms; TTFB 3.5 ms |
| Five repeat browser loads | FCP 52, 64, 60, 52, 60 ms; median 60 ms |
| Repeat browser TTFB | 1.5–2.7 ms; median 1.6 ms |
| First in-process Worker request | Handler 2 ms; auth 1 ms; local KV 1 ms |
| 30 repeat in-process Worker requests | Handler/auth/KV medians below 1 ms clock resolution; p95 1 ms each |

Browser: Chrome 152 on Linux, 1280 × 720, localhost HTTP, no network or CPU throttling. HTML responses are `no-store`. The fixture route omits production polling/renewal code; `/measure` adds only a local PerformanceObserver. Authenticated Worker measurements use real local Miniflare KV and fixture session signing, with in-process dispatch. A reported 0 ms represents clock quantization, not zero work. The first local request is **not** a cold Cloudflare point of presence.

The provisional sub-300 ms FCP target has only been observed for this local fixture. No production performance guarantee follows from it. The main response budget is comfortably below 50 KB compressed; optional JS is below 10 KB. The roughly 240 KB compressed Worker deployment bundle runs on the server and is separate from browser response size.

Desktop and 390 × 844 phone layouts were visually inspected. The full page remains readable with the script omitted, the local attribution image loads, headings and progress indicators are semantic, and the phone layout has no horizontal overflow.

Reproduce local measurements:

```sh
cd homepage
npm test -- --reporter=verbose --silent=false tests/performance.test.ts
npm run preview:fixture
```

Open `http://localhost:8788/measure` and inspect `HOMEPAGE_LOCAL_METRICS` console entries. `/` is the no-script design preview. These routes exist only in the standalone fixture server.

## Required live checks after rollout

Follow `ROLLOUT.md`, then record results here. Use the allowlisted account and separate isolated test infrastructure for a second account; do not relax production access for test fixtures.

1. Sign in through the deployed Tasky bridge. Verify the exact callback, canonical subject, dedicated cookie attributes, enrollment and first real snapshot. Confirm an unallowlisted account is denied.
2. Change a Tasky record; observe the next source revision in JSON and its matching HTML edition. Complete/delete a record and verify it disappears. Record source export time and publication time, including any KV visibility delay.
3. Save the AccuWeather key in Tasky Settings. Verify real NYC current/forecast normalization, product access and attribution. Inspect request counters without logging the credential. Remove the key in isolated test infrastructure and verify Tasky-only operation.
4. Verify renewal with the pinned real provider, expired credentials returning no private content before renewal, logout, revoked remembered grants and provider expiry. Confirm the documented remaining lifetime of an already-issued local session.
5. Exercise stale data, unavailable providers and interrupted publication in isolated bindings. Confirm the previous complete edition stays available with honest source ages.
6. Measure `Server-Timing` (`auth`, `kv`), browser navigation TTFB/FCP, response size, `x-snapshot-age-ms`, and `feed.publishedAt - tasky.sourceDataAt`. The latter includes scheduling and delivery, not just rendering.
7. Record **separate** warm-repeat, several-hours-idle, cold-KV, expired-session renewal, first-use setup and representative mobile-network samples. Include location, device/browser, network/throttling, sample count and median/p95. Preserve privacy when collecting traces or HAR files, which may contain cookies and source content.

No real Cloudflare cold/idle/mobile-network, setup/renewal, source-age or export-to-publication measurements have been made yet. These checks remain part of MVP acceptance.
