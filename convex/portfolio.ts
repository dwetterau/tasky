import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "./auth";
import { decryptApiKey } from "./apiKeys";
import { ApiKeyType } from "./schema";
import {
  ACCOUNT_SNAPSHOT_SCHEMA_VERSION,
  buildCompleteAccountSnapshotDays,
  buildPortfolioSnapshotHistory,
  createAccountSnapshotPayload,
  parseAccountSnapshotPayload,
  type AccountSnapshotPayload,
  type AccountSnapshotPosition,
} from "./lib/accountSnapshots";
import type { Id } from "./_generated/dataModel";

const POSITIONS_TABLE = "Positions";
const INVESTMENT_ACCOUNTS_TABLE = "Investment Accounts";
const ACCOUNT_SNAPSHOTS_TABLE = "Account Snapshots";
const ALPACA_BASE_URL = "https://data.alpaca.markets/v2";
const AIRTABLE_BATCH_SIZE = 10;
const AIRTABLE_THROTTLE_MS = 220;
const AIRTABLE_MAX_RETRIES = 3;
const PRICE_SYNC_LEASE_MS = 30 * 60_000;
const getTimezoneInternal = makeFunctionReference<
  "query",
  { userId: string },
  string
>("users:getTimezoneInternal");
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

function asNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function linkedRecordIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function datePart(value: string): string {
  return value.split("T")[0] ?? value;
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
    (rawCostBasis === undefined || rawCostBasis === null || rawCostBasis === "")
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
      existing.shares === 0 ? null : existing.currentValue / existing.shares;
    existing.gainLoss = existing.currentValue - existing.costBasis;
    existing.gainLossPercent =
      existing.costBasis > 0
        ? (existing.gainLoss / existing.costBasis) * 100
        : 0;
  }
  return [...aggregated.values()];
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function getTodayDate(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
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

export function supportsMarketPriceLookup(ticker: string): boolean {
  return /^[A-Z][A-Z0-9.-]*$/.test(ticker);
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

function subtractDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function fetchLatestPrices(
  tickers: string[],
  endDate: string,
  credentials: AlpacaCredentials,
): Promise<{
  prices: Map<
    string,
    {
      date: string;
      close: number;
      previousDate: string | null;
      previousClose: number | null;
    }
  >;
  yahooTickers: string[];
}> {
  if (tickers.length === 0) {
    return { prices: new Map(), yahooTickers: [] };
  }
  const marketTickers = tickers.filter(supportsMarketPriceLookup);
  if (marketTickers.length === 0) {
    return { prices: new Map(), yahooTickers: [] };
  }
  const startDate = subtractDays(endDate, 10);
  const bars = await fetchBarsFromAlpaca(
    marketTickers,
    startDate,
    endDate,
    credentials,
  );
  const yahooTickers: string[] = [];
  for (const ticker of marketTickers) {
    if ((bars[ticker] ?? []).length > 0) continue;
    const yahooBars = await fetchBarsFromYahoo(ticker, startDate, endDate);
    if (yahooBars.length > 0) {
      bars[ticker] = yahooBars;
      yahooTickers.push(ticker);
    }
  }
  const prices = new Map<
    string,
    {
      date: string;
      close: number;
      previousDate: string | null;
      previousClose: number | null;
    }
  >();
  for (const ticker of tickers) {
    const sortedBars = [...(bars[ticker] ?? [])].sort((a, b) =>
      datePart(a.t).localeCompare(datePart(b.t)),
    );
    const latest = sortedBars[sortedBars.length - 1];
    const previous = sortedBars[sortedBars.length - 2];
    if (latest) {
      prices.set(ticker, {
        date: datePart(latest.t),
        close: latest.c,
        previousDate: previous ? datePart(previous.t) : null,
        previousClose: previous?.c ?? null,
      });
    }
  }
  return { prices, yahooTickers };
}

async function getInvestmentAccountNames(
  credentials: PortfolioCredentials,
  accountRecordIds: Set<string>,
): Promise<Map<string, string>> {
  if (accountRecordIds.size === 0) return new Map();
  const records = await fetchAirtableRecords({
    apiKey: credentials.apiKey,
    baseId: credentials.baseId,
    table: INVESTMENT_ACCOUNTS_TABLE,
    params: new URLSearchParams(),
  });
  return new Map(
    records
      .filter((record) => accountRecordIds.has(record.id))
      .map((record) => [
        record.id,
        asString(record.fields.Name).trim() || record.id,
      ]),
  );
}

function snapshotFields(
  payload: ReturnType<typeof createAccountSnapshotPayload>,
): Record<string, unknown> {
  return {
    Name: `${payload.accountRecordId}:${payload.date}`,
    Account: [payload.accountRecordId],
    Date: payload.date,
    "Snapshot JSON": JSON.stringify(payload),
    "Total Value": payload.totalValue,
    "Total Cost Basis": payload.totalCostBasis,
    "Position Count": payload.positions.length,
    "Schema Version": ACCOUNT_SNAPSHOT_SCHEMA_VERSION,
  };
}

async function upsertAccountSnapshots(
  credentials: PortfolioCredentials,
  payloads: ReturnType<typeof createAccountSnapshotPayload>[],
): Promise<{ created: number; updated: number }> {
  if (payloads.length === 0) return { created: 0, updated: 0 };
  const date = payloads[0]!.date;
  const params = new URLSearchParams();
  params.set("filterByFormula", `{Date} = '${date}'`);
  const existing = await fetchAirtableRecords({
    apiKey: credentials.apiKey,
    baseId: credentials.baseId,
    table: ACCOUNT_SNAPSHOTS_TABLE,
    params,
  });
  const existingByName = new Map(
    existing.map((record) => [asString(record.fields.Name), record.id]),
  );
  const creates: Array<{ fields: Record<string, unknown> }> = [];
  const updates: Array<{
    id: string;
    fields: Record<string, unknown>;
  }> = [];
  for (const payload of payloads) {
    const name = `${payload.accountRecordId}:${payload.date}`;
    const fields = snapshotFields(payload);
    const recordId = existingByName.get(name);
    if (recordId) {
      updates.push({ id: recordId, fields });
    } else {
      creates.push({ fields });
    }
  }
  const created = await createAirtableRecords({
    apiKey: credentials.apiKey,
    baseId: credentials.baseId,
    table: ACCOUNT_SNAPSHOTS_TABLE,
    records: creates,
  });
  const updated = await updateAirtableRecords({
    apiKey: credentials.apiKey,
    baseId: credentials.baseId,
    table: ACCOUNT_SNAPSHOTS_TABLE,
    records: updates,
  });
  return { created, updated };
}

async function fetchAccountSnapshotPayloads(
  credentials: PortfolioCredentials,
  startDate: string,
): Promise<{ recordCount: number; snapshots: AccountSnapshotPayload[] }> {
  const params = new URLSearchParams();
  params.set("filterByFormula", `{Date} >= '${startDate}'`);
  params.set("sort[0][field]", "Date");
  params.set("sort[0][direction]", "asc");
  const records = await fetchAirtableRecords({
    apiKey: credentials.apiKey,
    baseId: credentials.baseId,
    table: ACCOUNT_SNAPSHOTS_TABLE,
    params,
  });
  const snapshots = records.flatMap((record) => {
    const serialized = record.fields["Snapshot JSON"];
    if (typeof serialized !== "string") return [];
    try {
      const parsed = parseAccountSnapshotPayload(JSON.parse(serialized));
      return parsed ? [parsed] : [];
    } catch {
      return [];
    }
  });
  return { recordCount: records.length, snapshots };
}

async function fetchPortfolioPositionRecords(
  credentials: PortfolioCredentials,
  portfolios: PortfolioConfiguration[],
): Promise<AirtableRecord[]> {
  const recordsById = new Map<string, AirtableRecord>();
  for (const [index, portfolio] of portfolios.entries()) {
    const params = new URLSearchParams();
    params.set("view", portfolio.positionsViewId);
    params.set("sort[0][field]", "Ticker");
    params.set("sort[0][direction]", "asc");
    const records = await fetchAirtableRecords({
      apiKey: credentials.apiKey,
      baseId: credentials.baseId,
      table: POSITIONS_TABLE,
      params,
    });
    for (const record of records) {
      recordsById.set(record.id, record);
    }
    if (index < portfolios.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, AIRTABLE_THROTTLE_MS));
    }
  }
  return [...recordsById.values()];
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
    portfolios.find((portfolio) => portfolio.isDefault) ?? portfolios[0] ?? null
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
      await ctx.db.patch(row._id, {
        syncLeaseId: leaseId,
        syncStartedAt: startedAt,
      });
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
    allPortfolios: v.optional(v.boolean()),
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

    const portfolio = args.allPortfolios
      ? await getPortfolioConfigurations(ctx, userId)
      : await resolvePortfolioConfiguration(ctx, userId, args.portfolioId);
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
  _includePriceStatus: boolean | "recent" = false,
  selectedPortfolio?: PortfolioConfiguration | PortfolioConfiguration[] | null,
) {
  const [apiKey, baseId, portfolioSelection, timezone] = await Promise.all([
    getCredential(ctx, userId, portfolioCredentialTypes.airtableApiKey),
    getCredential(ctx, userId, portfolioCredentialTypes.airtableBaseId),
    selectedPortfolio === undefined
      ? resolvePortfolioConfiguration(ctx, userId)
      : selectedPortfolio,
    ctx.runQuery(getTimezoneInternal, { userId }),
  ]);
  const portfolios = Array.isArray(portfolioSelection)
    ? portfolioSelection
    : portfolioSelection
      ? [portfolioSelection]
      : [];

  if (!apiKey || !baseId || portfolios.length === 0) {
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

  try {
    const records = await fetchPortfolioPositionRecords(
      { apiKey, baseId },
      portfolios,
    );

    const accountRecordIds = new Set(
      records.flatMap((record) => linkedRecordIds(record.fields.Account)),
    );
    let latestSnapshotDate: string | null = null;
    let previousSnapshotDate: string | null = null;
    let previousPortfolioValue: number | null = null;
    const previousValuesByTicker = new Map<string, number>();
    if (_includePriceStatus && accountRecordIds.size > 0) {
      try {
        const { snapshots } = await fetchAccountSnapshotPayloads(
          { apiKey, baseId },
          subtractDays(getTodayDate(timezone), 14),
        );
        const completeDays = buildCompleteAccountSnapshotDays(
          snapshots,
          accountRecordIds,
        );
        const latestDay = completeDays[completeDays.length - 1];
        const previousDay = completeDays[completeDays.length - 2];
        latestSnapshotDate = latestDay?.date ?? null;
        previousSnapshotDate = previousDay?.date ?? null;
        const latestPositions =
          latestDay?.snapshots.flatMap((snapshot) => snapshot.positions) ?? [];
        const hasStoredMarketBaseline =
          latestPositions.length > 0 &&
          latestPositions.every(
            (position) => position.previousValue !== undefined,
          );
        if (hasStoredMarketBaseline) {
          const marketDates = latestPositions.flatMap((position) =>
            position.marketDate ? [position.marketDate] : [],
          );
          const previousMarketDates = latestPositions.flatMap((position) =>
            position.previousMarketDate ? [position.previousMarketDate] : [],
          );
          latestSnapshotDate = marketDates.sort().at(-1) ?? latestSnapshotDate;
          previousSnapshotDate =
            previousMarketDates.sort().at(-1) ?? previousSnapshotDate;
          previousPortfolioValue = latestPositions.reduce(
            (sum, position) => sum + position.previousValue!,
            0,
          );
          for (const position of latestPositions) {
            const ticker = position.ticker.trim().toUpperCase();
            previousValuesByTicker.set(
              ticker,
              (previousValuesByTicker.get(ticker) ?? 0) +
                position.previousValue!,
            );
          }
        } else if (previousDay) {
          previousPortfolioValue = previousDay.snapshots.reduce(
            (sum, snapshot) => sum + snapshot.totalValue,
            0,
          );
          for (const snapshot of previousDay.snapshots) {
            for (const position of snapshot.positions) {
              const ticker = position.ticker.trim().toUpperCase();
              previousValuesByTicker.set(
                ticker,
                (previousValuesByTicker.get(ticker) ?? 0) + position.value,
              );
            }
          }
        }
      } catch (error) {
        console.warn("Unable to load recent account snapshots:", error);
      }
    }

    const holdings = aggregateHoldingsByTicker(records.map(calculateHolding));
    const holdingsWithPriceStatus = holdings.map((holding) => {
      const currentPrice = holding.currentPrice;
      const currentValue = holding.currentValue;
      const gainLoss = currentValue - holding.costBasis;
      const previousValue =
        previousPortfolioValue === null
          ? null
          : (previousValuesByTicker.get(holding.ticker) ?? 0);
      const dayReturn =
        previousValue === null ? null : currentValue - previousValue;
      return {
        ...holding,
        currentPrice,
        currentValue,
        gainLoss,
        gainLossPercent:
          holding.costBasis > 0 ? (gainLoss / holding.costBasis) * 100 : 0,
        latestPriceDate: latestSnapshotDate,
        previousPriceDate: previousSnapshotDate,
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
    const dayReturn =
      previousPortfolioValue === null
        ? null
        : totalCurrentValue - previousPortfolioValue;
    const visibleHoldings = holdingsWithPriceStatus.filter(
      (holding) => holding.currentValue !== 0,
    );

    return {
      status: "ok" as const,
      holdings: visibleHoldings,
      summary: {
        totalCost,
        totalCurrentValue,
        gainLoss,
        gainLossPercent: totalCost > 0 ? (gainLoss / totalCost) * 100 : 0,
        holdingsCount: visibleHoldings.length,
        latestPriceDate: latestSnapshotDate,
        dayReturnDate: latestSnapshotDate,
        dayReturn,
        dayReturnPercent:
          dayReturn !== null &&
          previousPortfolioValue !== null &&
          previousPortfolioValue > 0
            ? (dayReturn / previousPortfolioValue) * 100
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

const snapshotHistoryPointValidator = v.object({
  date: v.string(),
  totalValue: v.number(),
  totalCostBasis: v.number(),
  accounts: v.array(
    v.object({
      accountRecordId: v.string(),
      accountName: v.string(),
      value: v.number(),
      costBasis: v.number(),
    }),
  ),
  holdings: v.array(
    v.object({
      ticker: v.string(),
      name: v.string(),
      value: v.number(),
      costBasis: v.number(),
    }),
  ),
});

const emptySnapshotHistory = (
  status: "no_credentials" | "airtable_error",
  message: string,
  startDate: string | null = null,
) => ({
  status,
  message,
  startDate,
  points: [],
});

export const getSnapshotHistory = action({
  args: {
    startDate: v.optional(v.string()),
    portfolioId: v.optional(v.id("portfolios")),
    allPortfolios: v.optional(v.boolean()),
  },
  returns: v.object({
    status: v.union(
      v.literal("ok"),
      v.literal("no_credentials"),
      v.literal("airtable_error"),
    ),
    message: v.optional(v.string()),
    startDate: v.union(v.string(), v.null()),
    points: v.array(snapshotHistoryPointValidator),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const [apiKey, baseId, portfolioSelection] = await Promise.all([
      getCredential(ctx, userId, portfolioCredentialTypes.airtableApiKey),
      getCredential(ctx, userId, portfolioCredentialTypes.airtableBaseId),
      args.allPortfolios
        ? getPortfolioConfigurations(ctx, userId)
        : resolvePortfolioConfiguration(ctx, userId, args.portfolioId),
    ]);
    const portfolios = Array.isArray(portfolioSelection)
      ? portfolioSelection
      : portfolioSelection
        ? [portfolioSelection]
        : [];

    if (!apiKey || !baseId || portfolios.length === 0) {
      return emptySnapshotHistory(
        "no_credentials",
        "Add the Portfolio Airtable API Key and Base ID, then configure a portfolio in Tasky settings.",
      );
    }

    const configuredStartDate = portfolios.reduce(
      (earliest, portfolio) =>
        portfolio.startDate < earliest ? portfolio.startDate : earliest,
      portfolios[0]!.startDate,
    );
    const requestedStart =
      args.startDate && isValidIsoDate(args.startDate)
        ? args.startDate
        : configuredStartDate;
    const startDate =
      requestedStart < configuredStartDate
        ? configuredStartDate
        : requestedStart;

    try {
      const positionRecords = await fetchPortfolioPositionRecords(
        { apiKey, baseId },
        portfolios,
      );
      const accountRecordIds = new Set(
        positionRecords.flatMap((record) =>
          linkedRecordIds(record.fields.Account),
        ),
      );
      if (accountRecordIds.size === 0) {
        return {
          status: "ok" as const,
          startDate,
          points: [],
        };
      }
      const { recordCount, snapshots } = await fetchAccountSnapshotPayloads(
        { apiKey, baseId },
        startDate,
      );
      const points = buildPortfolioSnapshotHistory(snapshots, accountRecordIds);

      if (recordCount > 0 && snapshots.length === 0) {
        return emptySnapshotHistory(
          "airtable_error",
          "Account snapshot rows contain invalid JSON.",
          startDate,
        );
      }

      return {
        status: "ok" as const,
        startDate,
        points,
      };
    } catch (error) {
      return emptySnapshotHistory(
        "airtable_error",
        error instanceof Error
          ? error.message
          : "Failed to fetch account snapshot history.",
        startDate,
      );
    }
  },
});

const portfolioSyncResult = v.object({
  success: v.boolean(),
  message: v.string(),
  synced: v.number(),
  details: v.object({
    tickersProcessed: v.number(),
    accountsProcessed: v.number(),
    snapshotsCreated: v.number(),
    snapshotsUpdated: v.number(),
    positionsUpdated: v.number(),
    unassignedPositions: v.number(),
    yahooTickers: v.array(v.string()),
  }),
});

function emptySyncDetails() {
  return {
    tickersProcessed: 0,
    accountsProcessed: 0,
    snapshotsCreated: 0,
    snapshotsUpdated: 0,
    positionsUpdated: 0,
    unassignedPositions: 0,
    yahooTickers: [] as string[],
  };
}

async function runPortfolioSyncStage<T>(
  stage: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "portfolio_sync_stage_failed",
        stage,
        error:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Unknown error",
      }),
    );
    throw error;
  }
}

async function performPortfolioSnapshotSync(
  ctx: ActionCtx,
  userId: string,
  snapshotDate?: string,
) {
  const [apiKey, baseId, portfolios, timezone] = await runPortfolioSyncStage(
    "load_configuration",
    async () =>
      await Promise.all([
        getCredential(ctx, userId, portfolioCredentialTypes.airtableApiKey),
        getCredential(ctx, userId, portfolioCredentialTypes.airtableBaseId),
        getPortfolioConfigurations(ctx, userId),
        ctx.runQuery(getTimezoneInternal, { userId }),
      ]),
  );
  if (!apiKey || !baseId || portfolios.length === 0) {
    return {
      success: false,
      message:
        "Add the Portfolio Airtable API Key and Base ID, then configure at least one portfolio in Tasky settings.",
      synced: 0,
      details: emptySyncDetails(),
    };
  }

  const alpacaCredentials = getAlpacaCredentials();
  if (!alpacaCredentials) {
    return {
      success: false,
      message:
        "Set ALPACA_API_KEY and ALPACA_SECRET_KEY in the Tasky Convex environment.",
      synced: 0,
      details: emptySyncDetails(),
    };
  }

  const credentials = { apiKey, baseId };
  const records = await runPortfolioSyncStage(
    "read_positions",
    async () => await fetchPortfolioPositionRecords(credentials, portfolios),
  );
  if (records.length === 0) {
    return {
      success: true,
      message: `No positions found across ${portfolios.length} portfolios.`,
      synced: 0,
      details: emptySyncDetails(),
    };
  }

  const recordsWithAccounts = records.map((record) => ({
    accountRecordIds: linkedRecordIds(record.fields.Account),
    holding: calculateHolding(record),
  }));
  const invalidAccounts = recordsWithAccounts.filter(
    ({ accountRecordIds }) => accountRecordIds.length !== 1,
  );
  if (invalidAccounts.length > 0) {
    const details = emptySyncDetails();
    details.unassignedPositions = invalidAccounts.length;
    return {
      success: false,
      message: `${invalidAccounts.length} Position record${invalidAccounts.length === 1 ? "" : "s"} must link to exactly one Account before snapshots can be stored.`,
      synced: 0,
      details,
    };
  }

  const tickers = [
    ...new Set(
      recordsWithAccounts.map(({ holding }) => holding.ticker).filter(Boolean),
    ),
  ];
  const endDate = snapshotDate ?? getTodayDate(timezone);
  const { prices, yahooTickers } = await runPortfolioSyncStage(
    "fetch_prices",
    async () =>
      await fetchLatestPrices(tickers, endDate, alpacaCredentials),
  );
  const positionsUpdated = await runPortfolioSyncStage(
    "update_positions",
    async () =>
      await updatePositionValues(
        credentials,
        recordsWithAccounts.flatMap(({ holding }) => {
          const latest = prices.get(holding.ticker);
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
      ),
  );

  const positionsByAccount = new Map<string, AccountSnapshotPosition[]>();
  for (const { accountRecordIds, holding } of recordsWithAccounts) {
    const accountRecordId = accountRecordIds[0]!;
    const latest = prices.get(holding.ticker);
    const value = latest ? latest.close * holding.shares : holding.currentValue;
    const positions = positionsByAccount.get(accountRecordId) ?? [];
    positions.push({
      positionRecordId: holding.id,
      ticker: holding.ticker,
      name: holding.companyName,
      quantity: holding.shares,
      costBasis: holding.costBasis,
      value,
      previousValue:
        latest?.previousClose == null
          ? value
          : latest.previousClose * holding.shares,
      ...(latest ? { marketDate: latest.date } : {}),
      ...(latest?.previousDate
        ? { previousMarketDate: latest.previousDate }
        : {}),
    });
    positionsByAccount.set(accountRecordId, positions);
  }
  const accountRecordIds = new Set(positionsByAccount.keys());
  const accountNames = await runPortfolioSyncStage(
    "read_account_names",
    async () =>
      await getInvestmentAccountNames(credentials, accountRecordIds),
  );
  const capturedAt = Date.now();
  const payloads = [...positionsByAccount].map(([accountRecordId, positions]) =>
    createAccountSnapshotPayload({
      accountRecordId,
      accountName: accountNames.get(accountRecordId) ?? accountRecordId,
      date: endDate,
      capturedAt,
      positions,
    }),
  );
  const snapshots = await runPortfolioSyncStage(
    "write_snapshots",
    async () => await upsertAccountSnapshots(credentials, payloads),
  );
  const synced = snapshots.created + snapshots.updated;
  return {
    success: true,
    message: `Stored ${synced} account snapshot${synced === 1 ? "" : "s"} for ${endDate} and refreshed ${positionsUpdated} Position values.`,
    synced,
    details: {
      tickersProcessed: tickers.length,
      accountsProcessed: payloads.length,
      snapshotsCreated: snapshots.created,
      snapshotsUpdated: snapshots.updated,
      positionsUpdated,
      unassignedPositions: 0,
      yahooTickers,
    },
  };
}

/** Same Airtable/Alpaca sync the app runs. Caller supplies an already-authorized user id. */
export async function syncPortfolioForUser(
  ctx: ActionCtx,
  userId: string,
  snapshotDate?: string,
) {
  const leaseId = crypto.randomUUID();
  const startedAt = Date.now();
  const acquired = await ctx.runMutation(
    internal.portfolio.acquireSyncLeaseInternal,
    { userId, leaseId, startedAt },
  );
  if (!acquired) {
    return {
      success: false,
      message: "A portfolio sync is already running.",
      synced: 0,
      details: emptySyncDetails(),
    };
  }
  try {
    const result = await performPortfolioSnapshotSync(
      ctx,
      userId,
      snapshotDate,
    );
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

export const syncPortfolio = action({
  args: {},
  returns: portfolioSyncResult,
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    return await syncPortfolioForUser(ctx, userId);
  },
});

export const backfillSnapshot = internalAction({
  args: {
    userId: v.string(),
    date: v.string(),
  },
  returns: portfolioSyncResult,
  handler: async (ctx, { userId, date }) => {
    if (!isValidIsoDate(date)) {
      throw new Error("Backfill date must use YYYY-MM-DD");
    }
    return await syncPortfolioForUser(ctx, userId, date);
  },
});
