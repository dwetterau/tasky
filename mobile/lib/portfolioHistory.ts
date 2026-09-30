export const CASH_SERIES = "__tasky_cash__";

export type HistoricalHolding = {
  ticker: string;
  name: string;
  value: number;
  costBasis: number;
};

export type HistoricalPoint = {
  holdings: HistoricalHolding[];
};

export type HoldingSeries = {
  key: string;
  ticker: string;
  name: string;
  latestValue: number;
  maxValue: number;
};

export function holdingSeriesKey(ticker: string): string {
  return ticker || CASH_SERIES;
}

export function buildHoldingSeries(
  points: HistoricalPoint[],
): HoldingSeries[] {
  const byKey = new Map<string, HoldingSeries>();

  for (const point of points) {
    for (const holding of point.holdings) {
      const key = holdingSeriesKey(holding.ticker);
      const existing = byKey.get(key);
      if (existing) {
        existing.name ||= holding.name;
        existing.maxValue = Math.max(
          existing.maxValue,
          Math.abs(holding.value),
        );
      } else {
        byKey.set(key, {
          key,
          ticker: holding.ticker,
          name: holding.name,
          latestValue: 0,
          maxValue: Math.abs(holding.value),
        });
      }
    }
  }

  const latest = points[points.length - 1];
  for (const holding of latest?.holdings ?? []) {
    const series = byKey.get(holdingSeriesKey(holding.ticker));
    if (series) {
      series.latestValue = holding.value;
    }
  }

  return [...byKey.values()]
    .filter((series) => series.maxValue !== 0)
    .sort(
      (a, b) =>
        b.latestValue - a.latestValue ||
        b.maxValue - a.maxValue ||
        a.ticker.localeCompare(b.ticker),
    );
}
