import { v } from "convex/values";
import { action, ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "./auth";
import { decryptApiKey } from "./apiKeys";
import { ApiKeyType } from "./schema";

const POSITIONS_TABLE = "Positions";
const PRICE_HISTORY_TABLE = "Price History";
const ALPACA_BASE_URL = "https://data.alpaca.markets/v2";
const AIRTABLE_BATCH_SIZE = 10;
const AIRTABLE_THROTTLE_MS = 220;

const portfolioCredentialTypes = {
  airtableApiKey: "portfolio_airtable_api_key",
  airtableBaseId: "portfolio_airtable_base_id",
  schwabPositionsViewId: "portfolio_schwab_positions_view_id",
  resetDate: "portfolio_reset_date",
} satisfies Record<string, ApiKeyType>;

type AirtableRecord = {
  id: string;
  createdTime?: string;
  fields: Record<string, unknown>;
};

type AirtableListResponse = {
  records?: AirtableRecord[];
  offset?: string;
  error?: {
    type?: string;
    message?: string;
  };
};

type PortfolioCredentials = {
  apiKey: string;
  baseId: string;
  positionsViewId: string;
};

type AlpacaCredentials = {
  apiKey: string;
  secretKey: string;
};

type AlpacaBar = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n: number;
  vw: number;
};

type AlpacaBarsResponse = {
  bars?: Record<string, AlpacaBar[]>;
  next_page_token?: string;
};

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }> | null;
    error?: { code?: string; description?: string } | null;
  };
};

type RecentPriceStatus = {
  latestPriceDate: string | null;
  previousPriceDate: string | null;
  dayReturn: number | null;
  dayReturnPercent: number | null;
  latestValue: number | null;
  previousValue: number | null;
};

function asNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function datePart(value: string): string {
  return value.split("T")[0] ?? value;
}

function formatAirtableDate(value: unknown): string | null {
  if (!value) return null;
  return datePart(asString(value));
}

function maxIsoDate(dates: string[]): string | null {
  if (dates.length === 0) return null;
  return dates.reduce((max, current) => (current > max ? current : max));
}

function targetPercentFromAirtable(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n * 100 : null;
}

function currentPriceFromValueAndQuantity(
  value: unknown,
  quantity: unknown,
): number | null {
  const q = Number(quantity);
  const v = Number(value);
  if (
    !q ||
    !Number.isFinite(q) ||
    value === undefined ||
    value === null ||
    !Number.isFinite(v)
  ) {
    return null;
  }
  return v / q;
}

function calculateHolding(record: AirtableRecord) {
  const shares = asNumber(record.fields.Quantity);
  const costBasis = asNumber(record.fields["Cost Basis"]);
  const currentPrice = currentPriceFromValueAndQuantity(
    record.fields.Value,
    shares,
  );
  const currentValue = currentPrice === null ? 0 : currentPrice * shares;
  const gainLoss = currentValue - costBasis;

  return {
    id: record.id,
    ticker: asString(record.fields.Ticker).toUpperCase(),
    companyName: asString(record.fields.Name),
    costBasis,
    shares,
    currentPrice,
    currentValue,
    gainLoss,
    gainLossPercent: costBasis > 0 ? (gainLoss / costBasis) * 100 : 0,
    targetAllocation: targetPercentFromAirtable(record.fields["Target %"]),
    createdAt: record.createdTime ?? new Date().toISOString(),
  };
}

