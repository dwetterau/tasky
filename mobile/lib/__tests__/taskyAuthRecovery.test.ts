import { describe, expect, it } from "@jest/globals";
import {
  TASKY_AUTH_BACKGROUND_REFRESH_MS,
  TASKY_AUTH_RETRY_MAX_MS,
  isRetryableTaskyTokenError,
  shouldRestartTaskyAuthOnForeground,
  taskyAuthRetryDelay,
} from "../taskyAuthRecovery";

describe("Tasky auth recovery", () => {
  it("restarts after a long background interval or a lost token", () => {
    expect(
      shouldRestartTaskyAuthOnForeground({
        hasSession: true,
        hasCachedToken: true,
        backgroundedAt: 1_000,
        now: 1_000 + TASKY_AUTH_BACKGROUND_REFRESH_MS,
      }),
    ).toBe(true);
    expect(
      shouldRestartTaskyAuthOnForeground({
        hasSession: true,
        hasCachedToken: false,
        backgroundedAt: null,
        now: 1_000,
      }),
    ).toBe(true);
  });

  it("does not restart without a session or after a short interruption", () => {
    expect(
      shouldRestartTaskyAuthOnForeground({
        hasSession: false,
        hasCachedToken: false,
        backgroundedAt: 1_000,
        now: 1_000 + TASKY_AUTH_BACKGROUND_REFRESH_MS,
      }),
    ).toBe(false);
    expect(
      shouldRestartTaskyAuthOnForeground({
        hasSession: true,
        hasCachedToken: true,
        backgroundedAt: 1_000,
        now: 1_000 + TASKY_AUTH_BACKGROUND_REFRESH_MS - 1,
      }),
    ).toBe(false);
  });

  it("backs off transient retries and caps the delay", () => {
    expect(taskyAuthRetryDelay(0)).toBe(1_000);
    expect(taskyAuthRetryDelay(3)).toBe(8_000);
    expect(taskyAuthRetryDelay(20)).toBe(TASKY_AUTH_RETRY_MAX_MS);
  });

  it("retries transport and server failures, but not rejected sessions", () => {
    expect(isRetryableTaskyTokenError(new Error("offline"))).toBe(true);
    expect(isRetryableTaskyTokenError({ status: 0 })).toBe(true);
    expect(isRetryableTaskyTokenError({ status: 503 })).toBe(true);
    expect(isRetryableTaskyTokenError({ status: 401 })).toBe(false);
    expect(isRetryableTaskyTokenError(null)).toBe(false);
  });
});
