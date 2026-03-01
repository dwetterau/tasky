# Tasky MCP Architecture

This document explains how Tasky's MCP server is wired today and why key design choices were made, so follow-up work (dynamic scopes, new MCP tools) can be done safely.

## Goals

- Expose Tasky data/actions to MCP clients through a single authenticated endpoint.
- Use OAuth 2.1 + OIDC metadata that standard MCP clients (including Cursor) can consume.
- Keep data access user-scoped and least-privilege by checking scopes before tool execution.
- Keep tool implementations inside Convex queries/mutations so business logic remains centralized.

## High-level Components

### 1) Auth + OAuth configuration (`convex/auth.ts`)

- Better Auth is the source of truth for OAuth/OIDC, sessions, and JWT token issuance.
- MCP support is enabled via Better Auth's `mcp` plugin.
- `oauthScopes` declares currently supported scopes:
  - identity/session scopes: `openid`, `profile`, `email`, `offline_access`
  - capability scopes: `tasks:read`, `tasks:write`
- `defaultScope` is currently `openid offline_access tasks:read`.
- Dynamic client registration is enabled (`allowDynamicClientRegistration: true`).

Why this design:
- Better Auth handles standards compliance and token plumbing.
- Tasky keeps custom logic focused on resource authorization and tool behavior, not OAuth protocol details.

### 2) HTTP route wiring (`convex/http.ts`)

The Convex router exposes:

- MCP resource endpoint: `/api/mcp` (`GET`/`POST`/`DELETE`)
- Protected resource metadata:
  - `/.well-known/oauth-protected-resource`
  - `/api/auth/.well-known/oauth-protected-resource`
- Authorization server metadata:
  - `/.well-known/oauth-authorization-server`
  - `/api/auth/.well-known/oauth-authorization-server`
- OIDC compatibility endpoints:
  - `/api/auth/.well-known/openid-configuration`
  - `/api/auth/jwks`

Why this design:
- Keeps primary and compatibility metadata paths available for varied MCP/OAuth clients.
- Allows clients to discover auth and token requirements without Tasky-specific setup.

### 3) MCP JSON-RPC handler (`convex/mcp.ts`)

`mcpServerHandler` is the central server entrypoint.

- Wrapped in `withMcpAuth(...)`, which authenticates bearer tokens and yields `session`.
- Handles core JSON-RPC methods:
  - `initialize`
  - `notifications/initialized`
  - `tools/list`
  - `tools/call`
- Tool catalog is defined in `getToolsList()` (currently `readTasks` and `updateTask`).
- `tools/call` performs:
  1. Tool name check
  2. Scope check
  3. Argument parsing/normalization
  4. Convex query/mutation execution
  5. MCP-formatted response (`result.content` text payload)

Why this design:
- Explicit dispatch keeps tool behavior auditable and deterministic.
- JSON-RPC error codes are returned in one place, improving client interoperability.

### 4) Scope parsing helpers (`convex/mcpScopes.ts`)

Current scope model includes:

- Capability scopes (`tasks:read`, `tasks:write`)
- Resource constraint scope prefix: `tag:root=<tagId>`

Current behavior:
- Scope string is split by whitespace.
- Authorization checks are exact-match (`hasRequiredScope`).
- One `tag:root=` scope is parsed (first matching value).

Why this design:
- Simple now, easy to evolve toward richer policy logic without touching every tool.

### 5) Tool data operations (`convex/tasks.ts`)

`listForMcp` is an internal query used by `readTasks`.

- Inputs: `userId`, optional `statuses`, optional `includeClosed`, optional `tagRootId`, optional `searchQuery`, optional `filterTag`.
- Default behavior returns only open statuses unless `includeClosed` or explicit statuses are supplied.
- Optional `searchQuery` uses Convex full-text search (`search_content`) on task content.
- Optional `tagRootId` constrains results to a tag subtree via `childrenRecursive`.
- Optional `filterTag` resolves the closest matching user tag (trimmed/lowercased matching) and constrains results to that tag subtree.
- Returns task fields plus attachment details:
  - `agents`: full agent docs (including `_id`, `externalId`, `link`, `title`, `status`, sync metadata)
  - `pullRequests`: full pull request docs plus `normalized` URL parse details when available

