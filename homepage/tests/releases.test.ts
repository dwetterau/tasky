import { describe, expect, it } from "vitest";
import { feedSchema } from "@tasky/home-feed";
import { renderEdition } from "../src/rendering/page";
import { fixtureEdition } from "./fixtures";

describe("upcoming releases homepage module", () => {
  it("renders upcoming items and filters expired dates at render time", () => {
    const now = Date.parse("2026-10-04T14:00:00Z");
    const edition = fixtureEdition("user-a", 1, now);
    edition.feed.modules.push({
      id: "releases",
      schemaVersion: 1,
      scope: "user",
      sourceDataAt: now,
      collectedAt: now,
      freshForMs: 8 * 24 * 60 * 60_000,
      maxAgeMs: 21 * 24 * 60 * 60_000,
      status: "available",
      payload: {
        asOf: "2026-10-04",
        releases: [
          {
            kind: "tv",
            title: "Expired show",
            releaseDate: "2026-10-03",
          },
          {
            kind: "tv",
            title: "Apothecary Diaries",
            detail: "Season 3",
            releaseDate: "2026-10-04",
          },
          {
            kind: "movie",
            title: "The Deceased Empress' Treasure",
            releaseDate: "2026-12-11",
          },
          {
            kind: "tv",
            title: "Blue Eye Samurai",
            detail: "Season 2",
            releaseDate: "2027-01",
          },
        ],
      },
    });
    edition.feed = feedSchema.parse(edition.feed);

    const html = renderEdition(
      edition.feed,
      "https://tasky.example.test",
    );

    expect(html).toContain("Upcoming releases");
    expect(html).not.toContain("Expired show");
    expect(html).toContain("Apothecary Diaries");
    expect(html).toContain("Season 3");
    expect(html).toContain(">Today (Sun)</time>");
    expect(html).toContain("The Deceased Empress&#39; Treasure");
    expect(html).toContain(">Fri, Dec 11</time>");
    expect(html).toContain(">January 2027</time>");
  });
});
