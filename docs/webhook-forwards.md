# Webhook forwards

A webhook forward is a per-user inbound URL that relays whatever is posted to
it into a Claude Code routine through the routine's API trigger. A user can
have several (up to 20). Code: `convex/webhookForwards.ts`; UI: Settings →
Webhook Forwards.

```
source (e.g. Strava) ──POST──▶ {CONVEX_SITE_URL}/api/webhooks/in/whk_…
                                   │ 200 immediately, delivery queued
                                   ▼
        POST https://api.anthropic.com/v1/claude_code/routines/trig_…/fire
```

- The `whk_…` token in the URL is the only credential for inbound calls. It is
  stored hashed (lookup) and encrypted (so Settings can show the URL again).
- The routine token and Strava client secret are encrypted with
  `API_KEYS_ENCRYPTION_SECRET`, like saved API keys.
- The destination is always `api.anthropic.com`; only the `trig_…` ID is taken
  from the fire URL you paste.
- The routine receives the request body as text, prefixed with the forward
  name, source and receive time. Bodies over 60,000 characters are rejected.
- Deliveries are retried (up to 3 attempts) only on 429/503, because a fire has
  no idempotency key. The last five deliveries per forward show in Settings;
  rows are deleted after 14 days.
- Routine API limits: 30 fires/hour per routine, 100/hour per account.

## Routine setup (claude.ai)

1. Open the routine at <https://claude.ai/code/routines> → **Edit**.
2. Add an **API** trigger. Copy the **Fire URL**, click **Generate token** and
   copy the token (shown once).
3. Make the routine's prompt refer to the `<routine-fire-payload>` block;
   otherwise the forwarded text is treated as inert context.

## Strava setup

A Strava API application has exactly one push subscription and only emits
events for athletes who have authorized it, so use your own application.

1. Create an application at <https://www.strava.com/settings/api>. Set
   **Authorization Callback Domain** to the Convex site host (the host of
   `CONVEX_SITE_URL`, e.g. `<deployment>.convex.site`).
2. In Settings → Webhook Forwards, add a forward with source **Strava**, the
   routine fire URL and token, and the application's client ID and secret.
3. Click **Subscribe**. Tasky registers the forward's URL with Strava and
   answers Strava's validation request. If the application already has a
   subscription elsewhere, Tasky asks before replacing it.
4. Click **Authorize** and approve on Strava (`activity:read_all`, so private
   activities also produce events). Tasky keeps only the athlete ID, to drop
   events from anyone else, and discards the tokens.
5. **Send test** fires the routine with a synthetic payload.

Only `activity` / `create` events are forwarded by default; updates, deletes
and athlete events are acknowledged and dropped. An event carries IDs only
(`object_id`, `owner_id`), so the routine needs its own Strava access (for
example the Strava connector) to read the activity.

Deleting a forward also deletes its Strava subscription.

## Generic source

Any `POST` to the URL is forwarded as-is. There is no signature check; treat
the URL as a secret.
