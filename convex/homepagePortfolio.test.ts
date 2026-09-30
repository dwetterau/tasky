import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { collectHomepagePortfolio } from "./lib/homepagePortfolio";
import { getPortfolioConfigurations, readPortfolioSnapshot } from "./portfolio";

vi.mock("./portfolio", () => ({
  readPortfolioSnapshot: vi.fn(),
  getPortfolioConfigurations: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(getPortfolioConfigurations).mockResolvedValue([
    {
      id: "portfolio-schwab" as Id<"portfolios">,
      name: "Schwab",
      positionsViewId: "view-schwab",
      startDate: "2026-01-01",
      isDefault: true,
      displayOrder: 0,
    },
  ]);
});
afterEach(() => vi.clearAllMocks());

it("exports saved holdings for the enrolled user and retains their age on failure", async () => {
  const read = vi.mocked(readPortfolioSnapshot);
  const runQuery = vi.fn().mockResolvedValue({ lastSyncedAt: 123 });
  const ctx = { runQuery } as unknown as ActionCtx;
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
      dayReturn: index,
      dayReturnPercent: index / 10,
    })),
    summary: {
      totalCost: 70,
      totalCurrentValue: 161,
      gainLoss: 91,
      gainLossPercent: 130,
      holdingsCount: 7,
      latestPriceDate: "2026-09-29",
      dayReturnDate: null,
      dayReturn: null,
      dayReturnPercent: null,
    },
  });
  const fresh = await collectHomepagePortfolio(ctx, "user-a");
  expect(read).toHaveBeenCalledExactlyOnceWith(
    ctx,
    "user-a",
    "recent",
    expect.objectContaining({ name: "Schwab" }),
  );
  expect(fresh.payload).toMatchObject({
    totalValue: 161,
    holdingsCount: 7,
    lastSyncedAt: 123,
    latestPriceDate: "2026-09-29",
  });
  const holdings = (
    fresh.payload as {
      holdings: { ticker: string; dayReturn: number | null }[];
    }
  ).holdings;
  expect(holdings.map((holding) => holding.ticker)).toEqual([
    "T6",
    "T5",
    "T4",
    "T3",
    "T2",
    "T1",
    "T0",
  ]);
  expect(holdings[0].dayReturn).toBe(6);

  read.mockReset();
  read.mockResolvedValue({
    status: "ok",
    holdings: Array.from({ length: 7 }, (_, index) => ({
      id: String(index),
      ticker: `T${index}`,
      companyName: "Holding",
      costBasis: 10,
      shares: 1,
      currentPrice: 30 + index,
      currentValue: 30 + index,
      gainLoss: 20 + index,
      gainLossPercent: 200,
      targetAllocation: null,
      createdAt: "",
      latestPriceDate: null,
      previousPriceDate: null,
      dayReturn: null,
      dayReturnPercent: null,
    })),
    summary: {
      totalCost: 70,
      totalCurrentValue: 231,
      gainLoss: 161,
      gainLossPercent: 230,
      holdingsCount: 7,
      latestPriceDate: null,
      dayReturnDate: null,
      dayReturn: null,
      dayReturnPercent: null,
    },
  });
  const routine = await collectHomepagePortfolio(
    ctx,
    "user-a",
    JSON.stringify(fresh),
  );
  expect(read).toHaveBeenCalledExactlyOnceWith(
    ctx,
    "user-a",
    false,
    expect.objectContaining({ name: "Schwab" }),
  );
  expect(
    (
      routine.payload as {
        holdings: { ticker: string; dayReturn: number | null }[];
      }
    ).holdings[0],
  ).toMatchObject({ ticker: "T6", dayReturn: 6 });

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

