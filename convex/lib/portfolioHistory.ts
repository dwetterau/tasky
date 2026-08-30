export type PriceHistoryPoint = {
  ticker: string;
  date: string;
  close: number;
  quantity: number;
};

export type HoldingShares = {
  ticker: string;
  shares: number;
};

export type HistoricalChartPoint = {
  date: string;
  displayDate: string;
  total: number;
  dailyChange: number;
  tickerValues: Record<string, number>;
  tickerChanges: Record<string, number>;
};

const HISTORY_NAME_PATTERN = /^(.+)-(\d{4}-\d{2}-\d{2})$/;

export function parseHistoryRecordName(
  name: string,
): { ticker: string; date: string } | null {
  const match = name.trim().toUpperCase().match(HISTORY_NAME_PATTERN);
  if (!match?.[1] || !match[2]) return null;
  return { ticker: match[1], date: match[2] };
}

function parseLocalDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

export function collectPriceHistoryPoints(
  records: Array<{
    name: string;
    date: string | null;
    close: number;
    quantity: number;
  }>,
  startDate?: string | null,
): PriceHistoryPoint[] {
  const points: PriceHistoryPoint[] = [];
  for (const record of records) {
    const parsed = parseHistoryRecordName(record.name);
    const date = record.date ?? parsed?.date ?? null;
    const ticker = parsed?.ticker ?? null;
    if (!date || !ticker || !Number.isFinite(record.close)) {
      continue;
    }
    if (startDate && date < startDate) {
      continue;
    }
    points.push({
      ticker,
      date,
      close: record.close,
      quantity: Number.isFinite(record.quantity) ? record.quantity : 0,
    });
  }

  return points.sort(
    (a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker),
  );
}

export function buildHistoricalChartData(
  points: PriceHistoryPoint[],
  holdings: HoldingShares[],
  selectedTickers: Iterable<string>,
): HistoricalChartPoint[] {
  const selected = new Set(
    [...selectedTickers].map((ticker) => ticker.toUpperCase()),
  );
  if (points.length === 0 || holdings.length === 0 || selected.size === 0) {
    return [];
  }

  const sharesMap = new Map<string, number>();
  for (const holding of holdings) {
    sharesMap.set(holding.ticker.toUpperCase(), holding.shares);
  }

  const priceMap = new Map<
    string,
    Map<string, { price: number; quantity: number }>
  >();
  const allDates = new Set<string>();
  for (const point of points) {
    const ticker = point.ticker.toUpperCase();
    if (!selected.has(ticker)) continue;
    const shares =
      point.quantity > 0 ? point.quantity : (sharesMap.get(ticker) ?? 0);
    if (!priceMap.has(point.date)) {
      priceMap.set(point.date, new Map());
    }
    priceMap.get(point.date)!.set(ticker, {
      price: point.close,
      quantity: shares,
    });
    allDates.add(point.date);
  }

  const data: HistoricalChartPoint[] = [];
  let previousTotal = 0;
  let previousTickerValues: Record<string, number> = {};

  for (const date of [...allDates].sort()) {
    const prices = priceMap.get(date) ?? new Map();
    let totalValue = 0;
    const tickerValues: Record<string, number> = {};
    const tickerChanges: Record<string, number> = {};
    let hasAllTickers = true;

    for (const ticker of selected) {
      const row = prices.get(ticker);
      const shares = row?.quantity ?? sharesMap.get(ticker) ?? 0;
      const price = row?.price;
      if (price !== undefined && shares > 0) {
        const value = price * shares;
        tickerValues[ticker] = value;
        totalValue += value;
        const prevValue = previousTickerValues[ticker];
        tickerChanges[ticker] =
          data.length > 0 && prevValue && prevValue > 0
            ? ((value - prevValue) / prevValue) * 100
            : 0;
      } else if ((sharesMap.get(ticker) ?? 0) > 0) {
        hasAllTickers = false;
      }
    }

    if (!hasAllTickers) {
      continue;
    }

    const dailyChange =
      data.length > 0 && previousTotal > 0
        ? ((totalValue - previousTotal) / previousTotal) * 100
        : 0;

    data.push({
      date,
      displayDate: parseLocalDate(date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      total: totalValue,
      dailyChange,
      tickerValues,
      tickerChanges,
    });
    previousTotal = totalValue;
    previousTickerValues = tickerValues;
  }

  return data;
}

export function sortTickersByLatestValue(
  tickers: Iterable<string>,
  points: HistoricalChartPoint[],
): string[] {
  const latest = points[points.length - 1];
  return [...tickers].sort((a, b) => {
    const valueA = latest?.tickerValues[a] ?? 0;
    const valueB = latest?.tickerValues[b] ?? 0;
    return valueA - valueB;
  });
}
