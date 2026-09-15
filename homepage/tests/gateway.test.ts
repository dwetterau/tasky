import { describe, expect, it, vi } from "vitest";
// This deployment adapter is intentionally plain ESM, as required by Pages.
// @ts-expect-error The Pages entry point has no separate declaration file.
import gateway from "../gateway/public/_worker.js";

describe("Squarespace DNS gateway", () => {
  it("passes the original request to the private Worker, including the canonical URL and cookies", async () => {
    const request = new Request("https://home.davidw.tech/api/edition", {
      headers: { cookie: "__Host-home-session=fixture" },
    });
    const response = new Response("private fixture", {
      headers: {
        "cache-control": "private, no-store",
        "server-timing": "kv;dur=1",
      },
    });
    const fetch = vi.fn(async () => response);
    expect(
      await gateway.fetch(request, {
        HOME_ORIGIN: "https://home.davidw.tech",
        HOMEPAGE: { fetch },
      }),
    ).toBe(response);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(request);
  });
  it("rejects production and preview Pages aliases without calling the application", async () => {
    const fetch = vi.fn();
    for (const origin of [
      "https://tasky-homepage.pages.dev",
      "https://preview.tasky-homepage.pages.dev",
    ]) {
      const response = await gateway.fetch(
        new Request(`${origin}/api/edition`),
        { HOME_ORIGIN: "https://home.davidw.tech", HOMEPAGE: { fetch } },
      );
      expect(response.status).toBe(421);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("fails closed when the bound application is unavailable", async () => {
    const response = await gateway.fetch(
      new Request("https://home.davidw.tech/"),
      {
        HOME_ORIGIN: "https://home.davidw.tech",
        HOMEPAGE: {
          fetch: () => {
            throw new Error("internal detail");
          },
        },
      },
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("internal detail");
  });
});
