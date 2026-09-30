const transientParameters = [
  "ott",
  "authError",
  "error",
  "error_description",
  "authFlow",
];

/** Return to the same OAuth transaction after GitHub signs the user in. */
export function signInCallbackUrl(currentUrl: string) {
  const url = new URL(currentUrl);
  url.hash = "";
  for (const name of transientParameters) url.searchParams.delete(name);
  return url.toString();
}

export function oauthAuthorizeUrl(issuer: string, search: string) {
  const params = new URLSearchParams(search);
  const endpoint = params.get("flow") === "homepage" ? "oauth2" : "mcp";
  params.delete("flow");
  params.delete("client_name");
  for (const name of transientParameters) params.delete(name);
  if (!params.get("client_id") || !params.get("redirect_uri")) return null;
  return `${issuer}/api/auth/${endpoint}/authorize?${params}`;
}

export function oauthApplicationName(params: URLSearchParams) {
  return params.get("flow") === "homepage"
    ? "Tasky Homepage"
    : params.get("client_name")?.trim() || "MCP client";
}

export function oauthPermissionDescriptions(scopes: string[]) {
  const requested = new Set(scopes);
  const descriptions: string[] = [];

  const identityScopes = ["openid", "profile", "email"];
  if (identityScopes.some((scope) => requested.has(scope))) {
    descriptions.push(
      requested.has("email")
        ? "Identify your Tasky account and profile, including your email address"
        : "Identify your Tasky account and profile",
    );
  }
  if (requested.has("offline_access")) {
    descriptions.push("Stay signed in between visits");
  }

  const addCapability = (
    readScope: string,
    writeScope: string,
    readLabel: string,
    writeLabel: string,
    combinedLabel: string,
  ) => {
    const canRead = requested.has(readScope);
    const canWrite = requested.has(writeScope);
    if (canRead && canWrite) descriptions.push(combinedLabel);
    else if (canRead) descriptions.push(readLabel);
    else if (canWrite) descriptions.push(writeLabel);
  };

  addCapability(
    "tasks:read",
    "tasks:write",
    "Read your tasks",
    "Create and update your tasks",
    "Read, create, and update your tasks",
  );
  addCapability(
    "signals:read",
    "signals:write",
    "Read your signals",
    "Create and update your signals",
    "Read, create, and update your signals",
  );
  addCapability(
    "widgets:read",
    "widgets:write",
    "Read content published to your home widgets",
    "Publish content to your home widgets",
    "Read and publish content for your home widgets",
  );

  const knownScopes = new Set([
    ...identityScopes,
    "offline_access",
    "tasks:read",
    "tasks:write",
    "signals:read",
    "signals:write",
    "widgets:read",
    "widgets:write",
  ]);
  descriptions.push(...scopes.filter((scope) => !knownScopes.has(scope)));
  return descriptions;
}
