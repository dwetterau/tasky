# Tasky

A personal task manager built with Next.js and Convex.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Set up Convex

```bash
npx convex dev
```

This will prompt you to log in and create a project. Keep this running.

### 3. Create GitHub OAuth App

1. Go to https://github.com/settings/developers
2. Click "New OAuth App"
3. Set Homepage URL: `http://localhost:3000`
4. Set Callback URL: `https://<your-project>.convex.site/api/auth/callback/github`
5. Copy the Client ID and Client Secret

### 4. Set environment variables

```bash
npx convex env set SITE_URL "http://localhost:3000"
npx convex env set CONVEX_SITE_URL "https://<your-project>.convex.site"
npx convex env set GITHUB_CLIENT_ID "<your-github-client-id>"
npx convex env set GITHUB_CLIENT_SECRET "<your-github-client-secret>"
```

The default OAuth UI pages in this app are:

- Login page: `/oauth/login`
- Consent page: `/oauth/consent`

The JWT/JWKS signing keys are managed by Better Auth's JWT plugin (stored in Convex). You do not need to manually set `JWT_PRIVATE_KEY`/`JWKS` for this setup.

Generate and set an encryption secret for API keys:

```bash
npx convex env set API_KEYS_ENCRYPTION_SECRET "$(openssl rand -base64 32 | tr -d '\n')"
```

### 5. Run the app

```bash
npm run dev
```

Open http://localhost:3000

## MCP + OAuth2.1 endpoints

These are exposed from Convex HTTP routes:

- MCP endpoint: `https://<your-project>.convex.site/api/mcp`
- Protected resource metadata: `https://<your-project>.convex.site/.well-known/oauth-protected-resource`
- OAuth authorization server metadata: `https://<your-project>.convex.site/api/auth/.well-known/oauth-authorization-server`
- OpenID config metadata: `https://<your-project>.convex.site/api/auth/.well-known/openid-configuration`
- JWKS: `https://<your-project>.convex.site/api/auth/jwks`

## MCP scopes (v1)

Supported capability scopes:

- `tasks:read` (required for `readTasks`)
- `tasks:write` (reserved for future tool mutations)

Supported resource scope:

- `tag:root=<tagId>` (optional, single-root tag filter)

`readTasks` defaults to returning non-closed tasks (`not_started`, `in_progress`, `blocked`).
