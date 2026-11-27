import { describe, expect, it } from "vitest";
import { buildIntradaySession } from "./lib/intradayQuotes";

const MIDNIGHT = Date.parse("2026-11-27T05:00:00Z");
const OPEN = Date.parse("2026-11-27T14:30:00Z");
const MIN = 60_000;
const iso = (time: number) => new Date(time).toISOString();

describe("intraday session", () => {
  it("builds a forward-filled path that ends on the latest trade", () => {
    const now = OPEN + 17 * MIN;
    const session = buildIntradaySession(
      {
        AAA: {
          latestTrade: { p: 104, t: iso(OPEN + 16 * MIN) },
          dailyBar: { o: 101, c: 104, t: iso(MIDNIGHT) },
          prevDailyBar: { c: 100, t: "2026-11-25T05:00:00Z" },
        },
        MISSING: null,
      },
      {
        AAA: [
          { t: iso(OPEN - 10 * MIN), o: 99, c: 99.5 }, // pre-market
          { t: iso(OPEN), o: 101, c: 102 },
          // No 14:35 bar: the 14:40 point carries 102 forward.
          { t: iso(OPEN + 10 * MIN), o: 102, c: 103 },
          { t: iso(OPEN + 15 * MIN), o: 103, c: 104 }, // still forming
        ],
      },
      now,
    )!;

    expect(session.sessionDate).toBe("2026-11-27");
    expect(session.times).toEqual([
      OPEN - 10 * MIN,
      OPEN - 5 * MIN,
      OPEN,
      OPEN + 5 * MIN,
      OPEN + 10 * MIN,
      OPEN + 15 * MIN,
      OPEN + 16 * MIN,
    ]);
    expect(session.quotes).toEqual([
      {
        ticker: "AAA",
        price: 104,
        previousClose: 100,
        priceAt: OPEN + 16 * MIN,
        // The 9:30 point is the last pre-market price; the open shows up in the
        // next bar.
        prices: [99, 99.5, 99.5, 102, 102, 103, 104],
      },
    ]);
  });

  it("holds a ticker that has not traded today at its last close", () => {
    const session = buildIntradaySession(
      {
        AAA: {
          latestTrade: { p: 50, t: iso(OPEN + MIN) },
          dailyBar: { o: 50, c: 50, t: iso(MIDNIGHT) },
          prevDailyBar: { c: 49, t: "2026-11-25T05:00:00Z" },
        },
        QUIET: {
          latestTrade: { p: 20, t: "2026-11-25T20:59:00Z" },
          dailyBar: { o: 19, c: 20, t: "2026-11-25T05:00:00Z" },
          prevDailyBar: { c: 18, t: "2026-11-24T05:00:00Z" },
        },
      },
      {},
      OPEN + 6 * MIN,
    )!;

    const quiet = session.quotes.find((quote) => quote.ticker === "QUIET")!;
    expect(quiet.previousClose).toBe(20);
    expect(quiet.prices).toEqual([20, 20]);
  });

  it("follows after-hours trading and stops at the last activity", () => {
    const session = buildIntradaySession(
      {
        AAA: {
          latestTrade: { p: 111, t: "2026-11-27T21:12:00Z" }, // after hours
          dailyBar: { o: 101, c: 105, t: iso(MIDNIGHT) },
          prevDailyBar: { c: 100, t: "2026-11-25T05:00:00Z" },
        },
      },
      { AAA: [{ t: "2026-11-27T21:05:00Z", o: 106, c: 110 }] },
      Date.parse("2026-11-28T15:00:00Z"),
    )!;

    expect(session.sessionClose).toBe(Date.parse("2026-11-27T21:00:00Z"));
    expect(session.times.at(-1)).toBe(Date.parse("2026-11-27T21:12:00Z"));
    expect(session.quotes[0]!.price).toBe(111);
    expect(session.quotes[0]!.prices.slice(-3)).toEqual([100, 110, 111]);
  });

  it("uses the calendar's hours on an early-close day", () => {
    const session = buildIntradaySession(
      {
        AAA: {
          latestTrade: { p: 111, t: "2026-11-27T23:30:00Z" }, // past 5 PM
          dailyBar: { o: 101, c: 105, t: iso(MIDNIGHT) },
          prevDailyBar: { c: 100, t: "2026-11-25T05:00:00Z" },
        },
      },
      {},
      Date.parse("2026-11-28T15:00:00Z"),
      { open: "09:30", close: "13:00", session_open: "0400", session_close: "1700" },
    )!;

    expect(session.sessionClose).toBe(Date.parse("2026-11-27T18:00:00Z"));
    // Nothing traded after the 1 PM close, so the path stops there.
    expect(session.times.at(-1)).toBe(session.sessionClose);
    expect(session.quotes[0]!.price).toBe(105);
  });

  it("returns nothing before the session opens or without data", () => {
    expect(buildIntradaySession({ AAA: null }, {}, OPEN)).toBeNull();
    const preMarket = buildIntradaySession(
      {
        AAA: {
          latestTrade: { p: 101, t: iso(OPEN - 60 * MIN) },
          dailyBar: { o: 101, c: 101, t: iso(MIDNIGHT) },
          prevDailyBar: { c: 100, t: "2026-11-25T05:00:00Z" },
        },
      },
      {},
      OPEN - 30 * MIN,
    )!;
    expect(preMarket.times).toEqual([]);
    expect(preMarket.quotes[0]!.price).toBe(101);
  });
});
