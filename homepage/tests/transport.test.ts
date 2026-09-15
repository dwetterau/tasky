import { expect, it } from "vitest";
import { signedHeaders, verifyRequest } from "../src/transport";
import {
  homepageHeaders,
  verifyHomepageRequest,
} from "../../convex/lib/homepageTransport";

it("interoperates across the Worker and Convex signers and binds method, path, time and exact bytes", async () => {
  const key = "fixture-service-secret-with-at-least-32-characters";
  const body = JSON.stringify({ userId: "user-a", text: "A café ☀" });
  const path = "/internal/tasky";
  const headers = await homepageHeaders(key, path, body);
  expect(headers["user-agent"]).toBe("Tasky-Homepage/1.0");
  const request = new Request(`https://home.example.test${path}`, {
    method: "POST",
    headers,
  });
  expect(await verifyRequest(request, body, key)).toBe(true);
  const backPath = "/api/homepage/enroll";
  const backHeaders = await signedHeaders(key, backPath, body);
  expect(backHeaders["user-agent"]).toBe("Tasky-Homepage/1.0");
  expect(
    await verifyHomepageRequest(
      new Request(`https://tasky.example.test${backPath}`, {
        method: "POST",
        headers: backHeaders,
      }),
      body,
      key,
    ),
  ).toBe(true);
  expect(await verifyRequest(request, body + " ", key)).toBe(false);
  expect(
    await verifyRequest(
      new Request("https://home.example.test/another", {
        method: "POST",
        headers,
      }),
      body,
      key,
    ),
  ).toBe(false);
  expect(
    await verifyRequest(
      new Request(request.url, { method: "GET", headers }),
      body,
      key,
    ),
  ).toBe(false);
  const oldHeaders = await homepageHeaders(
    key,
    path,
    body,
    Date.now() - 360_000,
  );
  expect(
    await verifyRequest(
      new Request(request.url, { method: "POST", headers: oldHeaders }),
      body,
      key,
    ),
  ).toBe(false);
});
