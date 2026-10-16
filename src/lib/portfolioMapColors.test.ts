import { describe, expect, it } from "vitest";
import { colorForReturn, RETURN_COLORS } from "./portfolioMapColors";

describe("portfolio map return colors", () => {
  it("uses gray for unavailable and nearly flat returns", () => {
    expect(colorForReturn(null)).toBe(RETURN_COLORS.flat);
    expect(colorForReturn(-0.099)).toBe(RETURN_COLORS.flat);
    expect(colorForReturn(0)).toBe(RETURN_COLORS.flat);
    expect(colorForReturn(0.05)).toBe(RETURN_COLORS.flat);
    expect(colorForReturn(0.099)).toBe(RETURN_COLORS.flat);
  });

  it("uses three fixed loss buckets", () => {
    expect(colorForReturn(-0.1)).toBe(RETURN_COLORS.lossMild);
    expect(colorForReturn(-1)).toBe(RETURN_COLORS.lossMedium);
    expect(colorForReturn(-5)).toBe(RETURN_COLORS.lossMedium);
    expect(colorForReturn(-5.01)).toBe(RETURN_COLORS.lossStrong);
  });

  it("uses three fixed gain buckets", () => {
    expect(colorForReturn(0.1)).toBe(RETURN_COLORS.gainMild);
    expect(colorForReturn(1)).toBe(RETURN_COLORS.gainMedium);
    expect(colorForReturn(5)).toBe(RETURN_COLORS.gainMedium);
    expect(colorForReturn(5.01)).toBe(RETURN_COLORS.gainStrong);
  });
});
