const encoder = new TextEncoder();
function base64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
async function key(secret: string) {
  if (!secret || secret.length < 32)
    throw new Error("Homepage service secret is not configured");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function homepageHeaders(
  secret: string,
  path: string,
  body: string,
  now = Date.now(),
) {
  const time = String(now);
  return {
    "content-type": "application/json",
    "user-agent": "Tasky-Homepage/1.0",
    "x-home-timestamp": time,
    "x-home-signature": base64(
      new Uint8Array(
        await crypto.subtle.sign(
          "HMAC",
          await key(secret),
          encoder.encode(`POST\n${path}\n${time}\n${body}`),
        ),
      ),
    ),
  };
}
export async function verifyHomepageRequest(
  request: Request,
  body: string,
  secret: string,
) {
  const time = request.headers.get("x-home-timestamp") ?? "";
  const signature = request.headers.get("x-home-signature") ?? "";
  if (
    !/^\d{13}$/.test(time) ||
    Math.abs(Date.now() - Number(time)) > 300_000 ||
    !/^[\w-]{43}$/.test(signature)
  )
    return false;
  const bytes = Uint8Array.from(
    atob(signature.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  return crypto.subtle.verify(
    "HMAC",
    await key(secret),
    bytes,
    encoder.encode(
      `${request.method}\n${new URL(request.url).pathname}\n${time}\n${body}`,
    ),
  );
}
