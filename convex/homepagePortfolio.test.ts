import { afterEach, expect, it, vi } from "vitest";
import type { ActionCtx } from "./_generated/server";
import { collectHomepagePortfolio } from "./lib/homepagePortfolio";
import { readPortfolioSnapshot } from "./portfolio";

vi.mock("./portfolio", () => ({ readPortfolioSnapshot: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it("exports saved holdings for the enrolled user and retains their age on failure", async () => {
  const read = vi.mocked(readPortfolioSnapshot);
  const ctx = {} as ActionCtx;
  read.mockResolvedValue({
    status: "ok",
    holdings: Array.from({ length: 7 }, (_, index) => ({
      id: String(index),
      ticker: `T${index}`,
      companyName: "Holding",
      costBasis: 10,
      shares: 1,
      currentPrice: 20 + index,
      currentValue: 20 + index,
      gainLoss: 10 + index,
      gainLossPercent: 100,
      targetAllocation: null,
      createdAt: "",
      latestPriceDate: null,
      previousPriceDate: null,
      dayReturn: null,
      dayReturnPercent: null,
    })),
    summary: {
      totalCost: 70,
      totalCurrentValue: 161,
      gainLoss: 91,
      gainLossPercent: 130,
      holdingsCount: 7,
      latestPriceDate: null,
      dayReturnDate: null,
      dayReturn: null,
      dayReturnPercent: null,
    },
  });
  const fresh = await collectHomepagePortfolio(ctx, "user-a");
  expect(read).toHaveBeenCalledExactlyOnceWith(ctx, "user-a", false);
  expect(fresh.payload).toMatchObject({ totalValue: 161, holdingsCount: 7 });
  const holdings = (fresh.payload as { holdings: { ticker: string }[] })
    .holdings;
  expect(holdings.map((holding) => holding.ticker)).toEqual([
    "T6",
    "T5",
    "T4",
    "T3",
    "T2",
  ]);
  read.mockRejectedValue(new Error("Provider down"));
  const cached = await collectHomepagePortfolio(
    ctx,
    "user-a",
    JSON.stringify(fresh),
  );
  expect(cached).toEqual({ ...fresh, error: "collection_failed" });
  const corrupt = await collectHomepagePortfolio(ctx, "user-a", "{");
  expect(corrupt).toMatchObject({ status: "unavailable", payload: null });
});
