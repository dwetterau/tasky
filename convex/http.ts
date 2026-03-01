import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import {
  mcpDeleteHandler,
  mcpGetHandler,
  mcpPostHandler,
  oauthAuthServerMetadataCompatGetHandler,
  oauthAuthServerMetadataCompatOptionsHandler,
  oauthJwksCompatGetHandler,
  oauthJwksCompatOptionsHandler,
  oauthOpenIdConfigCompatGetHandler,
  oauthOpenIdConfigCompatOptionsHandler,
  oauthProtectedResourceMetadataGetHandler,
  oauthProtectedResourceMetadataOptionsHandler,
} from "./mcp";

const http = httpRouter();

// Enable CORS since frontend (Next.js) is on a different domain
authComponent.registerRoutes(http, createAuth, { cors: true });

http.route({
  path: "/api/mcp",
  method: "GET",
  handler: mcpGetHandler,
});
http.route({
  path: "/api/mcp",
  method: "POST",
  handler: mcpPostHandler,
});
http.route({
  path: "/api/mcp",
  method: "DELETE",
  handler: mcpDeleteHandler,
});

http.route({
  path: "/.well-known/oauth-protected-resource",
  method: "GET",
  handler: oauthProtectedResourceMetadataGetHandler,
});
http.route({
  path: "/.well-known/oauth-protected-resource",
  method: "OPTIONS",
  handler: oauthProtectedResourceMetadataOptionsHandler,
});
http.route({
  path: "/api/auth/.well-known/oauth-protected-resource",
  method: "GET",
  handler: oauthProtectedResourceMetadataGetHandler,
});
http.route({
  path: "/api/auth/.well-known/oauth-protected-resource",
  method: "OPTIONS",
  handler: oauthProtectedResourceMetadataOptionsHandler,
});
http.route({
  path: "/api/auth/.well-known/oauth-authorization-server",
  method: "GET",
  handler: oauthAuthServerMetadataCompatGetHandler,
});
http.route({
  path: "/api/auth/.well-known/oauth-authorization-server",
  method: "OPTIONS",
  handler: oauthAuthServerMetadataCompatOptionsHandler,
});
http.route({
  path: "/.well-known/oauth-authorization-server",
  method: "GET",
  handler: oauthAuthServerMetadataCompatGetHandler,
});
http.route({
  path: "/.well-known/oauth-authorization-server",
  method: "OPTIONS",
  handler: oauthAuthServerMetadataCompatOptionsHandler,
});
http.route({
  path: "/api/auth/.well-known/openid-configuration",
  method: "GET",
  handler: oauthOpenIdConfigCompatGetHandler,
});
http.route({
  path: "/api/auth/.well-known/openid-configuration",
  method: "OPTIONS",
  handler: oauthOpenIdConfigCompatOptionsHandler,
});
http.route({
  path: "/api/auth/jwks",
  method: "GET",
  handler: oauthJwksCompatGetHandler,
});
http.route({
  path: "/api/auth/jwks",
  method: "OPTIONS",
  handler: oauthJwksCompatOptionsHandler,
});

export default http;
