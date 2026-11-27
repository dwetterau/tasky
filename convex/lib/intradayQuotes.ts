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
  /** Regular trading hours; `times` can run before and after them. */
  sessionOpen: number;
  sessionClose: number;
  asOf: number;
  /** When the most recent trade across all tickers happened. */
  lastTradeAt: number;
  times: number[];
  quotes: IntradayQuote[];
};

export const INTRADAY_BAR_MS = 5 * 60_000;
const HOUR_MS = 3_600_000;

export type SessionHours = {
  /** Midnight in New York on the trading date. */
  sessionStart: number;
  extendedOpen: number;
  sessionOpen: number;
  sessionClose: number;
  extendedClose: number;
};

/** A market calendar day, with times as New York wall-clock "HH:MM" or "HHMM". */
export type CalendarDay = {
  open?: string;
  close?: string;
  session_open?: string;
  session_close?: string;
};

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clockOffset(value: string | undefined, fallbackHours: number): number {
  const match = /^(\d{2}):?(\d{2})$/.exec(value ?? "");
  return match
    ? Number(match[1]) * HOUR_MS + Number(match[2]) * 60_000
    : fallbackHours * HOUR_MS;
}

function dailyBarTime(snapshot: AlpacaSnapshot | null | undefined): number {
  return Date.parse(snapshot?.dailyBar?.t ?? "");
}

/**
 * The trading day the snapshots belong to. Daily bars are stamped at midnight
 * New York time, so session times are fixed offsets from them whatever the
 * daylight-saving state. Without a calendar day, a full-length session is
 * assumed.
 */
export function sessionHours(
  snapshots: Record<string, AlpacaSnapshot | null | undefined>,
  calendar?: CalendarDay | null,
): SessionHours | null {
  const starts = Object.values(snapshots)
    .map(dailyBarTime)
    .filter(Number.isFinite);
  if (starts.length === 0) return null;
  const sessionStart = Math.max(...starts);
  return {
    sessionStart,
    extendedOpen: sessionStart + clockOffset(calendar?.session_open, 4),
    sessionOpen: sessionStart + clockOffset(calendar?.open, 9.5),
    sessionClose: sessionStart + clockOffset(calendar?.close, 16),
    extendedClose: sessionStart + clockOffset(calendar?.session_close, 20),
  };
}

export function sessionDateOf(hours: SessionHours): string {
  return new Date(hours.sessionStart).toISOString().slice(0, 10);
}

export function buildIntradaySession(
  snapshots: Record<string, AlpacaSnapshot | null | undefined>,
  bars: Record<string, IntradayBar[] | undefined>,
  now: number,
  calendar?: CalendarDay | null,
): IntradaySession | null {
  const hours = sessionHours(snapshots, calendar);
  if (!hours) return null;
  const { sessionStart, extendedOpen, sessionOpen, sessionClose } = hours;
  const extendedClose = Math.max(hours.extendedClose, sessionClose);

  const priced = Object.entries(snapshots).flatMap(([ticker, snapshot]) => {
    const dailyBar = snapshot?.dailyBar;
    const dailyAt = dailyBarTime(snapshot);
    if (!snapshot || !dailyBar || !Number.isFinite(dailyAt)) return [];
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
      tradeAt <= extendedClose;
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

  const barsByTicker = new Map(
    priced.map((quote) => [
      quote.ticker,
      new Map(
        (bars[quote.ticker] ?? []).flatMap((bar) => {
          const start = Date.parse(bar.t);
          return start >= extendedOpen && start < extendedClose
            ? [[start, bar] as const]
            : [];
        }),
      ),
    ]),
  );
  const barStarts = [...barsByTicker.values()].flatMap((byStart) => [
    ...byStart.keys(),
  ]);
  const lastTradeAt = Math.max(...priced.map((quote) => quote.priceAt));

  // The path covers extended hours only where something actually traded: it
  // starts at the first pre-market bar and, once the regular session is over,
  // stops at the last after-hours activity instead of running on flat.
  const gridStart = Math.min(sessionOpen, ...barStarts);
  const lastActivity = Math.max(
    lastTradeAt,
    ...barStarts.map((start) => start + INTRADAY_BAR_MS),
  );
  const end = Math.min(
    now,
    extendedClose,
    now > sessionClose ? Math.max(sessionClose, lastActivity) : now,
  );
  const times: number[] = [];
  if (end >= gridStart) {
    for (let time = gridStart; time <= end; time += INTRADAY_BAR_MS) {
      times.push(time);
    }
    // The tip carries the latest trade, between bar boundaries.
    const tip = Math.min(end, Math.max(lastTradeAt, times.at(-1)!));
    if (tip > times.at(-1)!) times.push(tip);
  }
  const barSlots = times.filter(
    (time) => (time - gridStart) % INTRADAY_BAR_MS === 0,
  ).length;

  const quotes = priced.map((quote) => {
    const byStart = barsByTicker.get(quote.ticker)!;
    const prices: number[] = [];
    if (barSlots > 0) {
      const firstBar = byStart.get(gridStart);
      let running = positive(firstBar?.o) ? firstBar.o : quote.previousClose;
      prices.push(running);
      for (let slot = 1; slot < barSlots; slot += 1) {
        // IEX skips bars with no trades, so the last price carries forward.
        const bar = byStart.get(gridStart + (slot - 1) * INTRADAY_BAR_MS);
        if (positive(bar?.c)) running = bar.c;
        prices.push(running);
      }
      // The path always ends on the latest price, at the tip when there is
      // one and otherwise on the last bar boundary.
      if (times.length > barSlots) prices.push(quote.price);
      else prices[prices.length - 1] = quote.price;
    }
    return { ...quote, prices };
  });

  return {
    sessionDate: sessionDateOf(hours),
    sessionOpen,
    sessionClose,
    asOf: now,
    lastTradeAt,
    times,
    quotes,
  };
}
