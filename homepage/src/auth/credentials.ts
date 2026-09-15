import { SignJWT, jwtVerify } from "jose";
import { identitySchema } from "@tasky/home-feed";
import { origin, sessionLifetime, type Env } from "../env";
import { base64ToBytes, bytesToBase64 } from "../transport";

export const SESSION_COOKIE = "__Host-home-session";
export const REMEMBER_COOKIE = "__Host-home-remember";
export const LOGIN_COOKIE = "__Host-home-login";
export const REMEMBER_SECONDS = 30 * 86400;
export type Identity = {
  userId: string;
  displayName: string;
  email?: string;
  emailVerified?: boolean;
};
export type SessionClaims = { userId: string; sid: string; exp: number };

export function cookie(name: string, value: string, seconds: number) {
  return `${name}=${value}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=${seconds}`;
}
export function readCookie(request: Request, name: string) {
  const values = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.startsWith(`${name}=`));
  return values.length === 1 ? values[0].slice(name.length + 1) : undefined;
}
function keyring(env: Env): Record<string, string> {
  const keys = JSON.parse(env.SESSION_KEYS);
  if (!keys || typeof keys !== "object")
    throw new Error("Invalid session keyring");
  return keys;
}
function signingKey(keys: Record<string, string>, kid: string) {
  const encoded = Object.hasOwn(keys, kid) ? keys[kid] : undefined;
  if (typeof encoded !== "string") throw new Error("Unknown signing key");
  const key = base64ToBytes(encoded);
  if (key.length < 32) throw new Error("Signing key too short");
  return key;
}
export async function issueSession(
  env: Env,
  userId: string,
  sid: string,
  now = Date.now(),
) {
  identitySchema.parse(userId);
  const issued = Math.floor(now / 1000);
  return new SignJWT({ sid, scope: "homepage:read" })
    .setProtectedHeader({
      alg: "HS256",
      kid: env.SESSION_ACTIVE_KID,
      typ: "home+jwt",
    })
    .setIssuer(origin(env.HOME_ORIGIN))
    .setAudience("tasky-homepage:read")
    .setSubject(userId)
    .setIssuedAt(issued)
    .setExpirationTime(issued + sessionLifetime(env))
    .sign(signingKey(keyring(env), env.SESSION_ACTIVE_KID));
}
export async function verifySession(
  env: Env,
  token: string | undefined,
  now = Date.now(),
): Promise<SessionClaims | null> {
  if (!token || token.length > 2048) return null;
  try {
    const { payload } = await jwtVerify(
      token,
      (header) => {
        if (header.typ !== "home+jwt" || !header.kid)
          throw new Error("Invalid token type");
        return signingKey(keyring(env), header.kid);
      },
      {
        algorithms: ["HS256"],
        issuer: origin(env.HOME_ORIGIN),
        audience: "tasky-homepage:read",
        currentDate: new Date(now),
        requiredClaims: ["sub", "iat", "exp", "sid", "scope"],
      },
    );
    if (
      payload.scope !== "homepage:read" ||
      typeof payload.sid !== "string" ||
      !/^[\w-]{43}$/.test(payload.sid)
    )
      return null;
    if (
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.exp - payload.iat > 86400 ||
      payload.iat > now / 1000 + 30
    )
      return null;
    return {
      userId: identitySchema.parse(payload.sub),
      sid: payload.sid,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

async function encryptionKey(env: Env) {
  const bytes = base64ToBytes(env.GRANT_ENCRYPTION_KEY);
  if (bytes.length !== 32) throw new Error("Invalid grant encryption key");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function encryptGrant(env: Env, token: string, sessionId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(sessionId),
    },
    await encryptionKey(env),
    new TextEncoder().encode(token),
  );
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}
export async function decryptGrant(
  env: Env,
  ciphertext: string,
  sessionId: string,
) {
  const [iv, data] = ciphertext.split(".");
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(iv),
        additionalData: new TextEncoder().encode(sessionId),
      },
      await encryptionKey(env),
      base64ToBytes(data),
    ),
  );
}