`updateFromMcp` is an internal mutation used by `updateTask`.

- Inputs:
  - required: `userId`, `id` (task id)
  - partial task fields: `content`, `status`, `priority`, `dueDate`
  - attachment operations:
    - `addAgent` (single string: `bc-...` or Cursor agent URL)
    - `removeAgentById` (agent doc id returned by `readTasks`)
    - `addPullRequestByUrl` (single GitHub PR URL string)
    - `removePullRequestByUrl` (single GitHub PR URL string)
- `dueDate` format:
  - `YYYY-MM-DD` to set
  - `null` to clear
- Patch behavior is additive/default-preserving:
  - omitted fields are not changed
  - add operations are additive
  - removals happen only when explicitly requested

Why this design:
- Keeps MCP transport concerns in `convex/mcp.ts` and data logic in task domain code.
- Ensures updates are explicit and non-destructive by default.

### 6) Frontend OAuth bridge pages

- Login bridge: `src/app/oauth/login/page.tsx`
- Consent UI: `src/app/oauth/consent/page.tsx`
- Continue endpoint: `src/app/api/oauth/mcp/continue/route.ts`

These pages/route exist to make the MCP OAuth flow work smoothly across frontend and Convex auth domains.

Why this design:
- Preserves normal app sign-in UX.
- Safely forwards the Better Auth cookie to continue authorization.
- Validates the target authorize URL before proxying to reduce abuse risk.

## End-to-end Request Flow

1. MCP client discovers metadata and authorization server details from Convex endpoints.
2. User signs in and grants scopes via Tasky login/consent pages.
3. Client receives token for `aud = /api/mcp` resource.
4. Client sends JSON-RPC request to `/api/mcp`.
5. `withMcpAuth` authenticates token and provides `session.scopes`.
6. Tool dispatch in `tools/call` checks scopes and runs internal Convex logic.
7. Response is returned as MCP JSON-RPC result content.

## Current Tool Contracts

### `readTasks` (`tasks:read`)

Input:

- `includeClosed?: boolean`
- `statuses?: Array<"not_started" | "in_progress" | "blocked" | "closed">`
- `searchQuery?: string`
- `filterTag?: string`
  - Matching behavior: both query and tag names are trimmed/lowercased; closest match is selected by priority (exact > prefix > contains variants), then tie-broken by name-length difference.

Output:

- Task list including core task fields, `tags` (tag names only), `agents`, and `pullRequests`.

### `updateTask` (`tasks:write`)

Input:

- `taskId: string` (required)
- Optional task patches:
  - `content?: string`
  - `status?: "not_started" | "in_progress" | "blocked" | "closed"`
  - `priority?: "triage" | "low" | "medium" | "high"`
  - `dueDate?: "YYYY-MM-DD" | null`
- Optional attachment operations:
  - `addAgent?: string`
  - `removeAgentById?: string`
  - `addPullRequestByUrl?: string`
  - `removePullRequestByUrl?: string`

Notes:

- At least one update field/operation is required.
- `removeAgentById` should use agent ids from `readTasks`.
- Tool schema includes docs for due-date format and clear semantics.

## Architectural Decisions and Trade-offs

### Better Auth plugin-first strategy

Decision:
- Use Better Auth's `mcp`, `jwt`, and Convex adapters rather than implementing OAuth/OIDC manually.

Trade-off:
- Faster implementation and standards correctness, but constrained by plugin behavior and extension points.

### Single MCP endpoint with internal tool router

Decision:
- Route all tool calls through `/api/mcp` and dispatch by tool name in app code.

