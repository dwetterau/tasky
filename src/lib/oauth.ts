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
    : params.get("client_name") ||
        params.get("client_id") ||
        "your application";
}
