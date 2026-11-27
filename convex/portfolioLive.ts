import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "./auth";
import { getAlpacaCredentials, supportsMarketPriceLookup } from "./portfolio";
import {
  buildIntradaySession,
  type AlpacaSnapshot,
  type IntradayBar,
} from "./lib/intradayQuotes";

const ALPACA_STOCKS_URL = "https://data.alpaca.markets/v2/stocks";
const MAX_TICKERS = 150;
// The free Alpaca plan only serves real-time data from the IEX exchange.
const FEED = "iex";

type AlpacaCredentials = NonNullable<ReturnType<typeof getAlpacaCredentials>>;

async function alpacaGet<T>(
  path: string,
  params: Record<string, string>,
  credentials: AlpacaCredentials,
): Promise<T> {
  const response = await fetch(
    `${ALPACA_STOCKS_URL}/${path}?${new URLSearchParams(params).toString()}`,
    {
      headers: {
        "APCA-API-KEY-ID": credentials.apiKey,
        "APCA-API-SECRET-KEY": credentials.secretKey,
        Accept: "application/json",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Alpaca API error (${response.status})`);
  }
  return (await response.json()) as T;
}

const unavailable = (message: string) => ({
  status: "unavailable" as const,
  message,
  session: null,
});

/**
 * Live prices and today's 5-minute price path for the given tickers. The
 * portfolio page polls this while its 1D view is open; nothing is stored.
 */
export const getIntraday = action({
  args: { tickers: v.array(v.string()) },
  returns: v.object({
    status: v.union(v.literal("ok"), v.literal("unavailable")),
    message: v.optional(v.string()),
    session: v.union(
      v.null(),
      v.object({
        sessionDate: v.string(),
        sessionOpen: v.number(),
        sessionClose: v.number(),
        asOf: v.number(),
        lastTradeAt: v.number(),
        times: v.array(v.number()),
        quotes: v.array(
          v.object({
            ticker: v.string(),
            price: v.number(),
            previousClose: v.number(),
            priceAt: v.number(),
            prices: v.array(v.number()),
          }),
        ),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const tickers = [
      ...new Set(args.tickers.map((ticker) => ticker.trim().toUpperCase())),
    ]
      .filter(supportsMarketPriceLookup)
      .slice(0, MAX_TICKERS);
    if (tickers.length === 0) return unavailable("No tickers to price.");

    const credentials = getAlpacaCredentials();
    if (!credentials) return unavailable("Live prices are not configured.");

    try {
      const symbols = tickers.join(",");
      const snapshotResponse = await alpacaGet<
        | Record<string, AlpacaSnapshot | null>
        | { snapshots: Record<string, AlpacaSnapshot | null> }
      >("snapshots", { symbols, feed: FEED }, credentials);
      const snapshots = (
        "snapshots" in snapshotResponse &&
        typeof snapshotResponse.snapshots === "object"
          ? snapshotResponse.snapshots
          : snapshotResponse
      ) as Record<string, AlpacaSnapshot | null>;

      const now = Date.now();
      const preview = buildIntradaySession(snapshots, {}, now);
      if (!preview) return unavailable("No live prices for these holdings.");

      const bars: Record<string, IntradayBar[]> = {};
      if (preview.times.length > 0) {
        let pageToken: string | undefined;
        do {
          const page = await alpacaGet<{
            bars?: Record<string, IntradayBar[]>;
            next_page_token?: string | null;
          }>(
            "bars",
            {
              symbols: preview.quotes.map((quote) => quote.ticker).join(","),
              timeframe: "5Min",
              start: new Date(preview.sessionOpen).toISOString(),
              end: new Date(preview.sessionClose).toISOString(),
              limit: "10000",
              adjustment: "split",
              feed: FEED,
              ...(pageToken ? { page_token: pageToken } : {}),
            },
            credentials,
          );
          for (const [ticker, tickerBars] of Object.entries(page.bars ?? {})) {
            bars[ticker] = [...(bars[ticker] ?? []), ...tickerBars];
          }
          pageToken = page.next_page_token ?? undefined;
        } while (pageToken);
      }

      return {
        status: "ok" as const,
        session: buildIntradaySession(snapshots, bars, now),
      };
    } catch (error) {
      console.warn("Live portfolio prices unavailable:", error);
      return unavailable(
        error instanceof Error ? error.message : "Live prices are unavailable.",
      );
    }
  },
});
