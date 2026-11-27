/** Overlays live intraday prices on a snapshot's holdings. */

export type LiveSession = {
  sessionDate: string;
  sessionOpen: number;
  sessionClose: number;
  asOf: number;
  lastTradeAt: number;
  times: number[];
  quotes: Array<{
    ticker: string;
    price: number;
    previousClose: number;
    priceAt: number;
    prices: number[];
  }>;
};

export type LiveHoldingInput = {
  ticker: string;
  companyName: string;
  shares: number;
  costBasis: number;
  currentPrice: number | null;
  currentValue: number;
  gainLoss: number;
  gainLossPercent: number;
  dayReturn?: number | null;
  dayReturnPercent?: number | null;
};

const STALE_TRADE_MS = 10 * 60_000;

/** Whether prices are still moving: in session, with a recent trade. */
export function isSessionLive(session: LiveSession): boolean {
  return (
    session.asOf >= session.sessionOpen &&
    session.asOf <= session.sessionClose &&
    session.asOf - session.lastTradeAt < STALE_TRADE_MS
  );
}

function quotesByTicker(session: LiveSession) {
  return new Map(session.quotes.map((quote) => [quote.ticker, quote]));
}

function percentOf(change: number, basis: number): number {
  return basis > 0 ? (change / basis) * 100 : 0;
}

/**
 * Reprices holdings at the live quote and measures the day from the previous
 * close. Holdings without a quote (cash, mutual funds) keep their snapshot
 * value; they keep their snapshot day return only when that snapshot already
 * covers the live session, and are otherwise treated as flat.
 */
export function applyLiveQuotes<T extends LiveHoldingInput>(
  holdings: T[],
  session: LiveSession,
  snapshotCoversSession: boolean,
) {
  const quotes = quotesByTicker(session);
  const repriced = holdings.map((holding) => {
    const quote = quotes.get(holding.ticker.trim().toUpperCase());
    if (!quote || holding.shares <= 0) {
      const dayReturn = snapshotCoversSession ? (holding.dayReturn ?? 0) : 0;
      return {
        ...holding,
        live: false,
        dayReturn,
        dayReturnPercent: percentOf(dayReturn, holding.currentValue - dayReturn),
      };
    }
    const currentValue = holding.shares * quote.price;
    const dayReturn = holding.shares * (quote.price - quote.previousClose);
    const gainLoss = currentValue - holding.costBasis;
    return {
      ...holding,
      live: true,
      currentPrice: quote.price,
      currentValue,
      gainLoss,
      gainLossPercent: percentOf(gainLoss, holding.costBasis),
      dayReturn,
      dayReturnPercent: percentOf(dayReturn, currentValue - dayReturn),
    };
  });
  const totalCurrentValue = repriced.reduce(
    (sum, holding) => sum + holding.currentValue,
    0,
  );
  const dayReturn = repriced.reduce(
    (sum, holding) => sum + holding.dayReturn,
    0,
  );
  return {
    holdings: repriced,
    totalCurrentValue,
    dayReturn,
    dayReturnPercent: percentOf(dayReturn, totalCurrentValue - dayReturn),
  };
}

export type IntradaySeries = {
  key: string;
  label: string;
  name: string;
  live: boolean;
  /** Value at the previous close. */
  baseline: number;
  latestValue: number;
  latestPrice: number | null;
  /** One value per session time; flat for holdings without a live price. */
  values: number[];
};

/** Each holding's value through the session, largest holding first. */
export function buildIntradaySeries(
  holdings: LiveHoldingInput[],
  session: LiveSession,
): IntradaySeries[] {
  const quotes = quotesByTicker(session);
  return holdings
    .filter((holding) => holding.currentValue > 0)
    .map((holding) => {
      const key = holding.ticker.trim().toUpperCase();
      const quote = holding.shares > 0 ? quotes.get(key) : undefined;
      const base = {
        key,
        label: key || "Cash",
        name: holding.companyName,
      };
      if (!quote) {
        return {
          ...base,
          live: false,
          baseline: holding.currentValue,
          latestValue: holding.currentValue,
          latestPrice: holding.currentPrice,
          values: session.times.map(() => holding.currentValue),
        };
      }
      return {
        ...base,
        live: true,
        baseline: holding.shares * quote.previousClose,
        latestValue: holding.shares * quote.price,
        latestPrice: quote.price,
        values: quote.prices.map((price) => holding.shares * price),
      };
    })
    .sort(
      (a, b) => b.latestValue - a.latestValue || a.key.localeCompare(b.key),
    );
}