Trade-off:
- Centralized validation and observability, but requires keeping tool schemas + dispatch logic synchronized.

### Scope checks in server entrypoint

Decision:
- Perform scope authorization before running domain queries/mutations.

Trade-off:
- Prevents accidental privilege escalation; however, more advanced policies (field-level/resource-level) need additional infrastructure.

### Tag-root scoping encoded as scope string

Decision:
- Model resource scoping as `tag:root=<tagId>`.

Trade-off:
- Lightweight and easy to issue; currently only one root is honored and parser is intentionally minimal.

## Follow-up Work: Dynamic Scopes

The repo currently has foundational pieces for dynamic/resource scopes, but enforcement remains intentionally simple.

Recommended next steps:

1. Define dynamic scope contract
- Decide canonical grammar for resource scopes beyond `tag:root=...` (single vs multiple roots, future resources).
- Decide conflict behavior (intersection vs union) when multiple resource scopes are present.

2. Expand parser and validation in `mcpScopes`
- Parse all supported dynamic scopes into typed structures (not just a single optional value).
- Reject malformed dynamic scopes explicitly (and surface clear errors).

3. Centralize policy checks
- Evolve `hasRequiredScope` into capability + resource evaluation helpers.
- Keep tool handlers declarative, for example: "requires capability X and resource predicate Y".

4. Ensure token issuance matches requested scopes
- Verify consent + grant logic honors and persists dynamic scopes as requested.
- Add tests for round-tripping dynamic scopes from request -> token -> runtime session.

5. Add focused test coverage
- Unit tests for parser/policy.
- Integration tests for token scopes gating `tools/call`.
- Regression tests for invalid/forged scope strings.

Design note:
- Prefer "default deny" when dynamic scopes are present but unparsable.

## Follow-up Work: Adding New MCP Tools/Endpoints

When adding a new MCP tool (for example `createTask`):

1. Add scope and policy
- Add/confirm capability scope in `oauthScopes` and `mcpScopes`.
- Decide whether resource scopes (tag constraints, etc.) should apply.

2. Add tool schema to `getToolsList()`
- Keep input schema strict (`additionalProperties: false`).
- Ensure argument names/types mirror the eventual Convex call.

3. Extend `tools/call` dispatch
- Validate tool name, required scope(s), and arguments.
- Return JSON-RPC error codes for not found, unauthorized, or invalid input.

4. Implement domain operation
- Prefer a dedicated internal query/mutation for MCP usage if output/input differs from app UI behavior.
- Keep returned payload minimal and stable.

5. Update docs and verification
- Update `README.md` scopes/tools section.
- Validate flow from auth -> consent -> `tools/list` -> `tools/call`.

If adding a non-tool endpoint:
- Register route in `convex/http.ts`.
- Add CORS behavior intentionally (metadata endpoints are broadly consumable; mutation endpoints may need stricter handling).
- Keep endpoint purpose distinct from JSON-RPC tool operations.

## Testing and Verification Checklist

- Metadata discovery endpoints respond with expected JSON and CORS headers.
- OAuth login + consent flow completes from MCP client.
- Access token contains expected scopes.
- `tools/list` shows expected tools and schemas.
- `tools/call`:
  - succeeds with valid scope + args
  - fails with clear error on missing scope
  - fails safely on malformed args
- Resource scope constraints (for example `tag:root`) are enforced.

## Current Known Gaps / Intentional Limits

- Dynamic/resource scope handling is intentionally basic.
- `readTasks` returns JSON as text content; richer typed MCP content can be added later if needed.

## Practical Extension Guidelines

- Keep auth/protocol concerns in `auth.ts` + `mcp.ts`; keep data logic in domain modules.
- Add explicit scope checks for every new tool, even if "obvious".
- Favor backward-compatible schema evolution (new optional args over breaking changes).
- Add tests before broadening scope semantics.
