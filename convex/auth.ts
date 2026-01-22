import { betterAuth } from "better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";

// SITE_URL is the frontend URL (Next.js app) - where users get redirected after auth
const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";
// CONVEX_SITE_URL is where Better Auth is hosted (Convex HTTP endpoints)
const convexSiteUrl = process.env.CONVEX_SITE_URL!;

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    // baseURL must be the Convex site URL where auth endpoints are hosted
    baseURL: convexSiteUrl,
    trustedOrigins: [siteUrl, convexSiteUrl],
    database: authComponent.adapter(ctx),
    plugins: [
      // crossDomain redirects users back to the frontend after OAuth
      crossDomain({ siteUrl }),
      convex({ authConfig }),
    ],
    socialProviders: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
        // Explicitly set the redirect URI to the Convex site
        redirectURI: `${convexSiteUrl}/api/auth/callback/github`,
      },
    },
  });

// Helper to get the current user ID (returns string or null)
export async function getAuthUserId(ctx: GenericCtx<DataModel>): Promise<string | null> {
  const user = await authComponent.safeGetAuthUser(ctx);
  return user?._id ?? null;
}
