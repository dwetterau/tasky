import type { ActionCtx } from "../_generated/server";
import { readPortfolioSnapshot } from "../portfolio";
import {
  moduleSchema,
  portfolioPayloadSchema,
  summary,
  type ModuleSnapshot,
} from "../../packages/home-feed/src/index";

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
  try {
    // Saved holdings only: no market-price sync or per-holding history requests.
    const result = await readPortfolioSnapshot(ctx, userId, false);
    if (result.status === "no_credentials")
      return { ...empty, status: "disabled" };
    if (result.status !== "ok") throw new Error("Portfolio unavailable");
    const now = Date.now();
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
        holdings: [...result.holdings]
          .sort((a, b) => b.currentValue - a.currentValue)
          .slice(0, 5)
          .map((holding) => ({
            ticker: holding.ticker.slice(0, 24),
            name: summary(holding.companyName),
            value: holding.currentValue,
            allocation:
              result.summary.totalCurrentValue > 0
                ? holding.currentValue / result.summary.totalCurrentValue
                : 0,
          })),
      }),
    };
  } catch {
    let cached: ModuleSnapshot = empty;
    if (previous) {
      try {
        const parsed = moduleSchema.safeParse(JSON.parse(previous));
        if (parsed.success && parsed.data.id === "portfolio")
          cached = parsed.data;
      } catch {
        /* A corrupt cache must not block the Tasky export. */
      }
    }
    return { ...cached, error: "collection_failed" };
  }
}
