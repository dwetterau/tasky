import { describe, expect, it } from "vitest";
import {
  briefingPayloadSchema,
  parseWidgetData,
} from "../widgets";

describe("briefing widget", () => {
  it("requires a structured report date and trims the Markdown body", () => {
    expect(
      briefingPayloadSchema.parse({
        date: "2026-10-08",
        markdown: "  ## Calendar\n\n- Haircut  ",
      }),
    ).toEqual({
      date: "2026-10-08",
      markdown: "## Calendar\n\n- Haircut",
    });
  });

  it("rejects missing or impossible report dates", () => {
    expect(() =>
      briefingPayloadSchema.parse({ markdown: "## Calendar" }),
    ).toThrow();
    expect(() =>
      briefingPayloadSchema.parse({
        date: "2026-02-30",
        markdown: "## Calendar",
      }),
    ).toThrow("Invalid calendar date");
  });

  it("continues to parse stored briefing@1 rows", () => {
    expect(
      parseWidgetData("briefing", 1, {
        markdown: "# Thursday, Oct 8\n\n## Calendar",
      }),
    ).toEqual({
      markdown: "# Thursday, Oct 8\n\n## Calendar",
    });
  });
});
