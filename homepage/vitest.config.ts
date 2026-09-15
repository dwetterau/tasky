import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { readFileSync } from "node:fs";
export default defineConfig({
  plugins: [
    { name: "svg-text", enforce: "pre", load(id) { if (id.endsWith(".svg")) return `export default ${JSON.stringify(readFileSync(id, "utf8"))}`; } },
    cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" }, miniflare: { bindings: {
      HOME_ORIGIN: "https://home.example.test", TASKY_ORIGIN: "https://tasky.example.test", TASKY_ISSUER: "https://tasky.convex.site",
      OAUTH_CLIENT_ID: "tasky-homepage", OAUTH_CLIENT_SECRET: "fixture-oauth-secret-only-not-a-real-secret",
      SESSION_ACTIVE_KID: "test", SESSION_KEYS: JSON.stringify({ test: "dGVzdC1vbmx5LWtleS1tdXN0LWJlLWF0LWxlYXN0LTMyLWJ5dGVz" }),
      GRANT_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY",
      INGESTION_SECRET: "fixture-ingestion-only-32-bytes-long-secret",
      PROVISIONING_SECRET: "fixture-provision-only-32-bytes-long-secret",
      ALLOWED_USER_IDS: "user-a,user-b", ALLOWED_EMAILS: "", WEATHER_CONFIG: "", DEFAULT_TIMEZONE: "America/New_York",
    } } }),
  ],
  test: { include: ["tests/**/*.test.ts"], testTimeout: 20000, fileParallelism: false },
});
