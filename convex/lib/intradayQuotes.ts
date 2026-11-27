/** Shapes Alpaca snapshots and 5-minute bars into one intraday session. */

export type AlpacaSnapshot = {
  latestTrade?: { p: number; t: string } | null;
  dailyBar?: { o: number; c: number; t: string } | null;
  prevDailyBar?: { c: number; t: string } | null;
};

export type IntradayBar = { t: string; o: number; c: number };

export type IntradayQuote = {
  ticker: string;
  price: number;
  previousClose: number;
  priceAt: number;
  /** One price per entry of `times`. */
  prices: number[];
};

export type IntradaySession = {
  /** Trading date in New York, YYYY-MM-DD. */
  sessionDate: string;
  sessionOpen: number;
  sessionClose: number;
  asOf: number;
  /** When the most recent trade across all tickers happened. */
  lastTradeAt: number;
  times: number[];
  quotes: IntradayQuote[];
};

export const INTRADAY_BAR_MS = 5 * 60_000;
// Daily bars are stamped at midnight New York time, so the regular session is
// a fixed offset from them whatever the daylight-saving state.
const OPEN_OFFSET_MS = 9.5 * 3_600_000;
const CLOSE_OFFSET_MS = 16 * 3_600_000;

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function buildIntradaySession(
  snapshots: Record<string, AlpacaSnapshot | null | undefined>,
  bars: Record<string, IntradayBar[] | undefined>,
  now: number,
): IntradaySession | null {
  const usable = Object.entries(snapshots).flatMap(([ticker, snapshot]) => {
    const dailyAt = Date.parse(snapshot?.dailyBar?.t ?? "");
    return snapshot?.dailyBar && Number.isFinite(dailyAt)
      ? [{ ticker, snapshot, dailyBar: snapshot.dailyBar, dailyAt }]
      : [];
  });
  if (usable.length === 0) return null;

  const sessionStart = Math.max(...usable.map((entry) => entry.dailyAt));
  const sessionOpen = sessionStart + OPEN_OFFSET_MS;
  const sessionClose = sessionStart + CLOSE_OFFSET_MS;

  const priced = usable.flatMap(({ ticker, snapshot, dailyBar, dailyAt }) => {
    // A thinly traded ticker may not have printed yet today; its newest daily
    // bar is then the previous session, which makes it today's baseline.
    const tradedThisSession = dailyAt === sessionStart;
    const previousClose = tradedThisSession
      ? (snapshot.prevDailyBar?.c ?? dailyBar.o)
      : dailyBar.c;
    const tradeAt = Date.parse(snapshot.latestTrade?.t ?? "");
    const hasLiveTrade =
      tradedThisSession &&
      positive(snapshot.latestTrade?.p) &&
      Number.isFinite(tradeAt) &&
      tradeAt >= sessionStart &&
      tradeAt <= sessionClose;
    const price = hasLiveTrade ? snapshot.latestTrade!.p : dailyBar.c;
    if (!positive(previousClose) || !positive(price)) return [];
    return [
      {
        ticker,
        price,
        previousClose,
        priceAt: hasLiveTrade
          ? tradeAt
          : tradedThisSession
            ? Math.min(now, sessionClose)
            : sessionStart,
      },
    ];
  });
  if (priced.length === 0) return null;

  const lastTradeAt = Math.max(...priced.map((quote) => quote.priceAt));
  const end = Math.min(now, sessionClose);
  const times: number[] = [];
  if (end >= sessionOpen) {
    times.push(sessionOpen);
    for (
      let barEnd = sessionOpen + INTRADAY_BAR_MS;
      barEnd <= end;
      barEnd += INTRADAY_BAR_MS
    ) {
      times.push(barEnd);
    }
    // The tip carries the latest trade, between bar boundaries.
    const tip = Math.min(end, Math.max(lastTradeAt, times.at(-1)!));
    if (tip > times.at(-1)!) times.push(tip);
  }
  const barSlots = times.filter(
    (time) => (time - sessionOpen) % INTRADAY_BAR_MS === 0,
  ).length;
  const hasTip = times.length > barSlots;

  const quotes = priced.map((quote) => {
    const byStart = new Map(
      (bars[quote.ticker] ?? []).map((bar) => [Date.parse(bar.t), bar]),
    );
    const prices: number[] = [];
    if (barSlots > 0) {
      const openingBar = byStart.get(sessionOpen);
      let running = positive(openingBar?.o)
        ? openingBar.o
        : quote.previousClose;
      prices.push(running);
      for (let slot = 1; slot < barSlots; slot += 1) {
        // IEX skips bars with no trades, so the last price carries forward.
        const bar = byStart.get(sessionOpen + (slot - 1) * INTRADAY_BAR_MS);
        if (positive(bar?.c)) running = bar.c;
        prices.push(running);
      }
      if (hasTip) prices.push(quote.price);
      // After the close there is no tip; end on the session's last price.
      else if (end >= sessionClose) prices[prices.length - 1] = quote.price;
    }
    return { ...quote, prices };
  });

  return {
    sessionDate: new Date(sessionStart).toISOString().slice(0, 10),
    sessionOpen,
    sessionClose,
    asOf: now,
    lastTradeAt,
    times,
    quotes,
  };
}
