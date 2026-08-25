/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents from "../agents.js";
import type * as apiKeys from "../apiKeys.js";
import type * as auth from "../auth.js";
import type * as captures from "../captures.js";
import type * as cursorAgentUrl from "../cursorAgentUrl.js";
import type * as events from "../events.js";
import type * as githubRepos from "../githubRepos.js";
import type * as http from "../http.js";
import type * as lib_signalStatus from "../lib/signalStatus.js";
import type * as linearIssues from "../linearIssues.js";
import type * as mcp from "../mcp.js";
import type * as mcpScopes from "../mcpScopes.js";
import type * as mcpTools_common from "../mcpTools/common.js";
import type * as mcpTools_signals from "../mcpTools/signals.js";
import type * as migrations from "../migrations.js";
import type * as notes from "../notes.js";
import type * as onboarding from "../onboarding.js";
import type * as portfolio from "../portfolio.js";
import type * as pullRequests from "../pullRequests.js";
import type * as signals from "../signals.js";
import type * as tags from "../tags.js";
import type * as tasks from "../tasks.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agents: typeof agents;
  apiKeys: typeof apiKeys;
  auth: typeof auth;
  captures: typeof captures;
  cursorAgentUrl: typeof cursorAgentUrl;
  events: typeof events;
  githubRepos: typeof githubRepos;
  http: typeof http;
  "lib/signalStatus": typeof lib_signalStatus;
  linearIssues: typeof linearIssues;
  mcp: typeof mcp;
  mcpScopes: typeof mcpScopes;
  "mcpTools/common": typeof mcpTools_common;
  "mcpTools/signals": typeof mcpTools_signals;
  migrations: typeof migrations;
  notes: typeof notes;
  onboarding: typeof onboarding;
  portfolio: typeof portfolio;
  pullRequests: typeof pullRequests;
  signals: typeof signals;
  tags: typeof tags;
  tasks: typeof tasks;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
};
