import { describe, expect, it } from "vitest";
import { feedSchema } from "@tasky/home-feed";
import { renderEdition } from "../src/rendering/page";
import { fixtureEdition } from "./fixtures";

describe("homepage widget dates", () => {
  it("hides briefing and on-this-day dates that match the edition date", () => {
    const now = Date.parse("2026-10-08T14:00:00Z");
    const edition = fixtureEdition("user-a", 1, now);
    edition.feed.modules.push(
      {
        id: "briefing",
        schemaVersion: 1,
        scope: "user",
        sourceDataAt: now,
        collectedAt: now,
        freshForMs: 18 * 60 * 60_000,
        maxAgeMs: 7 * 24 * 60 * 60_000,
        status: "available",
        payload: { date: "2026-10-08", markdown: "## Today" },
      },
      {
        id: "on-this-day",
        schemaVersion: 1,
        scope: "user",
        sourceDataAt: now,
        collectedAt: now,
        freshForMs: 18 * 60 * 60_000,
        maxAgeMs: 7 * 24 * 60 * 60_000,
        status: "available",
        payload: { date: "2026-10-08", markdown: "- **2024:** A memory." },
      },
    );
    edition.feed = feedSchema.parse(edition.feed);

    const html = renderEdition(edition.feed, "https://tasky.example.test");

    expect(html).toContain("Thursday, October 8, 2026");
    expect(html).not.toContain('class="widget-date"');
  });

  it("keeps a widget date when it differs from the edition date", () => {
    const now = Date.parse("2026-10-08T14:00:00Z");
    const edition = fixtureEdition("user-a", 1, now);
    edition.feed.modules.push({
      id: "on-this-day",
      schemaVersion: 1,
      scope: "user",
      sourceDataAt: now,
      collectedAt: now,
      freshForMs: 18 * 60 * 60_000,
      maxAgeMs: 7 * 24 * 60 * 60_000,
      status: "available",
      payload: { date: "2026-10-07", markdown: "- **2024:** A memory." },
    });
    edition.feed = feedSchema.parse(edition.feed);

    const html = renderEdition(edition.feed, "https://tasky.example.test");

    expect(html).toContain(
      '<time class="widget-date" datetime="2026-10-07">Wednesday, October 7, 2026</time>',
    );
  });
});
