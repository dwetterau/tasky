/** Overlays live intraday prices on a snapshot's holdings. */

export type LiveSession = {
  sessionDate: string;
  /** Regular trading hours; `times` can run before and after them. */
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

/**
 * Whether prices are still moving. Judged by the latest trade rather than the
 * clock so that pre-market and after-hours trading count too.
 */
export function isSessionLive(session: LiveSession): boolean {
  return session.asOf - session.lastTradeAt < STALE_TRADE_MS;
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
        dayReturnPercent: percentOf(
          dayReturn,
          holding.currentValue - dayReturn,
        ),
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

export type StackedPoint = { time: number; lower: number; upper: number };

export type StackedBand = {
  /** Extent at each of the stack's `times`; empty (lower = upper) at zero. */
  lower: number[];
  upper: number[];
  /**
   * The band split into stretches that stay on one side of zero. A stretch
   * tapers to nothing where its series crosses zero, so it never has to jump
   * from the gains pile to the losses pile.
   */
  runs: StackedPoint[][];
};

/**
 * Stacks series that can be positive or negative: positives pile up from zero
 * and negatives pile down, in the order given. The time at which any series
 * crosses zero is added to the grid, so every series keeps one sign between
 * neighbouring times.
 */
export function stackDiverging(
  times: number[],
  series: number[][],
): { times: number[]; bands: StackedBand[] } {
  const crossings = new Set<number>();
  for (const values of series) {
    for (let index = 0; index + 1 < times.length; index += 1) {
      const from = values[index]!;
      const to = values[index + 1]!;
      if (from * to < 0) {
        crossings.add(
          times[index]! +
            ((times[index + 1]! - times[index]!) * from) / (from - to),
        );
      }
    }
  }
  const grid = [...new Set([...times, ...crossings])].sort((a, b) => a - b);

  // Each series resampled onto the grid; its own crossing lands on exactly 0.
  const resampled = series.map((values) => {
    let segment = 0;
    return grid.map((time) => {
      while (segment + 2 < times.length && times[segment + 1]! < time) {
        segment += 1;
      }
      const start = times[segment]!;
      const end = times[segment + 1] ?? start;
      const from = values[segment]!;
      const to = values[segment + 1] ?? from;
      if (time <= start || end === start) return from;
      if (time >= end) return to;
      if (from * to < 0 && crossings.has(time)) {
        const crossing = start + ((end - start) * from) / (from - to);
        if (crossing === time) return 0;
      }
      return from + ((to - from) * (time - start)) / (end - start);
    });
  });

  const gains = grid.map(() => 0);
  const losses = grid.map(() => 0);
  const bands = resampled.map((values) => {
    const lower: number[] = [];
    const upper: number[] = [];
    const runs: StackedPoint[][] = [];
    let run: StackedPoint[] = [];
    let runSide = 0;
    const closeRun = () => {
      if (run.length > 1) runs.push(run);
      run = [];
      runSide = 0;
    };
    values.forEach((value, index) => {
      const time = grid[index]!;
      const gainsAt = gains[index]!;
      const lossesAt = losses[index]!;
      // Where this series would sit on either side if it had any height.
      const emptyAt = (side: number): StackedPoint => {
        const at = side > 0 ? gainsAt : lossesAt;
        return { time, lower: at, upper: at };
      };
      const side = Math.sign(value);
      if (side === 0) {
        if (runSide !== 0) run.push(emptyAt(runSide));
        closeRun();
        lower.push(0);
        upper.push(0);
        return;
      }
      if (runSide !== side) {
        closeRun();
        runSide = side;
        // Start from nothing at the zero this stretch grows out of.
        if (index > 0 && values[index - 1] === 0) {
          const previous = index - 1;
          const at = side > 0 ? gains[previous]! : losses[previous]!;
          run.push({ time: grid[previous]!, lower: at, upper: at });
        }
      }
      const from = side > 0 ? gainsAt : lossesAt;
      const to = from + value;
      (side > 0 ? gains : losses)[index] = to;
      const point = {
        time,
        lower: Math.min(from, to),
        upper: Math.max(from, to),
      };
      lower.push(point.lower);
      upper.push(point.upper);
      run.push(point);
    });
    closeRun();
    return { lower, upper, runs };
  });
  return { times: grid, bands };
}
