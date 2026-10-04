import { describe, expect, it } from "vitest";
import {
  formatReleaseDate,
  getUpcomingReleases,
  localDateAt,
  releasesPayloadSchema,
  type ReleasesPayload,
} from "./releases";

const payload: ReleasesPayload = {
  asOf: "2026-10-04",
  releases: [
    {
      kind: "tv",
      title: "Expired",
      releaseDate: "2026-10-03",
    },
    {
      kind: "tv",
      title: "Today",
      detail: "Season 2",
      releaseDate: "2026-10-04",
    },
    {
      kind: "movie",
      title: "Tomorrow",
      releaseDate: "2026-10-05",
    },
    {
      kind: "tv",
      title: "This month",
      releaseDate: "2026-10",
    },
  ],
};

describe("releases widget", () => {
  it("validates strict, real calendar dates", () => {
    expect(releasesPayloadSchema.parse(payload)).toEqual(payload);
    expect(() =>
      releasesPayloadSchema.parse({
        ...payload,
        releases: [
          {
            kind: "tv",
            title: "Impossible",
            releaseDate: "2026-02-30",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      releasesPayloadSchema.parse({ ...payload, unexpected: true }),
    ).toThrow();
  });

  it("filters exact dates after they pass and retains month-only dates", () => {
    expect(
      getUpcomingReleases(payload, "2026-10-04").map(
        (release) => release.title,
      ),
    ).toEqual(["This month", "Today", "Tomorrow"]);
    expect(
      getUpcomingReleases(payload, "2026-11-01").map(
        (release) => release.title,
      ),
    ).toEqual([]);
  });

  it("formats relative and month-precision dates", () => {
    expect(formatReleaseDate("2026-10-04", "2026-10-04")).toBe("Today");
    expect(formatReleaseDate("2026-10-05", "2026-10-04")).toBe("Tomorrow");
    expect(formatReleaseDate("2027-01", "2026-10-04")).toBe("January 2027");
    expect(formatReleaseDate("2026-12-11", "2026-10-04")).toBe("Dec 11");
  });

  it("derives the viewer's local day from a timestamp and timezone", () => {
    const at = Date.parse("2026-10-05T02:00:00Z");
    expect(localDateAt(at, "America/New_York")).toBe("2026-10-04");
    expect(localDateAt(at, "UTC")).toBe("2026-10-05");
  });
});
