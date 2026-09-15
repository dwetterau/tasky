export interface Env {
  EDITIONS: KVNamespace;
  PUBLISHERS: DurableObjectNamespace;
  SESSIONS: DurableObjectNamespace;
  COORDINATOR: DurableObjectNamespace;
  HOME_ORIGIN: string;
  TASKY_ORIGIN: string;
  TASKY_ISSUER: string;
  OAUTH_CLIENT_ID: string;
  OAUTH_CLIENT_SECRET: string;
  SESSION_KEYS: string;
  SESSION_ACTIVE_KID: string;
  GRANT_ENCRYPTION_KEY: string;
  INGESTION_SECRET: string;
  PROVISIONING_SECRET: string;
  ALLOWED_USER_IDS: string;
  ALLOWED_EMAILS: string;
  DEFAULT_TIMEZONE: string;
  SESSION_TTL_SECONDS?: string;
  WEATHER_CONFIG?: string;
}

export function origin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value)
    throw new Error("Invalid configured origin");
  return url.origin;
}

export function sessionLifetime(env: Env) {
  const value = Number(env.SESSION_TTL_SECONDS ?? 86400);
  if (!Number.isInteger(value) || value < 300 || value > 86400)
    throw new Error("Invalid session lifetime");
  return value;
}

export function allowed(
  env: Env,
  userId: string,
  email?: string,
  verified = false,
) {
  const ids = (env.ALLOWED_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const emails = (env.ALLOWED_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return (
    ids.includes(userId) ||
    Boolean(verified && email && emails.includes(email.toLowerCase()))
  );
}

export async function objectCall<T>(
  namespace: DurableObjectNamespace,
  name: string,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await namespace
    .get(namespace.idFromName(name))
    .fetch(`https://internal${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  if (!response.ok)
    throw new HttpError(response.status, "Background operation failed");
  return response.json() as Promise<T>;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
