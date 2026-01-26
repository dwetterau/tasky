# Deployment notes

- Deployed on vercel, hobby plan
- Vercel needed Convex's general "build convex" as a build command
- Vercel needed the following env variables:
    - NEXT_PUBLIC_CONVEX_SITE_URL
    - CONVEX_DEPLOY_KEY
- Also Prod has its own Github app, with a client secret and ID that Convex needed
- Convex also needed the SITE_URL to properly work with CORS