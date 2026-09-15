import { env as bindings } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { afterEach, expect, it } from "vitest";
import { handleRequest } from "../src/index";
import { issueSession, SESSION_COOKIE } from "../src/auth/credentials";
import { digest } from "../src/transport";
import type { Env } from "../src/env";
import { fixtureEdition } from "./fixtures";

const env = bindings as unknown as Env;
afterEach(() => reset());

it("records local Worker delivery timings without imposing a network-latency assertion", async () => {
  const edition = fixtureEdition();
  await env.EDITIONS.put("edition:user-a", JSON.stringify(edition));
  const token = await issueSession(
    env,
    "user-a",
    await digest("performance-fixture"),
  );
  const samples: { handlerMs: number; authMs: number; kvMs: number }[] = [];
  for (let index = 0; index < 31; index++) {
    const start = performance.now();
    const response = await handleRequest(
      new Request(env.HOME_ORIGIN, {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      }),
      env,
    );
    const handlerMs = performance.now() - start;
    expect(response.status).toBe(200);
    const timing = response.headers.get("server-timing")!;
    samples.push({
      handlerMs,
      authMs: Number(/auth;dur=([\d.]+)/.exec(timing)![1]),
      kvMs: Number(/kv;dur=([\d.]+)/.exec(timing)![1]),
    });
    expect((await response.text()).includes("A good week")).toBe(true);
  }
  const warm = samples.slice(1);
  const summarize = (key: keyof (typeof samples)[number]) => {
    const values = warm.map((sample) => sample[key]).sort((a, b) => a - b);
    return {
      median: values[Math.floor(values.length / 2)],
      p95: values[Math.ceil(values.length * 0.95) - 1],
    };
  };
  // Local Miniflare, in-process dispatch: excludes DNS/TLS/network and does not
  // represent a cold Cloudflare POP or real KV propagation.
  console.info(
    JSON.stringify({
      benchmark: "local-miniflare",
      requests: samples.length,
      first: samples[0],
      repeat: {
        handlerMs: summarize("handlerMs"),
        authMs: summarize("authMs"),
        kvMs: summarize("kvMs"),
      },
    }),
  );
});
