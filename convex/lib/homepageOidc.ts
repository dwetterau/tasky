import {
  APIError,
  createAuthEndpoint,
  getSessionFromCtx,
} from "better-auth/api";
import { oidcProvider } from "better-auth/plugins";
import { z } from "zod";

/** Better Auth 1.4.9's MCP plugin exposes only its own authorize/token routes.
 * Register the maintained OIDC implementation explicitly for the homepage.
 * Tasky's frontend login page resumes authorization with its stored session,
 * so this adapter does not install a second provider's automatic login hook. */
export function homepageOidc(options: {
  origin: string;
  clientId: string;
  clientSecret: string;
  loginPage: string;
  consentPage: string;
}) {
  const provider = oidcProvider({
    loginPage: options.loginPage,
    consentPage: options.consentPage,
    trustedClients: [
      {
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        name: "Tasky Homepage",
        type: "web",
        disabled: false,
        redirectUrls: [`${options.origin}/auth/callback`],
        metadata: null,
      },
    ],
    scopes: ["openid", "profile", "email", "offline_access"],
    defaultScope: "openid profile email offline_access",
    useJWTPlugin: true,
    requirePKCE: true,
    allowPlainCodeChallengeMethod: false,
    allowDynamicClientRegistration: false,
    schema: { oauthApplication: { fields: { redirectUrls: "redirectURLs" } } },
  });
  return {
    id: "homepage-oidc",
    endpoints: {
      homepageAuthorize: createAuthEndpoint(
        "/oauth2/authorize",
        { method: "GET", query: z.record(z.string(), z.string()) },
        async (ctx) => {
          if (ctx.query.client_id !== options.clientId)
            throw new APIError("BAD_REQUEST", { error: "invalid_client" });
          if (!(await getSessionFromCtx(ctx))) {
            // Avoid oidc_login_prompt: the existing MCP hook owns that cookie and
            // cannot resume a trusted OIDC client. The login UI preserves the URL.
            const params = new URLSearchParams(ctx.query);
            params.set("flow", "homepage");
            const query = params.toString();
            throw ctx.redirect(`${options.loginPage}?${query}`);
          }
          return provider.endpoints.oAuth2authorize({
            ...ctx,
            asResponse: true,
          });
        },
      ),
      homepageToken: createAuthEndpoint(
        "/oauth2/token",
        provider.endpoints.oAuth2token.options,
        async (ctx) => {
          // The pinned provider's refresh branch does not check the confidential
          // client secret. This first-party adapter requires client_secret_post
          // for both code exchange and renewal before entering that branch.
          const secret = ctx.body.client_secret;
          if (
            ctx.body.client_id !== options.clientId ||
            typeof secret !== "string" ||
            secret.length > 1024
          )
            throw new APIError("UNAUTHORIZED", { error: "invalid_client" });
          const digest = async (value: string) =>
            new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(value),
              ),
            );
          const [actual, expected] = await Promise.all([
            digest(secret),
            digest(options.clientSecret),
          ]);
          let difference = 0;
          for (let index = 0; index < actual.length; index++)
            difference |= actual[index] ^ expected[index];
          if (difference)
            throw new APIError("UNAUTHORIZED", { error: "invalid_client" });
          return provider.endpoints.oAuth2token({ ...ctx, asResponse: true });
        },
      ),
      homepageUserInfo: provider.endpoints.oAuth2userInfo,
    },
    // Consent remains the original shared endpoint supplied by MCP, which uses
    // this same provider's consent implementation and existing schema.
  };
}
