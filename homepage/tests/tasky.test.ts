import { describe, expect, it } from "vitest";
import type { TaskyPayload } from "@tasky/home-feed";
import { renderEdition } from "../src/rendering/page";
import { fixtureEdition } from "./fixtures";

describe("Tasky homepage module", () => {
  it("renders due signals except Weight and lists tasks due today", () => {
    const edition = fixtureEdition();
    const tasky = edition.feed.modules[0]!.payload as TaskyPayload;
    tasky.signals.push({
      id: "signal-weight",
      name: "Weight",
      kind: "activity",
      attention: "due",
      reason: "Activity is due",
      ratio: 0,
      isComplete: false,
      todayCount: 0,
      labels: [],
    });

    const html = renderEdition(
      edition.feed,
      "https://tasky.example.test",
    );

    expect(html).toContain("Strength training");
    expect(html).not.toContain("Water the plants");
    expect(html).not.toContain(">Weight<");
    expect(html).toContain("Due today");
    expect(html).toContain("Make space for the work that matters this week");
    expect(html).not.toContain("Book a table for Friday evening");
  });
});
