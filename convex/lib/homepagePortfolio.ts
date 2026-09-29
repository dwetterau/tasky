import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { readPortfolioSnapshot } from "../portfolio";
import {
  LIMITS,
  moduleSchema,
  portfolioPayloadSchema,
  summary,
  type PortfolioPayload,
  type ModuleSnapshot,
} from "../../packages/home-feed/src/index";

function previousPortfolio(previous?: string): {
  snapshot: ModuleSnapshot;
  payload: PortfolioPayload;
} | null {
  if (!previous) return null;
  try {
    const snapshot = moduleSchema.safeParse(JSON.parse(previous));
    if (!snapshot.success || snapshot.data.id !== "portfolio") return null;
    const payload = portfolioPayloadSchema.safeParse(snapshot.data.payload);
    return payload.success
      ? { snapshot: snapshot.data, payload: payload.data }
      : null;
  } catch {
    return null;
  }
}

export async function collectHomepagePortfolio(
  ctx: ActionCtx,
  userId: string,
  previous?: string,
): Promise<ModuleSnapshot> {
  const empty: ModuleSnapshot = {
    id: "portfolio",
    schemaVersion: 1,
    scope: "user",
    sourceDataAt: null,
    collectedAt: null,
    freshForMs: 15 * 60_000,
    maxAgeMs: 60 * 60_000,
    status: "unavailable",
    payload: null,
  };
  const cached = previousPortfolio(previous);
  try {
    const syncState = await ctx.runQuery(
      internal.portfolio.getSyncStateInternal,
      { userId },
    );
    const hasDetailedRows =
      cached !== null &&
      cached.payload.holdings.every(
        (holding) =>
          holding.shares !== undefined &&
          holding.costBasis !== undefined &&
          holding.gainLossPercent !== undefined,
      );
    const refreshPriceStatus =
      !hasDetailedRows ||
      (syncState?.lastSyncedAt ?? null) !==
        (cached?.payload.lastSyncedAt ?? null);
    // Every export reads the saved Positions view once. Recent history is read
    // in one bounded batch only for the first rich snapshot or after a sync.
    const result = await readPortfolioSnapshot(
      ctx,
      userId,
      refreshPriceStatus ? "recent" : false,
    );
    if (result.status === "no_credentials")
      return { ...empty, status: "disabled" };
    if (result.status !== "ok") throw new Error("Portfolio unavailable");
    const now = Date.now();
    const cachedByTicker = new Map(
      cached?.payload.holdings.map((holding) => [holding.ticker, holding]) ?? [],
    );
    return {
      ...empty,
      status: "available",
      sourceDataAt: now,
      collectedAt: now,
      payload: portfolioPayloadSchema.parse({
        currency: "USD",
        totalValue: result.summary.totalCurrentValue,
        gainLoss: result.summary.gainLoss,
        gainLossPercent: result.summary.gainLossPercent,
        holdingsCount: result.summary.holdingsCount,
        lastSyncedAt: syncState?.lastSyncedAt ?? null,
        latestPriceDate: refreshPriceStatus
          ? result.summary.latestPriceDate
          : (cached?.payload.latestPriceDate ?? null),
        holdings: [...result.holdings]
          .sort((a, b) => b.currentValue - a.currentValue)
          .slice(0, LIMITS.portfolioHoldings)
          .map((holding) => {
            const previousHolding = cachedByTicker.get(holding.ticker);
            return {
              ticker: holding.ticker.slice(0, 24),
              name: summary(holding.companyName),
              value: holding.currentValue,
              allocation:
                result.summary.totalCurrentValue > 0
                  ? holding.currentValue / result.summary.totalCurrentValue
                  : 0,
              shares: holding.shares,
              costBasis: holding.costBasis,
              dayReturn: refreshPriceStatus
                ? holding.dayReturn
                : (previousHolding?.dayReturn ?? null),
              dayReturnPercent: refreshPriceStatus
                ? holding.dayReturnPercent
                : (previousHolding?.dayReturnPercent ?? null),
              gainLossPercent: holding.gainLossPercent,
            };
          }),
      }),
    };
  } catch {
    return { ...(cached?.snapshot ?? empty), error: "collection_failed" };
  }
}
