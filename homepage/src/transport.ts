import { HttpError } from "./env";
const encoder = new TextEncoder();
export function randomToken() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
}
export function bytesToBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
export function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
}
export async function digest(value: string) {
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
async function hmacKey(secret: string) {
  if (!secret || secret.length < 32) throw new Error("Service secret is not configured");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function signedHeaders(secret: string, path: string, body: string, now = Date.now()) {
  const time = String(now);
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(`POST\n${path}\n${time}\n${body}`));
  return { "content-type": "application/json", "user-agent": "Tasky-Homepage/1.0", "x-home-timestamp": time, "x-home-signature": bytesToBase64(new Uint8Array(signature)) };
}
export async function verifyRequest(request: Request, body: string, secret: string, now = Date.now()) {
  const time = request.headers.get("x-home-timestamp") ?? "";
  const signature = request.headers.get("x-home-signature") ?? "";
  if (!/^\d{13}$/.test(time) || Math.abs(now - Number(time)) > 300_000) return false;
  if (!/^[\w-]{43}$/.test(signature)) return false;
  return crypto.subtle.verify("HMAC", await hmacKey(secret), base64ToBytes(signature), encoder.encode(`${request.method}\n${new URL(request.url).pathname}\n${time}\n${body}`));
}
export async function limitedBody(request: Request, max: number) {
  if (Number(request.headers.get("content-length") || 0) > max) throw new HttpError(413, "Request too large");
  if (!request.body) return "";
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new HttpError(413, "Request too large"); }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
