import { test } from "node:test";
import assert from "node:assert/strict";
import { deploymentConfig } from "./deploy.mjs";

const template = {
  name: "fixture",
  kv_namespaces: [{ binding: "EDITIONS", id: "00000000000000000000000000000000" }],
  vars: { DEFAULT_TIMEZONE: "UTC", OAUTH_CLIENT_ID: "fixture" },
};
const env = {
  CLOUDFLARE_ACCOUNT_ID: "11111111111111111111111111111111",
  HOMEPAGE_EDITIONS_KV_ID: "22222222222222222222222222222222",
  HOMEPAGE_DEFAULT_TIMEZONE: "Europe/London",
};

test("deployment uses private settings while retaining unrelated configuration", () => {
  const result = deploymentConfig(template, env);
  assert.equal(result.account_id, env.CLOUDFLARE_ACCOUNT_ID);
  assert.equal(result.kv_namespaces[0].id, env.HOMEPAGE_EDITIONS_KV_ID);
  assert.equal(result.vars.DEFAULT_TIMEZONE, env.HOMEPAGE_DEFAULT_TIMEZONE);
  assert.equal(result.vars.OAUTH_CLIENT_ID, "fixture");
  assert.equal(template.vars.DEFAULT_TIMEZONE, "UTC");
});

test("deployment refuses absent, placeholder, malformed, or invalid private settings", () => {
  for (const field of Object.keys(env)) {
    assert.throws(() => deploymentConfig(template, { ...env, [field]: "" }));
  }
  for (const field of ["CLOUDFLARE_ACCOUNT_ID", "HOMEPAGE_EDITIONS_KV_ID"]) {
    for (const value of ["0".repeat(32), "invalid"]) {
      assert.throws(() => deploymentConfig(template, { ...env, [field]: value }));
    }
  }
  assert.throws(() => deploymentConfig(template, { ...env, HOMEPAGE_DEFAULT_TIMEZONE: "Invalid/Zone" }));
});

test("deployment refuses a missing or ambiguous storage binding", () => {
  assert.throws(() => deploymentConfig({ ...template, kv_namespaces: [] }, env));
  assert.throws(() => deploymentConfig({ ...template, kv_namespaces: [...template.kv_namespaces, ...template.kv_namespaces] }, env));
});
