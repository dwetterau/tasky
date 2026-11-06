import { APIError } from "better-auth/api";

const PRIVATE_DEPLOYMENT_MESSAGE = "This Tasky deployment is private.";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function allowedSignupEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map(normalizeEmail)
      .filter(Boolean),
  );
}

export function assertSignupEmailAllowed(
  email: string,
  configuredEmails: string | undefined,
): void {
  if (!allowedSignupEmails(configuredEmails).has(normalizeEmail(email))) {
    throw new APIError("FORBIDDEN", {
      message: PRIVATE_DEPLOYMENT_MESSAGE,
    });
  }
}
