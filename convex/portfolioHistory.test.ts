import { describe, expect, it } from "vitest";
import {
  buildHistoricalChartData,
  collectPriceHistoryPoints,
  parseHistoryRecordName,
  sortTickersByLatestValue,
} from "./lib/portfolioHistory";

describe("parseHistoryRecordName", () => {
  it("reads ticker and date from the Airtable name", () => {
    expect(parseHistoryRecordName("AAPL-2026-01-08")).toEqual({
      ticker: "AAPL",
      date: "2026-01-08",
    });
  });

  it("keeps dashed tickers intact", () => {
    expect(parseHistoryRecordName("brk-b-2026-02-03")).toEqual({
      ticker: "BRK-B",
      date: "2026-02-03",
    });
  });

  it("returns null for names that are not ticker-date rows", () => {
    expect(parseHistoryRecordName("AAPL")).toBeNull();
    expect(parseHistoryRecordName("not-a-date")).toBeNull();
  });
});

describe("collectPriceHistoryPoints", () => {
  it("groups mapped Airtable rows and drops incomplete records", () => {
    expect(
      collectPriceHistoryPoints(
        [
          {
            name: "MSFT-2026-01-09",
            date: "2026-01-09",
            close: 400,
            quantity: 2,
          },
          {
            name: "AAPL-2026-01-08",
            date: "2026-01-08",
            close: 200,
            quantity: 3,
          },
          {
            name: "BAD",
            date: "2026-01-08",
            close: 1,
            quantity: 1,
          },
          {
            name: "NVDA-2026-01-07",
            date: "2026-01-07",
            close: 100,
            quantity: 1,
          },
        ],
        "2026-01-08",
      ),
    ).toEqual([
      { ticker: "AAPL", date: "2026-01-08", close: 200, quantity: 3 },
      { ticker: "MSFT", date: "2026-01-09", close: 400, quantity: 2 },
    ]);
  });
});

describe("buildHistoricalChartData", () => {
  const holdings = [
    { ticker: "AAPL", shares: 2 },
    { ticker: "MSFT", shares: 1 },
  ];

  it("stacks complete days and skips dates missing a held ticker", () => {
    const points = buildHistoricalChartData(
      [
        { ticker: "AAPL", date: "2026-01-08", close: 100, quantity: 2 },
        { ticker: "MSFT", date: "2026-01-08", close: 200, quantity: 1 },
        { ticker: "AAPL", date: "2026-01-09", close: 110, quantity: 2 },
        { ticker: "AAPL", date: "2026-01-10", close: 120, quantity: 2 },
        { ticker: "MSFT", date: "2026-01-10", close: 180, quantity: 1 },
      ],
      holdings,
      ["AAPL", "MSFT"],
    );

    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({
      date: "2026-01-08",
      total: 400,
      dailyChange: 0,
      tickerValues: { AAPL: 200, MSFT: 200 },
    });
    expect(points[1]).toMatchObject({
      date: "2026-01-10",
      total: 420,
      dailyChange: 5,
      tickerValues: { AAPL: 240, MSFT: 180 },
      tickerChanges: { AAPL: 20, MSFT: -10 },
    });
  });

  it("falls back to current shares when quantity is missing", () => {
    const points = buildHistoricalChartData(
      [
        { ticker: "AAPL", date: "2026-01-08", close: 50, quantity: 0 },
        { ticker: "MSFT", date: "2026-01-08", close: 100, quantity: 0 },
      ],
      holdings,
      ["AAPL", "MSFT"],
    );

    expect(points[0]?.tickerValues).toEqual({ AAPL: 100, MSFT: 100 });
    expect(points[0]?.total).toBe(200);
  });

  it("sorts selected tickers smallest-first for stacking", () => {
    const points = buildHistoricalChartData(
      [
        { ticker: "AAPL", date: "2026-01-08", close: 10, quantity: 1 },
        { ticker: "MSFT", date: "2026-01-08", close: 90, quantity: 1 },
      ],
      [
        { ticker: "AAPL", shares: 1 },
        { ticker: "MSFT", shares: 1 },
      ],
      ["MSFT", "AAPL"],
    );

    expect(sortTickersByLatestValue(["MSFT", "AAPL"], points)).toEqual([
      "AAPL",
      "MSFT",
    ]);
  });
});
