# Deployment notes

- Deployed on vercel, hobby plan
- Vercel needed Convex's general "build convex" as a build command
- Vercel needed the following env variables:
    - NEXT_PUBLIC_CONVEX_SITE_URL
    - CONVEX_DEPLOY_KEY
    - SITE_URL
    - CONVEX_SITE_URL
    - GITHUB_CLIENT_ID
    - GITHUB_CLIENT_SECRET

- Also Prod has its own GitHub OAuth app credentials for Convex auth.
- Convex needs `SITE_URL` + `CONVEX_SITE_URL` for cross-domain auth and trusted origins.

## MCP/OAuth verification checklist

- `GET ${CONVEX_SITE_URL}/api/auth/.well-known/oauth-authorization-server`
- `GET ${CONVEX_SITE_URL}/api/auth/.well-known/openid-configuration`
- `GET ${CONVEX_SITE_URL}/api/auth/jwks`
- `GET ${CONVEX_SITE_URL}/.well-known/oauth-protected-resource`
- `POST ${CONVEX_SITE_URL}/api/mcp` with a bearer token and JSON-RPC body