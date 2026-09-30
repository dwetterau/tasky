import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "./auth";
import { decryptApiKey } from "./apiKeys";
import { ApiKeyType } from "./schema";
import { collectPriceHistoryPoints } from "./lib/portfolioHistory";
import type { Id } from "./_generated/dataModel";

const POSITIONS_TABLE = "Positions";
const PRICE_HISTORY_TABLE = "Price History";
const ALPACA_BASE_URL = "https://data.alpaca.markets/v2";
const AIRTABLE_BATCH_SIZE = 10;
const AIRTABLE_THROTTLE_MS = 220;
const AIRTABLE_MAX_RETRIES = 3;
const PRICE_SYNC_LEASE_MS = 30 * 60_000;
let nextAirtableRequestAt = 0;

const portfolioCredentialTypes = {
  airtableApiKey: "portfolio_airtable_api_key",
  airtableBaseId: "portfolio_airtable_base_id",
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
};

export type PortfolioConfiguration = {
  id: Id<"portfolios"> | null;
  name: string;
  positionsViewId: string;
  startDate: string;
  isDefault: boolean;
  displayOrder: number;
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
  latestClose: number | null;
  previousClose: number | null;
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

function recentHistoryCutoff(days = 14): string {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff.toISOString().slice(0, 10);
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

export function calculateHolding(record: AirtableRecord) {
  const shares = asNumber(record.fields.Quantity);
  const ticker = asString(record.fields.Ticker).trim().toUpperCase();
  const currentValue = asNumber(record.fields.Value);
  const rawCostBasis = record.fields["Cost Basis"];
  const costBasis =
    !ticker &&
    (rawCostBasis === undefined ||
      rawCostBasis === null ||
      rawCostBasis === "")
      ? currentValue
      : asNumber(rawCostBasis);
  const currentPrice = currentPriceFromValueAndQuantity(
    record.fields.Value,
    shares,
  );
  const gainLoss = currentValue - costBasis;

  return {
    id: record.id,
    ticker,
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

type CalculatedHolding = ReturnType<typeof calculateHolding>;

export function aggregateHoldingsByTicker(
  holdings: CalculatedHolding[],
): CalculatedHolding[] {
  const aggregated = new Map<string, CalculatedHolding>();
  for (const holding of holdings) {
    const existing = aggregated.get(holding.ticker);
    if (!existing) {
      aggregated.set(holding.ticker, { ...holding });
      continue;
    }

    existing.shares += holding.shares;
    existing.costBasis += holding.costBasis;
    existing.currentValue += holding.currentValue;
    existing.companyName ||= holding.companyName;
    existing.createdAt =
      holding.createdAt < existing.createdAt
        ? holding.createdAt
        : existing.createdAt;
    if (holding.targetAllocation !== null) {
      existing.targetAllocation =
        (existing.targetAllocation ?? 0) + holding.targetAllocation;
    }
    existing.currentPrice =
      existing.shares === 0
        ? null
        : existing.currentValue / existing.shares;
    existing.gainLoss = existing.currentValue - existing.costBasis;
    existing.gainLossPercent =
      existing.costBasis > 0
        ? (existing.gainLoss / existing.costBasis) * 100
        : 0;
  }
  return [...aggregated.values()];
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

export function getQuarterHistoryStart(endDate: string): string {
  const date = new Date(`${endDate}T12:00:00.000Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 3);
  const lastDayOfMonth = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, lastDayOfMonth));
  return date.toISOString().slice(0, 10);
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

function subtractOneDay(dateStr: string): string {
  const date = new Date(`${dateStr}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function getMissingPriceDates(
  startDate: string,
  endDate: string,
  coverage?: { earliestDate: string; latestDate: string },
): string[] {
  if (!coverage) return getTradingDays(startDate, endDate);
  return [
    ...(startDate < coverage.earliestDate
      ? getTradingDays(startDate, subtractOneDay(coverage.earliestDate))
      : []),
    ...(coverage.latestDate < endDate
      ? getTradingDays(addOneDay(coverage.latestDate), endDate)
      : []),
  ];
}

function getAlpacaCredentials(): AlpacaCredentials | null {
  const apiKey = process.env.ALPACA_API_KEY?.trim();
  const secretKey = process.env.ALPACA_SECRET_KEY?.trim();
  if (!apiKey || !secretKey) {
    return null;
  }
  return { apiKey, secretKey };
}

async function airtableFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  for (let attempt = 0; attempt <= AIRTABLE_MAX_RETRIES; attempt += 1) {
    const now = Date.now();
    const requestAt = Math.max(now, nextAirtableRequestAt);
    nextAirtableRequestAt = requestAt + AIRTABLE_THROTTLE_MS;
    if (requestAt > now) {
      await new Promise((resolve) => setTimeout(resolve, requestAt - now));
    }

    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 429 || attempt === AIRTABLE_MAX_RETRIES) {
      return response;
    }

    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const retryDelay = Number.isFinite(retryAfterSeconds)
      ? Math.max(AIRTABLE_THROTTLE_MS, retryAfterSeconds * 1_000)
      : 1_000 * 2 ** attempt;
    nextAirtableRequestAt = Math.max(
      nextAirtableRequestAt,
      Date.now() + retryDelay,
    );
  }
  throw new Error("Airtable request retry loop exhausted");
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
    const response = await airtableFetch(url, {
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
    const response = await airtableFetch(url, {
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

  }

  return created;
}

async function updateAirtableRecords({
  apiKey,
  baseId,
  table,
  records,
}: {
  apiKey: string;
  baseId: string;
  table: string;
  records: Array<{ id: string; fields: Record<string, unknown> }>;
}): Promise<number> {
  let updated = 0;

  for (let i = 0; i < records.length; i += AIRTABLE_BATCH_SIZE) {
    const chunk = records.slice(i, i + AIRTABLE_BATCH_SIZE);
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
    const response = await airtableFetch(url, {
      method: "PATCH",
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
        `Airtable update request failed with ${response.status}`;
      throw new Error(message);
    }
    updated += chunk.length;

  }

  return updated;
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

type TickerSyncPlan = {
  ticker: string;
  representativePositionRecordId: string;
  representativeShares: number;
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

async function updatePositionValues(
  credentials: PortfolioCredentials,
  positions: Array<{
    positionRecordId: string;
    shares: number;
    closePrice: number;
  }>,
): Promise<number> {
  if (positions.length === 0) return 0;

  return await updateAirtableRecords({
    apiKey: credentials.apiKey,
    baseId: credentials.baseId,
    table: POSITIONS_TABLE,
    records: positions.map((position) => ({
      id: position.positionRecordId,
      fields: {
        Value: position.closePrice * position.shares,
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

function recentPriceStatus(
  latest: ReturnType<typeof mapPriceHistoryPoint> | null,
  previous: ReturnType<typeof mapPriceHistoryPoint> | null,
): RecentPriceStatus {
  return {
    latestPriceDate: latest?.date ?? null,
    previousPriceDate: previous?.date ?? null,
    latestClose: latest?.close ?? null,
    previousClose: previous?.close ?? null,
  };
}

async function getRecentPriceStatuses(
  credentials: PortfolioCredentials,
  tickers: string[],
): Promise<Array<{ ticker: string } & RecentPriceStatus>> {
  if (tickers.length === 0) return [];
  const params = new URLSearchParams();
  params.set(
    "filterByFormula",
    `AND({Date} >= '${recentHistoryCutoff()}', OR(${tickers
      .map(tickerHistoryNamePrefixFormula)
      .join(",")}))`,
  );
  params.set("sort[0][field]", "Date");
  params.set("sort[0][direction]", "desc");
  const records = await fetchAirtableRecords({
    apiKey: credentials.apiKey,
    baseId: credentials.baseId,
    table: PRICE_HISTORY_TABLE,
    params,
  });
  const tickerSet = new Set(tickers);
  const points = new Map<
    string,
    Array<ReturnType<typeof mapPriceHistoryPoint>>
  >();
  for (const record of records) {
    const point = mapPriceHistoryPoint(record);
    if (!point.date) continue;
    const name = asString(record.fields.Name);
    const ticker = name.slice(0, -(point.date.length + 1)).toUpperCase();
    if (
      !tickerSet.has(ticker) ||
      name.toUpperCase() !== `${ticker}-${point.date}`
    )
      continue;
    const tickerPoints = points.get(ticker) ?? [];
    if (
      tickerPoints.length < 2 &&
      !tickerPoints.some((existing) => existing.date === point.date)
    ) {
      tickerPoints.push(point);
      points.set(ticker, tickerPoints);
    }
  }
  return tickers.map((ticker) => {
    const tickerPoints = points.get(ticker) ?? [];
    return {
      ticker,
      ...recentPriceStatus(tickerPoints[0] ?? null, tickerPoints[1] ?? null),
    };
  });
}

type PriceCoverage = {
  earliestDate: string;
  latestDate: string;
  latestClose: number;
};

async function getPriceCoverages(
  credentials: PortfolioCredentials,
  tickers: string[],
  startDate: string,
): Promise<Map<string, PriceCoverage>> {
  if (tickers.length === 0) return new Map();
  const params = new URLSearchParams();
  params.set(
    "filterByFormula",
    `AND({Date} >= '${startDate}', OR(${tickers
      .map(tickerHistoryNamePrefixFormula)
      .join(",")}))`,
  );
  params.set("sort[0][field]", "Date");
  params.set("sort[0][direction]", "asc");
  const records = await fetchAirtableRecords({
    apiKey: credentials.apiKey,
    baseId: credentials.baseId,
    table: PRICE_HISTORY_TABLE,
    params,
  });
  const tickerSet = new Set(tickers);
  const coverages = new Map<string, PriceCoverage>();
  const points = collectPriceHistoryPoints(
    records.map((record) => ({
      name: asString(record.fields.Name),
      ...mapPriceHistoryPoint(record),
    })),
    startDate,
  );
  for (const point of points) {
    if (!tickerSet.has(point.ticker)) continue;
    const existing = coverages.get(point.ticker);
    if (!existing) {
      coverages.set(point.ticker, {
        earliestDate: point.date,
        latestDate: point.date,
        latestClose: point.close,
      });
      continue;
    }
    if (point.date < existing.earliestDate) {
      existing.earliestDate = point.date;
    }
    if (point.date >= existing.latestDate) {
      existing.latestDate = point.date;
      existing.latestClose = point.close;
    }
  }
  return coverages;
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

export async function getPortfolioConfigurations(
  ctx: ActionCtx,
  userId: string,
): Promise<PortfolioConfiguration[]> {
  const configured = await ctx.runQuery(
    internal.portfolios.listForUserInternal,
    { userId },
  );
  if (configured.length > 0) {
    return configured.map((portfolio) => ({
      id: portfolio._id,
      name: portfolio.name,
      positionsViewId: portfolio.airtableViewId,
      startDate: portfolio.startDate,
      isDefault: portfolio.isDefault,
      displayOrder: portfolio.displayOrder,
    }));
  }
  return [];
}

async function resolvePortfolioConfiguration(
  ctx: ActionCtx,
  userId: string,
  portfolioId?: Id<"portfolios">,
): Promise<PortfolioConfiguration | null> {
  const portfolios = await getPortfolioConfigurations(ctx, userId);
  if (portfolioId) {
    const selected = portfolios.find(
      (portfolio) => portfolio.id === portfolioId,
    );
    if (!selected) throw new Error("Portfolio not found or access denied");
    return selected;
  }
  return (
    portfolios.find((portfolio) => portfolio.isDefault) ??
    portfolios[0] ??
    null
  );
}

export const getSyncStateInternal = internalQuery({
  args: { userId: v.string() },
  returns: v.union(v.object({ lastSyncedAt: v.number() }), v.null()),
  handler: async (ctx, { userId }) => {
    const row = await ctx.db
      .query("portfolioSyncStates")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return row ? { lastSyncedAt: row.lastSyncedAt } : null;
  },
});

export const recordSyncInternal = internalMutation({
  args: { userId: v.string(), lastSyncedAt: v.number() },
  returns: v.number(),
  handler: async (ctx, { userId, lastSyncedAt }) => {
    const row = await ctx.db
      .query("portfolioSyncStates")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (row) {
      await ctx.db.patch(row._id, { lastSyncedAt });
    } else {
      await ctx.db.insert("portfolioSyncStates", { userId, lastSyncedAt });
    }
    return lastSyncedAt;
  },
});

export const acquireSyncLeaseInternal = internalMutation({
  args: {
    userId: v.string(),
    leaseId: v.string(),
    startedAt: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, { userId, leaseId, startedAt }) => {
    const row = await ctx.db
      .query("portfolioSyncStates")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (
      row?.syncStartedAt !== undefined &&
      startedAt - row.syncStartedAt < PRICE_SYNC_LEASE_MS
    ) {
      return false;
    }
    if (row) {
      await ctx.db.patch(row._id, { syncLeaseId: leaseId, syncStartedAt: startedAt });
    } else {
      await ctx.db.insert("portfolioSyncStates", {
        userId,
        lastSyncedAt: 0,
        syncLeaseId: leaseId,
        syncStartedAt: startedAt,
      });
    }
    return true;
  },
});

export const releaseSyncLeaseInternal = internalMutation({
  args: { userId: v.string(), leaseId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, leaseId }) => {
    const row = await ctx.db
      .query("portfolioSyncStates")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (row?.syncLeaseId === leaseId) {
      await ctx.db.patch(row._id, {
        syncLeaseId: undefined,
        syncStartedAt: undefined,
      });
    }
    return null;
  },
});

export const getSnapshot = action({
  args: {
    includePriceStatus: v.optional(v.boolean()),
    portfolioId: v.optional(v.id("portfolios")),
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

    const portfolio = await resolvePortfolioConfiguration(
      ctx,
      userId,
      args.portfolioId,
    );
    return await readPortfolioSnapshot(
      ctx,
      userId,
      args.includePriceStatus ?? true,
      portfolio,
    );
  },
});

/** Shared read-only snapshot; background exports pass the enrolled user explicitly. */
export async function readPortfolioSnapshot(
  ctx: ActionCtx,
  userId: string,
  includePriceStatus: boolean | "recent" = false,
  selectedPortfolio?: PortfolioConfiguration | null,
) {
  const [apiKey, baseId, portfolio] = await Promise.all([
    getCredential(ctx, userId, portfolioCredentialTypes.airtableApiKey),
    getCredential(ctx, userId, portfolioCredentialTypes.airtableBaseId),
    selectedPortfolio === undefined
      ? resolvePortfolioConfiguration(ctx, userId)
      : selectedPortfolio,
  ]);

  if (!apiKey || !baseId || !portfolio) {
    return {
      status: "no_credentials" as const,
      message:
        "Add the Portfolio Airtable API Key and Base ID, then configure a portfolio in Tasky settings.",
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

  const credentials = { apiKey, baseId };
  try {
    const params = new URLSearchParams();
    params.set("view", portfolio.positionsViewId);
    params.set("sort[0][field]", "Ticker");
    params.set("sort[0][direction]", "asc");
    const records = await fetchAirtableRecords({
      apiKey,
      baseId,
      table: POSITIONS_TABLE,
      params,
    });

    const holdings = aggregateHoldingsByTicker(records.map(calculateHolding));

    const recentPriceStatuses = includePriceStatus
      ? await getRecentPriceStatuses(
          credentials,
          holdings.map((holding) => holding.ticker).filter(Boolean),
        )
      : [];
    const recentPriceStatusByTicker = new Map(
      recentPriceStatuses.map((entry) => [entry.ticker, entry]),
    );
    const holdingsWithPriceStatus = holdings.map((holding) => {
      const priceStatus = recentPriceStatusByTicker.get(holding.ticker);
      const currentPrice =
        includePriceStatus && priceStatus?.latestClose != null
          ? priceStatus.latestClose
          : holding.currentPrice;
      const currentValue =
        currentPrice === null
          ? holding.currentValue
          : currentPrice * holding.shares;
      const gainLoss = currentValue - holding.costBasis;
      const previousValue =
        priceStatus?.previousClose == null
          ? null
          : priceStatus.previousClose * holding.shares;
      const dayReturn =
        includePriceStatus && previousValue !== null
          ? currentValue - previousValue
          : null;
      return {
        ...holding,
        currentPrice,
        currentValue,
        gainLoss,
        gainLossPercent:
          holding.costBasis > 0 ? (gainLoss / holding.costBasis) * 100 : 0,
        latestPriceDate: includePriceStatus
          ? (priceStatus?.latestPriceDate ?? null)
          : null,
        previousPriceDate: includePriceStatus
          ? (priceStatus?.previousPriceDate ?? null)
          : null,
        dayReturn,
        dayReturnPercent:
          dayReturn !== null && previousValue !== null && previousValue > 0
            ? (dayReturn / previousValue) * 100
            : null,
      };
    });
    const totalCost = holdingsWithPriceStatus.reduce(
      (sum, holding) => sum + holding.costBasis,
      0,
    );
    const totalCurrentValue = holdingsWithPriceStatus.reduce(
      (sum, holding) => sum + holding.currentValue,
      0,
    );
    const gainLoss = totalCurrentValue - totalCost;
    const allLatestDates = recentPriceStatuses
      .map((entry) => entry.latestPriceDate)
      .filter((date): date is string => Boolean(date));
    const holdingsWithDayReturn = holdingsWithPriceStatus.filter(
      (
        holding,
      ): holding is typeof holding & {
        dayReturn: number;
      } => holding.dayReturn !== null,
    );
    const latestDayReturnDates = holdingsWithDayReturn
      .map((holding) => holding.latestPriceDate)
      .filter((date): date is string => Boolean(date));
    const dayReturn = holdingsWithDayReturn.reduce(
      (sum, holding) => sum + holding.dayReturn,
      0,
    );
    const totalPreviousHistoryValue = totalCurrentValue - dayReturn;
    const hasDayReturn =
      holdingsWithDayReturn.length > 0 && totalPreviousHistoryValue > 0;

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
          ? (dayReturn / totalPreviousHistoryValue) * 100
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
}

const priceHistoryPointValidator = v.object({
  ticker: v.string(),
  date: v.string(),
  close: v.number(),
  quantity: v.number(),
});

const emptyPriceHistory = (
  status: "no_credentials" | "airtable_error",
  message: string,
  startDate: string | null = null,
) => ({
  status,
  message,
  startDate,
  points: [],
});

export const getPriceHistory = action({
  args: {
    startDate: v.optional(v.string()),
    portfolioId: v.optional(v.id("portfolios")),
  },
  returns: v.object({
    status: v.union(
      v.literal("ok"),
      v.literal("no_credentials"),
      v.literal("airtable_error"),
    ),
    message: v.optional(v.string()),
    startDate: v.union(v.string(), v.null()),
    points: v.array(priceHistoryPointValidator),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const [apiKey, baseId, portfolio] = await Promise.all([
      getCredential(ctx, userId, portfolioCredentialTypes.airtableApiKey),
      getCredential(ctx, userId, portfolioCredentialTypes.airtableBaseId),
      resolvePortfolioConfiguration(ctx, userId, args.portfolioId),
    ]);

    if (!apiKey || !baseId || !portfolio) {
      return emptyPriceHistory(
        "no_credentials",
        "Add the Portfolio Airtable API Key and Base ID, then configure a portfolio in Tasky settings.",
      );
    }

    const historyWindowStart = getQuarterHistoryStart(getTodayDate());
    const configuredStart =
      portfolio.startDate < historyWindowStart
        ? historyWindowStart
        : portfolio.startDate;
    const requestedStart =
      args.startDate && isValidIsoDate(args.startDate)
        ? args.startDate
        : configuredStart;
    const startDate =
      requestedStart < configuredStart
        ? configuredStart
        : requestedStart;

    try {
      const positionParams = new URLSearchParams();
      positionParams.set("view", portfolio.positionsViewId);
      const positionRecords = await fetchAirtableRecords({
        apiKey,
        baseId,
        table: POSITIONS_TABLE,
        params: positionParams,
      });
      const tickers = new Set(
        positionRecords
          .map((record) => asString(record.fields.Ticker).toUpperCase())
          .filter(Boolean),
      );
      if (tickers.size === 0) {
        return {
          status: "ok" as const,
          startDate,
          points: [],
        };
      }
      const params = new URLSearchParams();
      const tickerFormula = `OR(${[...tickers]
        .map(tickerHistoryNamePrefixFormula)
        .join(",")})`;
      params.set(
        "filterByFormula",
        `AND({Date} >= '${startDate}', ${tickerFormula})`,
      );
      params.set("sort[0][field]", "Date");
      params.set("sort[0][direction]", "asc");

      const records = await fetchAirtableRecords({
        apiKey,
        baseId,
        table: PRICE_HISTORY_TABLE,
        params,
      });
      const collected = collectPriceHistoryPoints(
        records.map((record) => ({
          name: asString(record.fields.Name),
          ...mapPriceHistoryPoint(record),
        })),
        startDate,
      );
      const pointsByTickerDate = new Map<
        string,
        (typeof collected)[number]
      >();
      for (const point of collected) {
        if (!tickers.has(point.ticker)) continue;
        pointsByTickerDate.set(`${point.ticker}:${point.date}`, {
          ...point,
          // Prices are shared across accounts. The chart applies the shares
          // from the selected portfolio instead of another account's quantity.
          quantity: 0,
        });
      }

      return {
        status: "ok" as const,
        startDate,
        points: [...pointsByTickerDate.values()],
      };
    } catch (error) {
      return emptyPriceHistory(
        "airtable_error",
        error instanceof Error
          ? error.message
          : "Failed to fetch price history.",
        startDate,
      );
    }
  },
});

const priceSyncResult = v.object({
  success: v.boolean(),
  message: v.string(),
  synced: v.number(),
  details: v.object({
    tickersProcessed: v.number(),
    recordsFound: v.number(),
    recordsInserted: v.number(),
    positionsUpdated: v.number(),
    yahooTickers: v.array(v.string()),
  }),
});

async function performPriceHistorySync(ctx: ActionCtx, userId: string) {
    const [apiKey, baseId, portfolios] = await Promise.all([
      getCredential(ctx, userId, portfolioCredentialTypes.airtableApiKey),
      getCredential(ctx, userId, portfolioCredentialTypes.airtableBaseId),
      getPortfolioConfigurations(ctx, userId),
    ]);
    if (!apiKey || !baseId || portfolios.length === 0) {
      return {
        success: false,
        message:
          "Add the Portfolio Airtable API Key and Base ID, then configure at least one portfolio in Tasky settings.",
        synced: 0,
        details: {
          tickersProcessed: 0,
          recordsFound: 0,
          recordsInserted: 0,
          positionsUpdated: 0,
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
          positionsUpdated: 0,
          yahooTickers: [],
        },
      };
    }

    const credentials = { apiKey, baseId };
    const portfolioRecords: Array<{
      portfolio: PortfolioConfiguration;
      records: AirtableRecord[];
    }> = [];
    for (const [index, portfolio] of portfolios.entries()) {
      const params = new URLSearchParams();
      params.set("view", portfolio.positionsViewId);
      params.set("sort[0][field]", "Ticker");
      params.set("sort[0][direction]", "asc");
      portfolioRecords.push({
        portfolio,
        records: await fetchAirtableRecords({
          apiKey,
          baseId,
          table: POSITIONS_TABLE,
          params,
        }),
      });
      if (index < portfolios.length - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, AIRTABLE_THROTTLE_MS),
        );
      }
    }
    const endDate = getTodayDate();
    const historyWindowStart = getQuarterHistoryStart(endDate);
    const holdingsById = new Map<
      string,
      ReturnType<typeof calculateHolding> & { startDate: string }
    >();
    for (const { portfolio, records } of portfolioRecords) {
      const portfolioStartDate =
        portfolio.startDate < historyWindowStart
          ? historyWindowStart
          : portfolio.startDate;
      for (const record of records) {
        const holding = calculateHolding(record);
        if (!holding.ticker) continue;
        const existing = holdingsById.get(holding.id);
        holdingsById.set(holding.id, {
          ...holding,
          startDate:
            existing && existing.startDate < portfolioStartDate
              ? existing.startDate
              : portfolioStartDate,
        });
      }
    }
    const holdings = [...holdingsById.values()];
    if (holdings.length === 0) {
      return {
        success: true,
        message: `No holdings found across ${portfolios.length} portfolios.`,
        synced: 0,
        details: {
          tickersProcessed: 0,
          recordsFound: 0,
          recordsInserted: 0,
          positionsUpdated: 0,
          yahooTickers: [],
        },
      };
    }

    const holdingsByTicker = new Map<string, typeof holdings>();
    for (const holding of holdings) {
      const tickerHoldings = holdingsByTicker.get(holding.ticker) ?? [];
      tickerHoldings.push(holding);
      holdingsByTicker.set(holding.ticker, tickerHoldings);
    }
    const allTickers = [...holdingsByTicker.keys()];
    const earliestConfiguredStart = holdings.reduce(
      (earliest, holding) =>
        holding.startDate < earliest ? holding.startDate : earliest,
      holdings[0]!.startDate,
    );
    const priceCoverages = await getPriceCoverages(
      credentials,
      allTickers,
      earliestConfiguredStart,
    );
    const latestPriceByTicker = new Map<
      string,
      { date: string; close: number }
    >(
      [...priceCoverages].map(([ticker, coverage]) => [
        ticker,
        { date: coverage.latestDate, close: coverage.latestClose },
      ]),
    );
    const tickersToSync: TickerSyncPlan[] = [];

    for (const [ticker, tickerHoldings] of holdingsByTicker) {
      const startDate = tickerHoldings.reduce(
        (earliest, holding) =>
          holding.startDate < earliest ? holding.startDate : earliest,
        tickerHoldings[0]!.startDate,
      );
      const coverage = priceCoverages.get(ticker);
      const missingDates = getMissingPriceDates(
        startDate,
        endDate,
        coverage,
      );
      if (missingDates.length > 0) {
        const representative = tickerHoldings[0]!;
        tickersToSync.push({
          ticker,
          representativePositionRecordId: representative.id,
          representativeShares: representative.shares,
          missingDates,
        });
      }
    }

    if (tickersToSync.length === 0) {
      const positionsUpdated = await updatePositionValues(
        credentials,
        holdings.flatMap((holding) => {
          const latest = latestPriceByTicker.get(holding.ticker);
          return latest
            ? [
                {
                  positionRecordId: holding.id,
                  shares: holding.shares,
                  closePrice: latest.close,
                },
              ]
            : [];
        }),
      );
      return {
        success: true,
        message: `Price history is up to date across ${portfolios.length} portfolios. Refreshed ${positionsUpdated} position values.`,
        synced: 0,
        details: {
          tickersProcessed: 0,
          recordsFound: 0,
          recordsInserted: 0,
          positionsUpdated,
          yahooTickers: [],
        },
      };
    }

    const tickersNeedingData = tickersToSync.map((plan) => plan.ticker);
    const earliestMissing = tickersToSync
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
    for (const plan of tickersToSync) {
      const tickerBars = bars[plan.ticker] ?? [];
      const missingDates = new Set(plan.missingDates);
      for (const bar of tickerBars) {
        const date = datePart(bar.t);
        if (missingDates.has(date)) {
          priceRows.push({
            ticker: plan.ticker,
            positionRecordId: plan.representativePositionRecordId,
            date,
            closePrice: bar.c,
            quantity: plan.representativeShares,
          });
        }
      }
      const latestFetchedBar = tickerBars.reduce<AlpacaBar | null>(
        (latest, bar) =>
          !latest || datePart(bar.t) > datePart(latest.t) ? bar : latest,
        null,
      );
      const latestStored = latestPriceByTicker.get(plan.ticker);
      if (
        latestFetchedBar &&
        (!latestStored || datePart(latestFetchedBar.t) >= latestStored.date)
      ) {
        latestPriceByTicker.set(plan.ticker, {
          date: datePart(latestFetchedBar.t),
          close: latestFetchedBar.c,
        });
      }
    }

    const insertedCount = await insertPriceHistoryBatch(credentials, priceRows);
    const positionsUpdated = await updatePositionValues(
      credentials,
      holdings.flatMap((holding) => {
        const latest = latestPriceByTicker.get(holding.ticker);
        return latest
          ? [
              {
                positionRecordId: holding.id,
                shares: holding.shares,
                closePrice: latest.close,
              },
            ]
          : [];
      }),
    );
    return {
      success: true,
      message: `Synced ${insertedCount} shared price records across ${portfolios.length} portfolios and refreshed ${positionsUpdated} position values.`,
      synced: insertedCount,
      details: {
        tickersProcessed: tickersNeedingData.length,
        recordsFound: priceRows.length,
        recordsInserted: insertedCount,
        positionsUpdated,
        yahooTickers,
      },
    };
}

/** Same Airtable/Alpaca sync the app runs. Caller supplies an already-authorized user id. */
export async function syncPriceHistoryForUser(ctx: ActionCtx, userId: string) {
  const leaseId = crypto.randomUUID();
  const startedAt = Date.now();
  const acquired = await ctx.runMutation(
    internal.portfolio.acquireSyncLeaseInternal,
    { userId, leaseId, startedAt },
  );
  if (!acquired) {
    return {
      success: false,
      message: "A portfolio price sync is already running.",
      synced: 0,
      details: {
        tickersProcessed: 0,
        recordsFound: 0,
        recordsInserted: 0,
        positionsUpdated: 0,
        yahooTickers: [],
      },
    };
  }
  try {
    const result = await performPriceHistorySync(ctx, userId);
    if (result.success) {
      await ctx.runMutation(internal.portfolio.recordSyncInternal, {
        userId,
        lastSyncedAt: Date.now(),
      });
    }
    return result;
  } finally {
    await ctx.runMutation(internal.portfolio.releaseSyncLeaseInternal, {
      userId,
      leaseId,
    });
  }
}

export const syncPriceHistory = action({
  args: {},
  returns: priceSyncResult,
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    return await syncPriceHistoryForUser(ctx, userId);
  },
});
