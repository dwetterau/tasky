// Every ticker and figure below is synthetic.
import { describe, expect, it } from "vitest";
import {
  attributeChanges,
  type AttributionPoint,
} from "./lib/portfolioAttribution";

function point(
  date: string,
  holdings: Record<string, [quantity: number, value: number]>,
): AttributionPoint {
  return {
    date,
    holdings: Object.entries(holdings).map(([ticker, [quantity, value]]) => ({
      ticker,
      quantity,
      value,
    })),
  };
}

function find(points: AttributionPoint[], key: string) {
  return attributeChanges(points).holdings.find(
    (holding) => holding.key === key,
  )!;
}

describe("portfolio attribution", () => {
  it("separates a price drop from a sale", () => {
    const holding = find(
      [
        point("2026-03-02", { AAA: [100, 1000] }), // $10
        point("2026-03-03", { AAA: [100, 900] }), // $9, nothing sold
        point("2026-03-04", { AAA: [60, 540] }), // 40 sold at $9
      ],
      "AAA",
    );
    expect(holding.priceEffect).toBeCloseTo(-100);
    expect(holding.quantityEffect).toBeCloseTo(-360);
    expect(holding.priceEffect + holding.quantityEffect).toBeCloseTo(
      holding.endValue - holding.startValue,
    );
    expect(holding.startPrice).toBe(10);
    expect(holding.endPrice).toBe(9);
  });

  it("treats opening and closing a position as share changes", () => {
    const points = [
      point("2026-03-02", { AAA: [10, 100] }),
      point("2026-03-03", { BBB: [5, 50] }),
    ];
    expect(find(points, "AAA")).toMatchObject({
      priceEffect: 0,
      quantityEffect: -100,
    });
    expect(find(points, "BBB")).toMatchObject({
      priceEffect: 0,
      quantityEffect: 50,
    });
  });

  it("counts every cash movement as a share change", () => {
    const holding = find(
      [point("2026-03-02", { "": [0, 500] }), point("2026-03-03", { "": [0, 800] })],
      "",
    );
    expect(holding).toMatchObject({
      priceEffect: 0,
      quantityEffect: 300,
      startPrice: null,
    });
  });

  it("does not read a stock split as a trade", () => {
    const holding = find(
      [
        point("2026-03-02", { AAA: [10, 1000] }),
        point("2026-03-03", { AAA: [20, 1010] }),
      ],
      "AAA",
    );
    expect(holding.quantityEffect).toBe(0);
    expect(holding.priceEffect).toBeCloseTo(10);
  });

  it("combines lots of one ticker and totals every holding", () => {
    const result = attributeChanges([
      {
        date: "2026-03-02",
        holdings: [
          { ticker: "aaa", quantity: 4, value: 40 },
          { ticker: "AAA", quantity: 6, value: 60 },
          { ticker: "BBB", quantity: 1, value: 10 },
        ],
      },
      point("2026-03-03", { AAA: [10, 120], BBB: [2, 20] }),
    ]);
    expect(result.holdings.map((holding) => holding.key)).toEqual([
      "AAA",
      "BBB",
    ]);
    expect(result.total).toEqual({
      startValue: 110,
      endValue: 140,
      priceEffect: 20,
      quantityEffect: 10,
    });
  });
});
