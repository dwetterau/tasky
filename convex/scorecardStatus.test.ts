import { describe, expect, it } from "vitest";
import { evaluateScorecard } from "./lib/scorecardStatus";

describe("scorecard evaluation", () => {
  it("completes when all required members are done and quota is 0", () => {
    expect(
      evaluateScorecard(
        [
          { role: "required", ratio: 1 },
          { role: "required", ratio: 1 },
          { role: "optional", ratio: 0 },
        ],
        0,
      ),
    ).toEqual({
      ratio: 1,
      isComplete: true,
      optionalDoneCount: 0,
      count: 1,
    });
  });

  it("keeps required incomplete even when optionals are done", () => {
    expect(
      evaluateScorecard(
        [
          { role: "required", ratio: 0.5 },
          { role: "optional", ratio: 1 },
        ],
        0,
      ),
    ).toEqual({
      ratio: 0.5,
      isComplete: false,
      optionalDoneCount: 1,
      count: 0,
    });
  });

  it("uses optional quota for fill and the completeness gate", () => {
    expect(
      evaluateScorecard(
        [
          { role: "required", ratio: 1 },
          { role: "optional", ratio: 0.5 },
          { role: "optional", ratio: 1 },
        ],
        2,
      ),
    ).toEqual({
      ratio: (1 + 1.5) / 3,
      isComplete: false,
      optionalDoneCount: 1,
      count: 0,
    });
    expect(
      evaluateScorecard(
        [
          { role: "required", ratio: 1 },
          { role: "optional", ratio: 1 },
          { role: "optional", ratio: 1 },
        ],
        2,
      ),
    ).toEqual({
      ratio: 1,
      isComplete: true,
      optionalDoneCount: 2,
      count: 1,
    });
  });

  it("completes optional-only quota 0 when any optional is done", () => {
    expect(
      evaluateScorecard(
        [
          { role: "optional", ratio: 0.4 },
          { role: "optional", ratio: 1 },
        ],
        0,
      ),
    ).toEqual({
      ratio: 1,
      isComplete: true,
      optionalDoneCount: 1,
      count: 1,
    });
    expect(
      evaluateScorecard([{ role: "optional", ratio: 0.4 }], 0),
    ).toEqual({
      ratio: 0.4,
      isComplete: false,
      optionalDoneCount: 0,
      count: 0,
    });
  });

  it("requires one done optional when quota is 1", () => {
    expect(
      evaluateScorecard(
        [
          { role: "optional", ratio: 0.5 },
          { role: "optional", ratio: 0.2 },
        ],
        1,
      ),
    ).toEqual({
      ratio: 0.7,
      isComplete: false,
      optionalDoneCount: 0,
      count: 0,
    });
    expect(
      evaluateScorecard(
        [
          { role: "optional", ratio: 1 },
          { role: "optional", ratio: 0 },
        ],
        1,
      ),
    ).toEqual({
      ratio: 1,
      isComplete: true,
      optionalDoneCount: 1,
      count: 1,
    });
  });

  it("keeps required members as a gate under a session target", () => {
    expect(
      evaluateScorecard(
        [
          { role: "required", ratio: 0.5, count: 0 },
          { role: "optional", ratio: 1, count: 5 },
        ],
        0,
        5,
      ),
    ).toEqual({
      ratio: 5 / 5,
      isComplete: false,
      optionalDoneCount: 1,
      count: 5,
    });
  });

  it("sums member counts against a session target", () => {
    expect(
      evaluateScorecard(
        [
          { role: "optional", ratio: 1, count: 2 },
          { role: "optional", ratio: 0, count: 1 },
          { role: "optional", ratio: 1, count: 1 },
        ],
        2,
        5,
      ),
    ).toEqual({
      ratio: 4 / 5,
      isComplete: false,
      optionalDoneCount: 2,
      count: 4,
    });
    expect(
      evaluateScorecard(
        [
          { role: "optional", ratio: 1, count: 2 },
          { role: "optional", ratio: 1, count: 2 },
          { role: "optional", ratio: 1, count: 1 },
        ],
        2,
        5,
      ),
    ).toEqual({
      ratio: 1,
      isComplete: true,
      optionalDoneCount: 3,
      count: 5,
    });
  });

  it("counts floor(optionalDone / quota) bundles", () => {
    expect(
      evaluateScorecard(
        [
          { role: "optional", ratio: 1 },
          { role: "optional", ratio: 1 },
          { role: "optional", ratio: 1 },
          { role: "optional", ratio: 1 },
          { role: "optional", ratio: 1 },
          { role: "optional", ratio: 1 },
        ],
        3,
      ),
    ).toEqual({
      ratio: 1,
      isComplete: true,
      optionalDoneCount: 6,
      count: 2,
    });
  });
});
