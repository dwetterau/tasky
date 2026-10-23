import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

export function deploymentConfig(template, env) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const namespaceId = env.HOMEPAGE_EDITIONS_KV_ID;
  for (const [name, value] of Object.entries({
    CLOUDFLARE_ACCOUNT_ID: accountId,
    HOMEPAGE_EDITIONS_KV_ID: namespaceId,
  })) {
    if (!/^[a-f0-9]{32}$/i.test(value ?? "") || /^0+$/.test(value)) {
      throw new Error(`Set ${name} to a real deployment ID in private configuration.`);
    }
  }
  const timezone = env.HOMEPAGE_DEFAULT_TIMEZONE;
  if (!timezone) throw new Error("Set HOMEPAGE_DEFAULT_TIMEZONE in private configuration.");
  new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  if (template.kv_namespaces.filter((binding) => binding.binding === "EDITIONS").length !== 1) {
    throw new Error("Expected exactly one EDITIONS namespace binding.");
  }
  return {
    ...template,
    account_id: accountId,
    kv_namespaces: template.kv_namespaces.map((binding) =>
      binding.binding === "EDITIONS" ? { ...binding, id: namespaceId } : binding,
    ),
    vars: { ...template.vars, DEFAULT_TIMEZONE: timezone },
  };
}

function main() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const local = resolve(root, ".env.homepage-deploy");
  if (existsSync(local)) process.loadEnvFile(local);
  const template = JSON.parse(readFileSync(resolve(root, "wrangler.jsonc"), "utf8"));
  const config = deploymentConfig(template, process.env);
  const temporary = resolve(root, `.wrangler-deploy-${randomUUID()}.json`);
  writeFileSync(temporary, JSON.stringify(config), { mode: 0o600, flag: "wx" });
  try {
    const result = spawnSync(process.execPath, [
      resolve(root, "node_modules/wrangler/bin/wrangler.js"),
      "deploy", "--config", temporary, ...process.argv.slice(2),
    ], { cwd: root, env: process.env, stdio: "inherit" });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    unlinkSync(temporary);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
