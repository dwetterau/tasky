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
- Mobile app OAuth needs `MOBILE_APP_ORIGIN=tasky://` on each Convex deployment (dev and prod).

## What a push to `main` deploys

The Vercel project is connected to this repository and uses Convex's production
build command (`npx convex deploy --cmd 'npm run build'`) with
`CONVEX_DEPLOY_KEY`. A successful Vercel deployment therefore deploys both the
Next.js application and the production Convex schema/functions. Convex does not
need a separate GitHub Actions workflow.

The repository's `Deploy homepage` GitHub Actions workflow is separate. It
deploys only the Cloudflare homepage Worker under `homepage/`; it is not
evidence for or against a Convex deployment. Check the commit's **Vercel**
status when verifying Convex production deployment.

Useful verification commands:

```sh
# Confirm the production function validators contain a newly deployed kind.
npx convex function-spec --prod

# Inspect only the newest widget rows. Avoid pasting private dataJson payloads
# into logs or chat when a kind/count summary is sufficient.
npx convex data widgetData --prod --limit 20
```

Deploying code does not create widget data. Agent-published widgets remain
hidden until an authenticated client calls `publishWidgetData` for that kind.
Publishing a new row requests a homepage export automatically. MCP clients can
cache `tools/list`; reconnect the client if its input schema still lists only an
older widget kind after a successful deployment.

## MCP/OAuth verification checklist

- `GET ${CONVEX_SITE_URL}/api/auth/.well-known/oauth-authorization-server`
- `GET ${CONVEX_SITE_URL}/api/auth/.well-known/openid-configuration`
- `GET ${CONVEX_SITE_URL}/api/auth/jwks`
- `GET ${CONVEX_SITE_URL}/.well-known/oauth-protected-resource`
- `POST ${CONVEX_SITE_URL}/api/mcp` with a bearer token and JSON-RPC body