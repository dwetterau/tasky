import { v } from "convex/values";
import { action, ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "./auth";
import { decryptApiKey } from "./apiKeys";
import { ApiKeyType } from "./schema";

const POSITIONS_TABLE = "Positions";
const PRICE_HISTORY_TABLE = "Price History";

const portfolioCredentialTypes = {
  airtableApiKey: "portfolio_airtable_api_key",
  airtableBaseId: "portfolio_airtable_base_id",
  schwabPositionsViewId: "portfolio_schwab_positions_view_id",
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

function formatAirtableDate(value: unknown): string | null {
  if (!value) return null;
  return asString(value).split("T")[0] ?? null;
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
