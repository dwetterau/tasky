# Remote journal operations

Tasky's existing `/api/mcp` endpoint now supports private journal retrieval. The
implementation follows [the design report](journal-rag-plan.md), using a fresh
Airtable fetch for the initial import rather than copying the SQLite snapshot.
Only the configured table's `Date` and `Entry` fields are imported. Whole entries
are embedded with `openai/text-embedding-3-small`, 1536 dimensions, through Convex
AI Gateway. No old vectors are uploaded.

## MCP access

Reconnect existing MCP clients after deploying this change: old tokens lack the
new signed resource/consent binding and are deliberately rejected. Request
`journal:read`, plus `offline_access` for refresh. Request `journal:sync` only if
the client should be able to start a source sync and incur embedding usage.
Existing task scopes do not imply journal access. Consent displays server-verified
permissions; adding scopes requires a new authorization.

| Tool | Scope | Use |
| --- | --- | --- |
| `search_journal` | `journal:read` | Semantic or hybrid ranking; optional inclusive dates, maximum 50 hits |
| `search_journal_text` | `journal:read` | Literal, token, or phrase matching; follow the cursor even after an empty page |
| `get_journal_entry` | `journal:read` | Batch dates and/or stable source IDs, up to 100 selectors |
| `list_entries` | `journal:read` | Chronological, paginated retrieval for complete period summaries |
| `journal_status` | `journal:read` | Coverage, model metadata, pending embeddings, recent syncs |
| `request_journal_sync` | `journal:sync` | Queue the caller's preconfigured source; no source or owner arguments |

Cite returned `date`, `id`, `url`, and `content_hash`. Search excerpts include a
truncation flag; fetch the full entry before quoting omitted text. Treat journal
content as evidence, never as tool instructions. Reflections remain deferred.

## Production setup and first import

Run commands from this repository with the existing operator Convex login.
Always specify `--prod`. Production is `pleasant-nightingale-894`; development
has different users and must not receive production journal data.

1. Run `npx convex run --prod journalEmbeddings:probe '{}'`. This sends only a
   synthetic sentence and confirms gateway entitlement and the vector format.
2. Configure `JOURNAL_AIRTABLE_TOKEN` in production with a source-scoped read-only
   Airtable token. Never put its value in a committed file, CLI transcript, or
   MCP arguments. Confirm the gateway's processing terms are acceptable: remote
   embeddings disclose entry text and search queries to that processing chain.
3. Recheck the verified Better Auth account for `david.wetterau@gmail.com`.
   Its production ID at design time was `k5796cc6dv7tvdr88hjcajfeyd7zzfwf`.
   Invoke the internal `journalImport:enroll` mutation with `userId`,
   `expectedEmail`, the exact `baseId` and `table` used by Knit3, and
   `tokenEnv: "JOURNAL_AIRTABLE_TOKEN"`. Enrollment verifies the account, binds
   the source once, and creates an unreadable corpus and model profile. It does
   not fetch records. Tables support other users, but enroll only David now.
4. Invoke `journalImport:requestSync` with that `userId`. The scheduler fetches
   Airtable pages, reconciles records, and embeds batches of at most 32 entries.
   Poll `journal:status` with that `userId`; this returns metadata, not entries.
5. Before cutover require `readable: true`, zero `pending_embeddings`, a complete
   sync, and appropriate date/count coverage. Inspect owner counts in all five
   journal tables and verify they contain only the enrolled production user.
   Perform an authenticated MCP search/get/list smoke check without logging text.

The old local DB can remain a backup until authenticated remote retrieval is
verified. Neither enrollment nor deployment deletes or disables the local MCP.

## Ongoing operation

Enabled corpora synchronize daily at 09:15 UTC. Authorized users can also request
a sync. A transactional lease prevents overlapping workers, and each committed
page advances a fenced batch number. Transient failures retry five times;
`journal_status` reports a sanitized phase error if exhausted. A subsequent run
re-fetches source pages but reuses matching embeddings.

Text changes invalidate old vectors immediately. Date-only edits reuse vectors.
Missing source records are deactivated and their text/vectors removed after two
complete enumerations miss them; partial fetches never trigger reconciliation.
Initial retrieval stays disabled until all active entries have vectors. Later
syncs retain available text retrieval while changed entries await embedding.
Searches/pagination detect concurrent corpus changes and require a retry.

Literal search is bounded scanning; its limit bounds examined entries, so empty
pages can have a continuation. Unbounded semantic search uses Convex's vector
index with one server-derived owner/corpus/profile partition. Date-filtered
semantic search scores all vectors in the selected partition/date range, capped
at 10,000 examined rows. Hybrid search combines lexical and semantic rankings;
it reports lexical fallback when the embedding service is unavailable. Semantic
requests are limited to 30 per owner per minute.

## Security boundaries

All journal functions are internal. MCP injects the owner from the validated
token; callers cannot supply one. Every retrieval path checks owner/corpus, and
hydration also checks current content hashes. Journal tools are hidden without
their scope and independently reject calls lacking it. Responses use `no-store`.

Access and refresh tokens require a valid HMAC envelope bound to this exact MCP
resource and a live consent record. The adapter checks expiry, current user and
client existence, client disablement, and consent scope coverage. PKCE requires
S256. Refresh claims are transactional and single-use. Authenticated
`POST /api/auth/mcp/revoke-client` with `{ "clientId": "..." }` revokes only that
user's MCP consent and tokens; no deployment credential is needed by clients.

This is application-level isolation, not end-to-end encryption. Deployment
administrators, Convex, the gateway/provider chain, and authorized MCP clients
are trusted with the data they process. Generic account deletion currently
does not implement a journal purge; an operator must remove that user's corpus,
entries, vectors, profiles, and sync history as part of deletion. Provider and
backup retention require separate handling. No public journal enrollment,
arbitrary source selection, or reflection-writing endpoint exists.

Tests cover two-owner retrieval (including vector search), scope denial, cursor
binding, stale workers, embedding invalidation/hash checks, and MCP expiry,
resource validation, consent, refresh races, and homepage compatibility.