it("bounds the exported holdings at twenty", async () => {
  vi.mocked(readPortfolioSnapshot).mockResolvedValue({
    status: "ok",
    holdings: Array.from({ length: 22 }, (_, index) => ({
      id: String(index),
      ticker: `T${index}`,
      companyName: "Holding",
      costBasis: 10,
      shares: 1,
      currentPrice: index,
      currentValue: index,
      gainLoss: index - 10,
      gainLossPercent: index - 100,
      targetAllocation: null,
      createdAt: "",
      latestPriceDate: null,
      previousPriceDate: null,
      dayReturn: null,
      dayReturnPercent: null,
    })),
    summary: {
      totalCost: 220,
      totalCurrentValue: 231,
      gainLoss: 11,
      gainLossPercent: 5,
      holdingsCount: 22,
      latestPriceDate: null,
      dayReturnDate: null,
      dayReturn: null,
      dayReturnPercent: null,
    },
  });
  const ctx = {
    runQuery: vi.fn().mockResolvedValue(null),
  } as unknown as ActionCtx;

  const snapshot = await collectHomepagePortfolio(ctx, "user-a");
  const holdings = (snapshot.payload as { holdings: { ticker: string }[] })
    .holdings;
  expect(holdings).toHaveLength(20);
  expect(holdings[0].ticker).toBe("T21");
  expect(holdings[19].ticker).toBe("T2");
});

it("exports multiple named portfolios in one homepage module", async () => {
  vi.mocked(getPortfolioConfigurations).mockResolvedValue([
    {
      id: "portfolio-schwab" as Id<"portfolios">,
      name: "Schwab",
      positionsViewId: "view-schwab",
      startDate: "2026-01-01",
      isDefault: true,
      displayOrder: 0,
    },
    {
      id: "portfolio-vanguard" as Id<"portfolios">,
      name: "Vanguard",
      positionsViewId: "view-vanguard",
      startDate: "2026-02-01",
      isDefault: false,
      displayOrder: 1,
    },
  ]);
  vi.mocked(readPortfolioSnapshot).mockImplementation(
    async (_ctx, _userId, _includePriceStatus, portfolio) => {
      const all = Array.isArray(portfolio);
      const vanguard = !all && portfolio?.name === "Vanguard";
      const value = all ? 1_500 : vanguard ? 500 : 1_000;
      return {
        status: "ok",
        holdings: [
          {
            id: all
              ? "all-position"
              : vanguard
                ? "vanguard-position"
                : "schwab-position",
            ticker: all ? "MIX" : vanguard ? "VTI" : "SCHB",
            companyName: all
              ? "Combined holdings"
              : vanguard
                ? "Vanguard Total Market"
                : "Schwab Broad Market",
            costBasis: value - 100,
            shares: 2,
            currentPrice: value / 2,
            currentValue: value,
            gainLoss: 100,
            gainLossPercent: 10,
            targetAllocation: null,
            createdAt: "",
            latestPriceDate: "2026-09-29",
            previousPriceDate: "2026-09-28",
            dayReturn: 5,
            dayReturnPercent: 0.5,
          },
        ],
        summary: {
          totalCost: value - 100,
          totalCurrentValue: value,
          gainLoss: 100,
          gainLossPercent: 10,
          holdingsCount: 1,
          latestPriceDate: "2026-09-29",
          dayReturnDate: "2026-09-29",
          dayReturn: 5,
          dayReturnPercent: 0.5,
        },
      };
    },
  );
  const ctx = {
    runQuery: vi.fn().mockResolvedValue({ lastSyncedAt: 123 }),
  } as unknown as ActionCtx;

  const snapshot = await collectHomepagePortfolio(ctx, "user-a");
  const payload = snapshot.payload as {
    totalValue: number;
    portfolios: Array<{ name: string; totalValue: number }>;
  };
  expect(payload.totalValue).toBe(1_000);
  expect(payload.portfolios).toEqual([
    expect.objectContaining({ name: "All", totalValue: 1_500 }),
    expect.objectContaining({ name: "Schwab", totalValue: 1_000 }),
    expect.objectContaining({ name: "Vanguard", totalValue: 500 }),
  ]);

  const successfulRead = vi
    .mocked(readPortfolioSnapshot)
    .getMockImplementation()!;
  vi.mocked(readPortfolioSnapshot).mockImplementation(async (...args) => {
    if (!Array.isArray(args[3]) && args[3]?.name === "Vanguard") {
      throw new Error("Invalid Airtable view");
    }
    return await successfulRead(...args);
  });
  const partial = await collectHomepagePortfolio(
    ctx,
    "user-a",
    JSON.stringify(snapshot),
  );
  expect(partial.status).toBe("available");
  expect(
    (partial.payload as { portfolios: Array<{ name: string }> }).portfolios,
  ).toEqual([
    expect.objectContaining({ name: "All", totalValue: 1_500 }),
    expect.objectContaining({ name: "Schwab" }),
    expect.objectContaining({ name: "Vanguard", totalValue: 500 }),
  ]);
});