function tickerHistoryNamePrefixFormula(ticker: string): string {
  const escaped = ticker
    .toUpperCase()
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
  return `FIND('${escaped}-', {Name}) = 1`;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function getTradingDays(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const current = new Date(`${startDate}T12:00:00.000Z`);
  const end = new Date(`${endDate}T12:00:00.000Z`);

  while (current <= end) {
    const dayOfWeek = current.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      days.push(current.toISOString().slice(0, 10));
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return days;
}

function addOneDay(dateStr: string): string {
  const date = new Date(`${dateStr}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function getAlpacaCredentials(): AlpacaCredentials | null {
  const apiKey = process.env.ALPACA_API_KEY?.trim();
  const secretKey = process.env.ALPACA_SECRET_KEY?.trim();
  if (!apiKey || !secretKey) {
    return null;
  }
  return { apiKey, secretKey };
}

async function fetchAirtableRecords({
  apiKey,
  baseId,
  table,
  params,
}: {
  apiKey: string;
  baseId: string;
  table: string;
  params: URLSearchParams;
}): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const pageParams = new URLSearchParams(params);
    if (offset) {
      pageParams.set("offset", offset);
    }
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}?${pageParams.toString()}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    const data = (await response.json()) as AirtableListResponse;
    if (!response.ok) {
      const message =
        data.error?.message ??
        `Airtable request failed with ${response.status}`;
      throw new Error(message);
    }
    records.push(...(data.records ?? []));
    offset = data.offset;
  } while (offset);

  return records;
}

async function createAirtableRecords({
  apiKey,
  baseId,
  table,
  records,
}: {
  apiKey: string;
  baseId: string;
  table: string;
  records: Array<{ fields: Record<string, unknown> }>;
}): Promise<number> {
  let created = 0;

  for (let i = 0; i < records.length; i += AIRTABLE_BATCH_SIZE) {
    const chunk = records.slice(i, i + AIRTABLE_BATCH_SIZE);
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: chunk, typecast: true }),
    });
    const data = (await response.json()) as AirtableListResponse;
    if (!response.ok) {
      const message =
        data.error?.message ??
        `Airtable create request failed with ${response.status}`;
      throw new Error(message);
    }
    created += chunk.length;

    if (i + AIRTABLE_BATCH_SIZE < records.length) {
      await new Promise((resolve) =>
        setTimeout(resolve, AIRTABLE_THROTTLE_MS),
      );
    }
  }

  return created;
}

async function getLatestPriceDate(
  credentials: PortfolioCredentials,
  ticker: string,
): Promise<string | null> {
  const params = new URLSearchParams();
  params.set("filterByFormula", tickerHistoryNamePrefixFormula(ticker));
  params.set("sort[0][field]", "Date");
  params.set("sort[0][direction]", "desc");
  params.set("maxRecords", "1");

  const records = await fetchAirtableRecords({
    apiKey: credentials.apiKey,
    baseId: credentials.baseId,
    table: PRICE_HISTORY_TABLE,
    params,
  });

  return records[0] ? formatAirtableDate(records[0].fields.Date) : null;
}

async function fetchBarsFromAlpaca(
  tickers: string[],
  startDate: string,
  endDate: string,
  credentials: AlpacaCredentials,
): Promise<Record<string, AlpacaBar[]>> {
  const allBars: Record<string, AlpacaBar[]> = Object.fromEntries(
    tickers.map((ticker) => [ticker, []]),
  );
  let nextPageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      symbols: tickers.join(","),
      start: `${startDate}T00:00:00Z`,
      end: `${endDate}T23:59:59Z`,
      timeframe: "1Day",
      limit: "10000",
      adjustment: "split",
      feed: "iex",
    });
    if (nextPageToken) {
      params.set("page_token", nextPageToken);
    }

    const response = await fetch(
      `${ALPACA_BASE_URL}/stocks/bars?${params.toString()}`,
      {
        headers: {
          "APCA-API-KEY-ID": credentials.apiKey,
          "APCA-API-SECRET-KEY": credentials.secretKey,
          Accept: "application/json",
        },
      },
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Alpaca API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as AlpacaBarsResponse;
    for (const [ticker, bars] of Object.entries(data.bars ?? {})) {
      allBars[ticker] = [...(allBars[ticker] ?? []), ...bars];
    }
    nextPageToken = data.next_page_token;
  } while (nextPageToken);

  return allBars;
}

async function fetchBarsFromYahoo(
  ticker: string,
  startDate: string,
  endDate: string,
): Promise<AlpacaBar[]> {
  const start = Math.floor(new Date(startDate).getTime() / 1000);
  const end = Math.floor(new Date(`${endDate}T23:59:59`).getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&period1=${start}&period2=${end}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      console.warn(`Yahoo Finance error for ${ticker}: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as YahooChartResponse;
    const result = data.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const quote = result?.indicators?.quote?.[0];
    if (data.chart?.error || !result || !quote) {
      console.warn(`Yahoo Finance: No data for ${ticker}`);
      return [];
    }

    const bars: AlpacaBar[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const open = quote.open?.[i];
      const high = quote.high?.[i];
      const low = quote.low?.[i];
      const close = quote.close?.[i];
      const volume = quote.volume?.[i];
      if (open == null || high == null || low == null || close == null) {
        continue;
      }

      bars.push({
        t: new Date(timestamps[i]! * 1000).toISOString(),
        o: open,
        h: high,
        l: low,
        c: close,
        v: volume ?? 0,
        n: 0,
        vw: 0,
      });
    }

    return bars;
  } catch (error) {
    console.error(`Yahoo Finance fetch error for ${ticker}:`, error);
    return [];
  }
}

type PositionSyncPlan = {
  ticker: string;
  positionRecordId: string;
  shares: number;
  missingDates: string[];
};

async function insertPriceHistoryBatch(
  credentials: PortfolioCredentials,
  rows: Array<{
    ticker: string;
    positionRecordId: string;
    date: string;
    closePrice: number;
    quantity: number;
  }>,
): Promise<number> {
  if (rows.length === 0) return 0;

  return await createAirtableRecords({
    apiKey: credentials.apiKey,
    baseId: credentials.baseId,
    table: PRICE_HISTORY_TABLE,
    records: rows.map((row) => ({
      fields: {
        Name: `${row.ticker}-${row.date}`,
        Position: [row.positionRecordId],
        Date: row.date,
        "Close Price": row.closePrice,
        Quantity: row.quantity,
      },
    })),
  });
}

function mapPriceHistoryPoint(record: AirtableRecord): {
  date: string | null;
  close: number;
  quantity: number;
  value: number;
} {
  const date = formatAirtableDate(record.fields.Date);
  const close = asNumber(record.fields["Close Price"]);
  const quantity = asNumber(record.fields.Quantity);
  return {
    date,
    close,
    quantity,
    value: close * quantity,
  };
}

async function getRecentPriceStatus(
  credentials: PortfolioCredentials,
  ticker: string,
): Promise<RecentPriceStatus> {
  const params = new URLSearchParams();
  params.set("filterByFormula", tickerHistoryNamePrefixFormula(ticker));
  params.set("sort[0][field]", "Date");
  params.set("sort[0][direction]", "desc");
  params.set("maxRecords", "2");

  const records = await fetchAirtableRecords({
    apiKey: credentials.apiKey,
    baseId: credentials.baseId,
    table: PRICE_HISTORY_TABLE,
    params,
  });
  const latest = records[0] ? mapPriceHistoryPoint(records[0]) : null;
  const previous = records[1] ? mapPriceHistoryPoint(records[1]) : null;

  if (!latest || !previous || previous.value === 0) {
    return {
      latestPriceDate: latest?.date ?? null,
      previousPriceDate: previous?.date ?? null,
      dayReturn: null,
      dayReturnPercent: null,
      latestValue: latest?.value ?? null,
      previousValue: previous?.value ?? null,
    };
  }
  const dayReturn = latest.value - previous.value;
  return {
    latestPriceDate: latest.date,
    previousPriceDate: previous.date,
    dayReturn,
    dayReturnPercent: (dayReturn / previous.value) * 100,
    latestValue: latest.value,
    previousValue: previous.value,
  };
}

async function getCredential(
  ctx: ActionCtx,
  userId: string,
  type: ApiKeyType,
): Promise<string | null> {
  const row = await ctx.runQuery(internal.apiKeys.getLatestByTypeInternal, {
    userId,
    type,
  });
  if (!row) return null;
  const value = await decryptApiKey(row.encryptedValue, row.iv);
  return value.trim() || null;
}

export const getSnapshot = action({
  args: {
    includePriceStatus: v.optional(v.boolean()),
  },
  returns: v.object({
    status: v.union(
      v.literal("ok"),
      v.literal("no_credentials"),
      v.literal("airtable_error"),
    ),
    message: v.optional(v.string()),
    holdings: v.array(
      v.object({
        id: v.string(),
        ticker: v.string(),
        companyName: v.string(),
        costBasis: v.number(),
        shares: v.number(),
        currentPrice: v.union(v.number(), v.null()),
        currentValue: v.number(),
        gainLoss: v.number(),
        gainLossPercent: v.number(),
        targetAllocation: v.union(v.number(), v.null()),
        createdAt: v.string(),
        latestPriceDate: v.optional(v.union(v.string(), v.null())),
        previousPriceDate: v.optional(v.union(v.string(), v.null())),
        dayReturn: v.optional(v.union(v.number(), v.null())),
        dayReturnPercent: v.optional(v.union(v.number(), v.null())),
      }),
    ),
    summary: v.object({
      totalCost: v.number(),
      totalCurrentValue: v.number(),
      gainLoss: v.number(),
      gainLossPercent: v.number(),
      holdingsCount: v.number(),
      latestPriceDate: v.union(v.string(), v.null()),
      dayReturnDate: v.union(v.string(), v.null()),
      dayReturn: v.union(v.number(), v.null()),
      dayReturnPercent: v.union(v.number(), v.null()),
    }),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const [apiKey, baseId, positionsViewId] = await Promise.all([
      getCredential(ctx, userId, portfolioCredentialTypes.airtableApiKey),
      getCredential(ctx, userId, portfolioCredentialTypes.airtableBaseId),
      getCredential(
        ctx,
        userId,
        portfolioCredentialTypes.schwabPositionsViewId,
      ),
    ]);

    if (!apiKey || !baseId || !positionsViewId) {
      return {
        status: "no_credentials" as const,
        message:
          "Add Portfolio Airtable API Key, Base ID, and Schwab Positions View ID in Tasky settings.",
        holdings: [],
        summary: {
          totalCost: 0,
          totalCurrentValue: 0,
          gainLoss: 0,
          gainLossPercent: 0,
          holdingsCount: 0,
          latestPriceDate: null,
          dayReturnDate: null,
          dayReturn: null,
          dayReturnPercent: null,
        },
      };
    }

    const credentials = { apiKey, baseId, positionsViewId };
    try {
      const params = new URLSearchParams();
      params.set("view", positionsViewId);
      params.set("sort[0][field]", "Ticker");
      params.set("sort[0][direction]", "asc");
      const records = await fetchAirtableRecords({
        apiKey,
        baseId,
        table: POSITIONS_TABLE,
        params,
      });

      const holdings = records.map(calculateHolding);
      const includePriceStatus = args.includePriceStatus ?? true;
      const recentPriceStatuses = includePriceStatus
        ? await Promise.all(
            holdings.map(async (holding) => ({
              ticker: holding.ticker,
              ...(await getRecentPriceStatus(credentials, holding.ticker)),
            })),
          )
        : [];
      const recentPriceStatusByTicker = new Map(
        recentPriceStatuses.map((entry) => [entry.ticker, entry]),
      );
      const holdingsWithPriceStatus = holdings.map((holding) => ({
        ...holding,
        latestPriceDate: includePriceStatus
          ? (recentPriceStatusByTicker.get(holding.ticker)?.latestPriceDate ??
            null)
          : null,
        previousPriceDate: includePriceStatus
          ? (recentPriceStatusByTicker.get(holding.ticker)?.previousPriceDate ??
            null)
          : null,
        dayReturn: includePriceStatus
          ? (recentPriceStatusByTicker.get(holding.ticker)?.dayReturn ?? null)
          : null,
        dayReturnPercent: includePriceStatus
          ? (recentPriceStatusByTicker.get(holding.ticker)?.dayReturnPercent ??
            null)
          : null,
      }));
      const totalCost = holdings.reduce(
        (sum, holding) => sum + holding.costBasis,
        0,
      );
      const totalCurrentValue = holdings.reduce(
        (sum, holding) => sum + holding.currentValue,
        0,
      );
      const gainLoss = totalCurrentValue - totalCost;
      const allLatestDates = recentPriceStatuses
        .map((entry) => entry.latestPriceDate)
        .filter((date): date is string => Boolean(date));
      const dayReturnStatuses = recentPriceStatuses.filter(
        (
          entry,
        ): entry is typeof entry & {
          latestValue: number;
          previousValue: number;
          dayReturn: number;
        } =>
          entry.latestValue !== null &&
          entry.previousValue !== null &&
          entry.dayReturn !== null,
      );
      const latestDayReturnDates = dayReturnStatuses
        .map((entry) => entry.latestPriceDate)
        .filter((date): date is string => Boolean(date));
      const totalLatestHistoryValue = dayReturnStatuses.reduce(
        (sum, entry) => sum + entry.latestValue,
        0,
      );
      const totalPreviousHistoryValue = dayReturnStatuses.reduce(
        (sum, entry) => sum + entry.previousValue,
        0,
      );
      const dayReturn = dayReturnStatuses.reduce(
        (sum, entry) => sum + entry.dayReturn,
        0,
      );
      const hasDayReturn =
        dayReturnStatuses.length > 0 && totalPreviousHistoryValue > 0;

      return {
        status: "ok" as const,
        holdings: holdingsWithPriceStatus,
        summary: {
          totalCost,
          totalCurrentValue,
          gainLoss,
          gainLossPercent: totalCost > 0 ? (gainLoss / totalCost) * 100 : 0,
          holdingsCount: holdings.length,
          latestPriceDate: maxIsoDate(allLatestDates),
          dayReturnDate: maxIsoDate(latestDayReturnDates),
          dayReturn: hasDayReturn ? dayReturn : null,
          dayReturnPercent: hasDayReturn
            ? ((totalLatestHistoryValue - totalPreviousHistoryValue) /
                totalPreviousHistoryValue) *
              100
            : null,
        },
      };
    } catch (error) {
      return {
        status: "airtable_error" as const,
        message:
          error instanceof Error
            ? error.message
            : "Failed to fetch portfolio data.",
        holdings: [],
        summary: {
          totalCost: 0,
          totalCurrentValue: 0,
          gainLoss: 0,
          gainLossPercent: 0,
          holdingsCount: 0,
          latestPriceDate: null,
          dayReturnDate: null,
          dayReturn: null,
          dayReturnPercent: null,
        },
      };
    }
  },
});

export const syncPriceHistory = action({
  args: {},
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
    synced: v.number(),
    details: v.object({
      tickersProcessed: v.number(),
      recordsFound: v.number(),
      recordsInserted: v.number(),
      yahooTickers: v.array(v.string()),
    }),
  }),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const [apiKey, baseId, positionsViewId, resetDate] = await Promise.all([
      getCredential(ctx, userId, portfolioCredentialTypes.airtableApiKey),
      getCredential(ctx, userId, portfolioCredentialTypes.airtableBaseId),
      getCredential(
        ctx,
        userId,
        portfolioCredentialTypes.schwabPositionsViewId,
      ),
      getCredential(ctx, userId, portfolioCredentialTypes.resetDate),
    ]);
    if (!apiKey || !baseId || !positionsViewId || !resetDate) {
      return {
        success: false,
        message:
          "Add Portfolio Airtable API Key, Base ID, Schwab Positions View ID, and Reset Date in Tasky settings.",
        synced: 0,
        details: {
          tickersProcessed: 0,
          recordsFound: 0,
          recordsInserted: 0,
          yahooTickers: [],
        },
      };
    }
    if (!isValidIsoDate(resetDate)) {
      return {
        success: false,
        message: "Portfolio Reset Date must be in YYYY-MM-DD format.",
        synced: 0,
        details: {
          tickersProcessed: 0,
          recordsFound: 0,
          recordsInserted: 0,
          yahooTickers: [],
        },
      };
    }

    const alpacaCredentials = getAlpacaCredentials();
    if (!alpacaCredentials) {
      return {
        success: false,
        message:
          "Set ALPACA_API_KEY and ALPACA_SECRET_KEY in the Tasky Convex environment.",
        synced: 0,
        details: {
          tickersProcessed: 0,
          recordsFound: 0,
          recordsInserted: 0,
          yahooTickers: [],
        },
      };
    }

    const credentials = { apiKey, baseId, positionsViewId };
    const params = new URLSearchParams();
    params.set("view", positionsViewId);
    params.set("sort[0][field]", "Ticker");
    params.set("sort[0][direction]", "asc");

    const records = await fetchAirtableRecords({
      apiKey,
      baseId,
      table: POSITIONS_TABLE,
      params,
    });
    const holdings = records.map(calculateHolding);
    if (holdings.length === 0) {
      return {
        success: true,
        message: "No holdings found.",
        synced: 0,
        details: {
          tickersProcessed: 0,
          recordsFound: 0,
          recordsInserted: 0,
          yahooTickers: [],
        },
      };
    }

    const startDate = resetDate;
    const endDate = getTodayDate();
    const allTradingDays = getTradingDays(startDate, endDate);
    const positionsToSync: PositionSyncPlan[] = [];

    for (const holding of holdings) {
      const latest = await getLatestPriceDate(credentials, holding.ticker);
      let start = latest ? addOneDay(latest) : startDate;
      if (start < startDate) {
        start = startDate;
      }
      const missingDates = allTradingDays.filter(
        (day) => day >= start && day <= endDate,
      );
      if (missingDates.length > 0) {
        positionsToSync.push({
          ticker: holding.ticker,
          positionRecordId: holding.id,
          shares: holding.shares,
          missingDates,
        });
      }
    }

    if (positionsToSync.length === 0) {
      return {
        success: true,
        message: "All price data is up to date.",
        synced: 0,
        details: {
          tickersProcessed: 0,
          recordsFound: 0,
          recordsInserted: 0,
          yahooTickers: [],
        },
      };
    }

    const tickersNeedingData = [
      ...new Set(positionsToSync.map((plan) => plan.ticker)),
    ];
    const earliestMissing = positionsToSync
      .flatMap((plan) => plan.missingDates)
      .sort()[0]!;
    const bars = await fetchBarsFromAlpaca(
      tickersNeedingData,
      earliestMissing,
      endDate,
      alpacaCredentials,
    );
    const tickersWithNoData = tickersNeedingData.filter(
      (ticker) => !bars[ticker] || bars[ticker].length === 0,
    );

    const alpacaDates = new Set<string>();
    for (const [ticker, tickerBars] of Object.entries(bars)) {
      if (tickersWithNoData.includes(ticker)) continue;
      for (const bar of tickerBars) {
        alpacaDates.add(datePart(bar.t));
      }
    }

    const yahooTickers: string[] = [];
    for (const ticker of tickersWithNoData) {
      const yahooBars = await fetchBarsFromYahoo(
        ticker,
        earliestMissing,
        endDate,
      );
      const filteredBars =
        alpacaDates.size > 0
          ? yahooBars.filter((bar) => alpacaDates.has(datePart(bar.t)))
          : yahooBars;
      if (filteredBars.length > 0) {
        bars[ticker] = filteredBars;
        yahooTickers.push(ticker);
      }
    }

    const priceRows: Array<{
      ticker: string;
      positionRecordId: string;
      date: string;
      closePrice: number;
      quantity: number;
    }> = [];
    for (const plan of positionsToSync) {
      const tickerBars = bars[plan.ticker] ?? [];
      const missingDates = new Set(plan.missingDates);
      for (const bar of tickerBars) {
        const date = datePart(bar.t);
        if (missingDates.has(date)) {
          priceRows.push({
            ticker: plan.ticker,
            positionRecordId: plan.positionRecordId,
            date,
            closePrice: bar.c,
            quantity: plan.shares,
          });
        }
      }
    }

    const insertedCount = await insertPriceHistoryBatch(credentials, priceRows);
    return {
      success: true,
      message: `Successfully synced ${insertedCount} price records.`,
      synced: insertedCount,
      details: {
        tickersProcessed: tickersNeedingData.length,
        recordsFound: priceRows.length,
        recordsInserted: insertedCount,
        yahooTickers,
      },
    };
  },
});
