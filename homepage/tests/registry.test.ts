import { describe, expect, it } from "vitest";
import { compareModules } from "../src/modules/registry";

describe("homepage module order", () => {
  it("places briefing, weather, and on-this-day first", () => {
    const ids = ["tasky", "on-this-day", "weather", "briefing"];
    expect(ids.sort((a, b) => compareModules({ id: a }, { id: b }))).toEqual([
      "briefing",
      "weather",
      "on-this-day",
      "tasky",
    ]);
  });
});
