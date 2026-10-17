import { expect, test } from "@jest/globals";
import {
  layoutTreemap,
  portfolioReturnColor,
  PORTFOLIO_RETURN_COLORS,
} from "../portfolioMap";

test("uses seven fixed return color buckets", () => {
  expect(portfolioReturnColor(null)).toBe(PORTFOLIO_RETURN_COLORS.flat);
  expect(portfolioReturnColor(0.05)).toBe(PORTFOLIO_RETURN_COLORS.flat);
  expect(portfolioReturnColor(-0.1)).toBe(
    PORTFOLIO_RETURN_COLORS.lossMild,
  );
  expect(portfolioReturnColor(-1)).toBe(
    PORTFOLIO_RETURN_COLORS.lossMedium,
  );
  expect(portfolioReturnColor(-5.01)).toBe(
    PORTFOLIO_RETURN_COLORS.lossStrong,
  );
  expect(portfolioReturnColor(0.1)).toBe(
    PORTFOLIO_RETURN_COLORS.gainMild,
  );
  expect(portfolioReturnColor(1)).toBe(
    PORTFOLIO_RETURN_COLORS.gainMedium,
  );
  expect(portfolioReturnColor(5.01)).toBe(
    PORTFOLIO_RETURN_COLORS.gainStrong,
  );
});

test("lays out every positive item within the requested bounds", () => {
  const layout = layoutTreemap(
    [
      { item: "large", value: 60 },
      { item: "medium", value: 30 },
      { item: "small", value: 10 },
      { item: "hidden", value: 0 },
    ],
    300,
    200,
  );

  expect(layout.map(({ item }) => item)).toEqual([
    "large",
    "medium",
    "small",
  ]);
  for (const rect of layout) {
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(300.000001);
    expect(rect.y + rect.height).toBeLessThanOrEqual(200.000001);
  }
  const totalArea = layout.reduce(
    (sum, rect) => sum + rect.width * rect.height,
    0,
  );
  expect(totalArea).toBeCloseTo(300 * 200);
});

test("allocates area in proportion to value", () => {
  const layout = layoutTreemap(
    [
      { item: "a", value: 3 },
      { item: "b", value: 1 },
    ],
    200,
    100,
  );
  const area = (item: string) => {
    const rect = layout.find((candidate) => candidate.item === item)!;
    return rect.width * rect.height;
  };

  expect(area("a") / area("b")).toBeCloseTo(3);
});

test("flows rows from top to bottom on a portrait screen", () => {
  const layout = layoutTreemap(
    [
      { item: "large", value: 60 },
      { item: "medium", value: 30 },
      { item: "small", value: 10 },
    ],
    100,
    300,
  );

  expect(layout.map(({ x }) => x)).toEqual([0, 0, 0]);
  expect(layout.map(({ width }) => width)).toEqual([100, 100, 100]);
  expect(layout[0]!.y).toBe(0);
  expect(layout[1]!.y).toBeGreaterThan(layout[0]!.y);
  expect(layout[2]!.y).toBeGreaterThan(layout[1]!.y);
});
