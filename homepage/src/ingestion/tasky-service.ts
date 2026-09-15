import { origin, type Env } from "../env";
import { signedHeaders } from "../transport";

export async function taskyService<T>(
  env: Env,
  path: "/api/homepage/enroll" | "/api/homepage/weather-key",
  body: { userId: string; timezone?: string },
): Promise<T> {
  const serialized = JSON.stringify(body);
  const response = await fetch(`${origin(env.TASKY_ISSUER)}${path}`, {
    method: "POST",
    // Workers supports manual redirects; the response.ok check rejects them.
    redirect: "manual",
    headers: await signedHeaders(env.PROVISIONING_SECRET, path, serialized),
    body: serialized,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    console.warn(
      JSON.stringify({
        event: "homepage_service_failed",
        path,
        status: response.status,
      }),
    );
    await response.body?.cancel();
    throw new Error("Tasky background request failed");
  }
  return response.json() as Promise<T>;
}
