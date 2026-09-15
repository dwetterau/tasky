import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Generates local files only. Never prints credentials or changes a deployment.
const destination = resolve(process.cwd(), ".env.homepage-secrets.json");
const convexDestination = resolve(process.cwd(), ".env.homepage-convex");
if (existsSync(destination) || existsSync(convexDestination))
  throw new Error("Secret files already exist; refusing to rotate implicitly.");
const allowedEmails = process.env.HOMEPAGE_ALLOWED_EMAILS?.trim().toLowerCase();
if (!allowedEmails)
  throw new Error(
    "Set HOMEPAGE_ALLOWED_EMAILS to the initial account's email before preparing secrets.",
  );
const secret = () => randomBytes(32).toString("base64url");
const values = {
  OAUTH_CLIENT_SECRET: secret(),
  SESSION_KEYS: JSON.stringify({ v1: secret() }),
  SESSION_ACTIVE_KID: "v1",
  GRANT_ENCRYPTION_KEY: secret(),
  INGESTION_SECRET: secret(),
  PROVISIONING_SECRET: secret(),
  ALLOWED_EMAILS: allowedEmails,
};
writeFileSync(destination, JSON.stringify(values, null, 2), {
  mode: 0o600,
  flag: "wx",
});
const convex = {
  HOMEPAGE_ORIGIN: "https://home.davidw.tech",
  HOMEPAGE_OAUTH_CLIENT_ID: "tasky-homepage",
  HOMEPAGE_OAUTH_CLIENT_SECRET: values.OAUTH_CLIENT_SECRET,
  HOMEPAGE_INGESTION_SECRET: values.INGESTION_SECRET,
  HOMEPAGE_PROVISIONING_SECRET: values.PROVISIONING_SECRET,
  HOMEPAGE_ALLOWED_EMAILS: allowedEmails,
  // Delay after a successful export; retries use their own backoff.
  HOMEPAGE_EXPORT_INTERVAL_MS: "600000",
};
writeFileSync(
  convexDestination,
  Object.entries(convex)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n") + "\n",
  { mode: 0o600, flag: "wx" },
);
console.log(
  `Created ${destination} and ${convexDestination} (mode 0600). Values were not printed.`,
);
