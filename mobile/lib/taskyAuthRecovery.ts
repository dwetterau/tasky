export const TASKY_AUTH_BACKGROUND_REFRESH_MS = 60_000;
export const TASKY_AUTH_RETRY_MAX_MS = 30_000;

export function shouldRestartTaskyAuthOnForeground({
  hasSession,
  hasCachedToken,
  backgroundedAt,
  now,
}: {
  hasSession: boolean;
  hasCachedToken: boolean;
  backgroundedAt: number | null;
  now: number;
}): boolean {
  if (!hasSession) {
    return false;
  }
  if (!hasCachedToken) {
    return true;
  }
  return (
    backgroundedAt !== null &&
    now - backgroundedAt >= TASKY_AUTH_BACKGROUND_REFRESH_MS
  );
}

export function taskyAuthRetryDelay(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt), TASKY_AUTH_RETRY_MAX_MS);
}

export function isRetryableTaskyTokenError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }
  if (typeof error !== "object" || !("status" in error)) {
    return true;
  }

  const status = error.status;
  if (typeof status !== "number") {
    return true;
  }
  return status === 0 || status === 408 || status === 429 || status >= 500;
}
