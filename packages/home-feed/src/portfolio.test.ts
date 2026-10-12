import { expect, it } from "vitest";
import { LIMITS, namedPortfolioSchema } from "./index";

const portfolio = {
  id: "portfolio-a",
  name: "Portfolio",
  currency: "USD" as const,
  totalValue: 1000,
  gainLoss: 100,
  gainLossPercent: 10,
  holdingsCount: 0,
  holdings: [],
};

it("bounds pre-rendered portfolio history to ninety points", () => {
  expect(
    namedPortfolioSchema.safeParse({
      ...portfolio,
      history: {
        startDate: "2026-07-15",
        values: Array.from(
          { length: LIMITS.portfolioHistoryPoints },
          (_, index) => 1000 + index,
        ),
      },
    }).success,
  ).toBe(true);
  expect(
    namedPortfolioSchema.safeParse({
      ...portfolio,
      history: {
        startDate: "2026-07-14",
        values: Array.from(
          { length: LIMITS.portfolioHistoryPoints + 1 },
          (_, index) => 1000 + index,
        ),
      },
    }).success,
  ).toBe(false);
});
