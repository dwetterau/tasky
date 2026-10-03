import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./portfolio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./portfolio")>()),
  syncPortfolioForUser: vi.fn(),
}));

import schema from "./schema";
import { internal } from "./_generated/api";
import { modules } from "./test.setup";
import { syncPortfolioForUser } from "./portfolio";
import { retryDelayMs } from "./portfolioSync";

afterEach(() => {
  vi.clearAllMocks();
});

describe("daily portfolio sync dispatch", () => {
  it("backs off transient failures before advancing the queue", () => {
    expect(retryDelayMs(0)).toBe(60_000);
    expect(retryDelayMs(1)).toBe(5 * 60_000);
  });

  it("runs configured users sequentially and only once each", async () => {
    vi.mocked(syncPortfolioForUser).mockResolvedValue({
      success: true,
      message: "synced",
      synced: 1,
      details: {
        tickersProcessed: 1,
        accountsProcessed: 1,
        snapshotsCreated: 1,
        snapshotsUpdated: 0,
        positionsUpdated: 1,
        unassignedPositions: 0,
        yahooTickers: [],
      },
    });
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const [index, userId] of ["a", "a", "b"].entries()) {
        await ctx.db.insert("portfolios", {
          userId,
          name: `Portfolio ${index}`,
          airtableViewId: `viw${index}`,
          startDate: "2026-01-01",
          isDefault: index === 0 || index === 2,
          displayOrder: index,
          createdAt: index,
          updatedAt: index,
        });
      }
    });

    await t.mutation(internal.portfolioSync.dispatchDaily, {});
    await t.mutation(internal.portfolioSync.dispatchDaily, {});
    await t.finishAllScheduledFunctions(() => {});

    expect(vi.mocked(syncPortfolioForUser).mock.calls.map((call) => call[1])).toEqual([
      "a",
      "b",
    ]);
    const state = await t.run(async (ctx) => {
      return await ctx.db
        .query("portfolioSyncStates")
        .withIndex("by_user", (q) =>
          q.eq("userId", "__daily_portfolio_sync_dispatch__"),
        )
        .unique();
    });
    expect(state?.syncLeaseId).toBeUndefined();
    expect(state?.syncStartedAt).toBeUndefined();
    expect(state?.lastSyncedAt).toBeGreaterThan(0);
  });
});
