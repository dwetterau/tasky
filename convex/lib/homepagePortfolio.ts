import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  getPortfolioConfigurations,
  readPortfolioSnapshot,
  type PortfolioConfiguration,
} from "../portfolio";
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

type NamedPortfolio = NonNullable<PortfolioPayload["portfolios"]>[number];

function portfolioKey(portfolio: PortfolioConfiguration): string {
  return portfolio.id ? String(portfolio.id) : "legacy-schwab";
}

function legacyNamedPortfolio(payload: PortfolioPayload): NamedPortfolio {
  return {
    id: "legacy-schwab",
    name: "Schwab",
    currency: payload.currency,
    totalValue: payload.totalValue,
    gainLoss: payload.gainLoss,
    gainLossPercent: payload.gainLossPercent,
    holdingsCount: payload.holdingsCount,
    lastSyncedAt: payload.lastSyncedAt,
    latestPriceDate: payload.latestPriceDate,
    holdings: payload.holdings,
  };
}

function projectPortfolio(
  portfolio: PortfolioConfiguration,
  result: Awaited<ReturnType<typeof readPortfolioSnapshot>> & {
    status: "ok";
  },
  lastSyncedAt: number | null,
  refreshPriceStatus: boolean,
  cached?: NamedPortfolio,
): NamedPortfolio {
  const cachedByTicker = new Map(
    cached?.holdings.map((holding) => [holding.ticker, holding]) ?? [],
  );
  return {
    id: portfolioKey(portfolio),
    name: portfolio.name,
    currency: "USD",
    totalValue: result.summary.totalCurrentValue,
    gainLoss: result.summary.gainLoss,
    gainLossPercent: result.summary.gainLossPercent,
    holdingsCount: result.summary.holdingsCount,
    lastSyncedAt,
    latestPriceDate: refreshPriceStatus
      ? result.summary.latestPriceDate
      : (cached?.latestPriceDate ?? null),
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
  };
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
    const configurations = await getPortfolioConfigurations(ctx, userId);
    if (configurations.length === 0) {
      return { ...empty, status: "disabled" };
    }
    const cachedPortfolios: NamedPortfolio[] =
      cached?.payload.portfolios ??
      (cached ? [legacyNamedPortfolio(cached.payload)] : []);
    const cachedById = new Map(
      cachedPortfolios.map((portfolio) => [portfolio.id, portfolio]),
    );
    const hasDetailedRows =
      cachedPortfolios.length === configurations.length &&
      configurations.every((configuration) => {
        const portfolio = cachedById.get(portfolioKey(configuration));
        return (
          portfolio !== undefined &&
          portfolio.holdings.every(
          (holding) =>
            holding.shares !== undefined &&
            holding.costBasis !== undefined &&
            holding.gainLossPercent !== undefined,
          )
        );
      });
    const refreshPriceStatus =
      !hasDetailedRows ||
      (syncState?.lastSyncedAt ?? null) !==
        (cached?.payload.lastSyncedAt ?? null);
    const projected: NamedPortfolio[] = [];
    let freshPortfolioCount = 0;
    for (const portfolio of configurations) {
      const cachedPortfolio = cachedById.get(portfolioKey(portfolio));
      try {
        const result = await readPortfolioSnapshot(
          ctx,
          userId,
          refreshPriceStatus ? "recent" : false,
          portfolio,
        );
        if (result.status === "ok") {
          freshPortfolioCount += 1;
          projected.push(
            projectPortfolio(
              portfolio,
              result,
              syncState?.lastSyncedAt ?? null,
              refreshPriceStatus,
              cachedPortfolio,
            ),
          );
        } else if (cachedPortfolio) {
          projected.push({ ...cachedPortfolio, name: portfolio.name });
        }
      } catch {
        if (cachedPortfolio) {
          projected.push({ ...cachedPortfolio, name: portfolio.name });
        }
      }
    }
    if (freshPortfolioCount === 0) {
      throw new Error("Portfolio unavailable");
    }
    const defaultConfiguration =
      configurations.find((portfolio) => portfolio.isDefault) ??
      configurations[0];
    const defaultPortfolio =
      projected.find(
        (portfolio) =>
          defaultConfiguration &&
          portfolio.id === portfolioKey(defaultConfiguration),
      ) ?? projected[0];
    if (!defaultPortfolio) return { ...empty, status: "disabled" };
    const orderedPortfolios = [
      defaultPortfolio,
      ...projected.filter(
        (portfolio) => portfolio.id !== defaultPortfolio.id,
      ),
    ];
    const now = Date.now();
    return {
      ...empty,
      status: "available",
      sourceDataAt: now,
      collectedAt: now,
      payload: portfolioPayloadSchema.parse({
        currency: defaultPortfolio.currency,
        totalValue: defaultPortfolio.totalValue,
        gainLoss: defaultPortfolio.gainLoss,
        gainLossPercent: defaultPortfolio.gainLossPercent,
        holdingsCount: defaultPortfolio.holdingsCount,
        lastSyncedAt: defaultPortfolio.lastSyncedAt,
        latestPriceDate: defaultPortfolio.latestPriceDate,
        holdings: defaultPortfolio.holdings,
        portfolios: orderedPortfolios,
      }),
    };
  } catch {
    return { ...(cached?.snapshot ?? empty), error: "collection_failed" };
  }
}
