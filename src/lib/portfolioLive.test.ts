import { describe, expect, it } from "vitest";
import {
  applyLiveQuotes,
  buildIntradaySeries,
  isSessionLive,
  type LiveHoldingInput,
  type LiveSession,
} from "./portfolioLive";

const OPEN = Date.parse("2026-11-27T14:30:00Z");
const session: LiveSession = {
  sessionDate: "2026-11-27",
  sessionOpen: OPEN,
  sessionClose: OPEN + 6.5 * 3_600_000,
  asOf: OPEN + 7 * 60_000,
  lastTradeAt: OPEN + 6 * 60_000,
  times: [OPEN, OPEN + 5 * 60_000, OPEN + 6 * 60_000],
  quotes: [
    {
      ticker: "AAA",
      price: 110,
      previousClose: 100,
      priceAt: OPEN + 6 * 60_000,
      prices: [101, 105, 110],
    },
  ],
};

function holding(overrides: Partial<LiveHoldingInput>): LiveHoldingInput {
  return {
    ticker: "AAA",
    companyName: "AAA Inc",
    shares: 10,
    costBasis: 800,
    currentPrice: 100,
    currentValue: 1000,
    gainLoss: 200,
    gainLossPercent: 25,
    dayReturn: 5,
    dayReturnPercent: 0.5,
    ...overrides,
  };
}

const fund = holding({
  ticker: "FUNDX",
  shares: 4,
  costBasis: 400,
  currentValue: 500,
  dayReturn: 20,
});
const cash = holding({
  ticker: "",
  shares: 0,
  costBasis: 250,
  currentValue: 250,
  dayReturn: 0,
});

describe("live portfolio quotes", () => {
  it("reprices quoted holdings from the previous close", () => {
    const result = applyLiveQuotes([holding({}), fund, cash], session, false);

    expect(result.holdings[0]).toMatchObject({
      live: true,
      currentPrice: 110,
      currentValue: 1100,
      dayReturn: 100,
      dayReturnPercent: 10,
      gainLoss: 300,
    });
    // No quote and a snapshot from an earlier session: held flat.
    expect(result.holdings[1]).toMatchObject({
      live: false,
      currentValue: 500,
      dayReturn: 0,
    });
    expect(result.totalCurrentValue).toBe(1850);
    expect(result.dayReturn).toBe(100);
    expect(result.dayReturnPercent).toBeCloseTo((100 / 1750) * 100);
  });

  it("keeps the snapshot day return for unquoted holdings it already covers", () => {
    const result = applyLiveQuotes([holding({}), fund], session, true);
    expect(result.holdings[1]!.dayReturn).toBe(20);
    expect(result.dayReturn).toBe(120);
  });

  it("builds value paths, flat where there is no quote", () => {
    const series = buildIntradaySeries([cash, fund, holding({})], session);
    expect(series.map((entry) => entry.label)).toEqual(["AAA", "FUNDX", "Cash"]);
    expect(series[0]).toMatchObject({
      live: true,
      baseline: 1000,
      values: [1010, 1050, 1100],
    });
    expect(series[1]).toMatchObject({ live: false, values: [500, 500, 500] });
  });

  it("is live only in session with a recent trade", () => {
    expect(isSessionLive(session)).toBe(true);
    expect(
      isSessionLive({ ...session, asOf: session.sessionClose + 1 }),
    ).toBe(false);
    expect(
      isSessionLive({ ...session, asOf: session.lastTradeAt + 11 * 60_000 }),
    ).toBe(false);
  });
});
