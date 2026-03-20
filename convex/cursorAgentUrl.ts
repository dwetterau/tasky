/** Matches Cursor agent external IDs after the `bc-` prefix (e.g. short tokens or UUID-style). */
const BC_AGENT_ID_BODY = /^bc-[A-Za-z0-9.-]+$/;

function isCursorAgentsHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "cursor.com" || h.endsWith(".cursor.com");
}

/**
 * Parses a Cursor agent external id from raw `bc-...` input or a Cursor agents URL.
 * Accepts any subdomain of cursor.com (e.g. staging.cursor.com). Query strings and
 * fragments on URLs are ignored by URL parsing; for pasted `bc-...?foo=bar`, the
 * query is stripped before validating the id.
 */
export function extractCursorAgentExternalId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const bareId = trimmed.split(/[?#]/)[0].trim();
  if (BC_AGENT_ID_BODY.test(bareId)) {
    return bareId;
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (!isCursorAgentsHostname(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && parts[0] === "agents" && BC_AGENT_ID_BODY.test(parts[1])) {
      return parts[1];
    }
  } catch {
    return null;
  }
  return null;
}
