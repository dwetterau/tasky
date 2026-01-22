import { createAuthClient } from "better-auth/react";
import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";

// The auth endpoints are on the Convex site URL (different domain from Next.js app)
const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL!;

export const authClient = createAuthClient({
  baseURL: convexSiteUrl,
  plugins: [
    // crossDomainClient handles cross-origin requests to Convex
    crossDomainClient(),
    convexClient(),
  ],
});
