import { describe, expect, it } from "vitest";
import {
  formatOnThisDayDate,
  onThisDayPayloadSchema,
} from "./on-this-day";

describe("on-this-day widget", () => {
  it("validates and normalizes a dated journal retrospective", () => {
    expect(
      onThisDayPayloadSchema.parse({
        date: "2026-10-08",
        markdown: "  - **2023:** Started a new journal.  ",
      }),
    ).toEqual({
      date: "2026-10-08",
      markdown: "- **2023:** Started a new journal.",
    });
  });

  it("rejects impossible calendar dates and empty facts", () => {
    expect(() =>
      onThisDayPayloadSchema.parse({
        date: "2026-02-30",
        markdown: "- A fact",
      }),
    ).toThrow("Invalid calendar date");
    expect(() =>
      onThisDayPayloadSchema.parse({
        date: "2026-10-08",
        markdown: " ",
      }),
    ).toThrow("On-this-day markdown cannot be empty");
  });

  it("formats the payload date without a timezone shift", () => {
    expect(formatOnThisDayDate("2026-10-08")).toBe(
      "Thursday, October 8, 2026",
    );
  });
});
