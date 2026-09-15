# Rollout runbook

## Current configuration

- Homepage: `https://home.davidw.tech`, using a Cloudflare Pages gateway and private Worker service binding
- Tasky: `https://tasky.davidw.tech`
- Production issuer: `https://pleasant-nightingale-894.convex.site`
- Initial allowed email: configured privately in the generated secret files (must be verified by Tasky)
- Timezone: `America/New_York`
- AccuWeather key: stored per user in Tasky Settings, not a Worker secret

## Prepare

Run local validation first, inspect the diff, and connect the Cloudflare CLI to the account owning `davidw.tech`:

```sh
cd homepage
npm ci
npm test
npm run typecheck
npm run build
npx wrangler login
npx wrangler whoami
HOMEPAGE_ALLOWED_EMAILS=you@example.com node scripts/prepare-secrets.mjs
```

Replace `you@example.com` with the allowlisted account. The last command creates ignored, mode-0600 `.env.homepage-secrets.json` (Worker secrets) and `.env.homepage-convex` (Convex configuration) without printing values. It refuses to overwrite files. Back these up in a secure password manager. Do not paste credentials into source, chat, CLI arguments or logs.

Create an isolated Workers KV namespace:

```sh
npx wrangler kv namespace create EDITIONS
```

The rollout's KV namespace is already recorded in `wrangler.jsonc`; do not create a duplicate for ordinary releases. `workers_dev` and `preview_urls` remain false. The Worker has no public route: the Pages gateway calls it using a private service binding.

## Publish the reviewed implementation

From the repository root, configure and deploy the backend:

```sh
npx convex env set --prod --from-file homepage/.env.homepage-convex
npx convex deploy
```

The scoped homepage provisioning/ingestion secrets are unrelated to the deployment credential used by this CLI. Only the reviewed code and schema are deployed; no record migration is needed for enrollment. Existing task indexes are supplemented with priority and deadline indexes.

Publish the Next.js auth bridge and Settings changes using the existing Vercel release workflow. The default client ID is `tasky-homepage`; if changed, configure `NEXT_PUBLIC_HOMEPAGE_OAUTH_CLIENT_ID` in Next.js to match both servers. Future homepage layout/provider changes do not require publishing Next.js.

From `homepage/`, publish the Worker and its secrets together:

```sh
npx wrangler deploy --secrets-file .env.homepage-secrets.json
```

The account and Worker name are pinned in the configuration. `ALLOWED_EMAILS` is uploaded as a secret rather than kept in this public repository. Do not create an anonymous/temporary preview account for private data.

## Squarespace DNS and gateway

The Cloudflare Pages project `tasky-homepage` uses advanced mode with only `gateway/public/_worker.js` and `_routes.json`. Every path goes to the bound Worker; there are no public HTML snapshots or static-asset fallbacks. The only binding is `HOMEPAGE → tasky-homepage`; credentials remain in the Worker. The production and preview `pages.dev` aliases are rejected before requests are forwarded.

For this deployment, the Pages project has already been created and `home.davidw.tech` registered with its Domains API. Wrangler 4.131 defaults new Pages projects to Workers; explicit Pages creation was needed here because externally hosted DNS requires Pages' subdomain support. Ordinary gateway deployments now target the existing Pages project:

```sh
cd homepage
CLOUDFLARE_ACCOUNT_ID=3dd7176ee728107d75279307beba54bd npm run deploy:gateway
```

Keep this Squarespace record:

| Type | Host | Target | TTL |
| --- | --- | --- | --- |
| CNAME | home | tasky-homepage.pages.dev | Default |

Squarespace remains the DNS provider. This CNAME and the Pages domain/TLS certificate were verified active on September 15, 2026. For a future hostname change, wait for the new domain and certificate to become active after saving DNS. A direct Worker custom domain would instead require an active Cloudflare zone; do not add that route to the backend configuration while this gateway owns the hostname. See [Cloudflare's external-DNS instructions](https://developers.cloudflare.com/pages/configuration/custom-domains/#add-a-custom-subdomain).

## Connect data

1. In Tasky Settings, add the key type **AccuWeather (personal homepage)** and save the Core Weather Starter API key.
2. Open `home.davidw.tech`, sign in using the allowlisted Tasky account and finish consent.
3. Verify that `/api/setup` shows your canonical ID, enrollment progress, and then an edition revision. Initial Tasky export is queued automatically; cached KV misses can delay visibility.
4. Weather initializes in the background. A missing key is checked again within 30 minutes. Do not repeatedly force the provider to fetch while waiting.
5. Complete the live checks in `VERIFICATION.md` before calling rollout complete.

## Operations

- `/api/setup` is an authenticated slower diagnostic route. It exposes only the current user's preparation/publication status.
- Convex `homepageEnrollments` contains pending export IDs, attempts, next-run time, and coarse error codes. Inspect these through the trusted Convex dashboard/CLI; never print `pendingBody` in operational logs.
- Homepage operational logs contain event/module/error codes only, not identities, OAuth queries, API keys, request bodies or source content. Keep external request logging and tracing configured accordingly.
- Missing exports: check Convex enrollment, cron/scheduled actions, `HOMEPAGE_ORIGIN`, and matching ingestion secret. Configuration failures retry hourly; fix the cause before forcing a retry.
- Missing first edition: check `/api/setup`, provisioning secret and issuer; then the allowlist. Weather cannot prevent Tasky-only operation.
- `initial_export_delayed` means enrollment succeeded but no Tasky export arrived within five minutes. Check Convex scheduling and the durable outbox. Setup's revision reports a successful KV publication, not an attempted write.
- Publication failure: keep KV and DO bindings intact; the persisted dirty state/alarm retries. An older accepted export cannot lower the source revision.
- Weather 401/403: check the per-user key and product access in Tasky Settings. Weather 429: wait for backoff. Budget counters count attempted external calls and survive restarts.
- To suspend exports for an account, set `enabled=false` on its `homepageEnrollments` record through the trusted Convex dashboard and remove it from the homepage allowlist. Existing signed credentials retain their documented expiry. For full deprovisioning, also remove its coordinator registration and published KV envelope through Cloudflare's trusted admin tools; do not expose a public administrative deletion route.
- If an AccuWeather subscription is canceled, remove its key and purge its weather module/private collector state and published envelope. This also avoids retaining provider data beyond the permitted purpose.

Do not delete Durable Object namespaces during ordinary deployments: they hold authoritative enrollment, replay receipts, and remembered-grant revocations. Rotate secrets deliberately using the policy in the package README.
