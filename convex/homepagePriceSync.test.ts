import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./portfolio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./portfolio")>()),
  syncPriceHistoryForUser: vi.fn(),
  readPortfolioSnapshot: vi.fn(async () => ({
    status: "no_credentials" as const,
    message: "missing",
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
  })),
}));

import schema from "./schema";
import { internal } from "./_generated/api";
import { modules } from "./test.setup";
import { syncPriceHistoryForUser } from "./portfolio";

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

const synced = {
  success: true,
  message: "synced",
  synced: 2,
  details: {
    tickersProcessed: 1,
    recordsFound: 2,
    recordsInserted: 2,
    positionsUpdated: 1,
    yahooTickers: [],
  },
};

describe("homepage price sync completion", () => {
  it("exports a new edition after the sync that owns the lease", async () => {
    vi.mocked(syncPriceHistoryForUser).mockResolvedValue(synced);
    const t = convexTest(schema, modules);
    const startedAt = Date.now();
    const id = await t.run((ctx) =>
      ctx.db.insert("homepageEnrollments", {
        userId: "a",
        timezone: "America/New_York",
        enabled: true,
        revision: 0,
        nextRunAt: 0,
        attempt: 0,
        priceSyncStartedAt: startedAt,
      }),
    );
    await t.action(internal.homepage.runPriceSync, { userId: "a", startedAt });
    await t.finishAllScheduledFunctions(() => {});
    const row = await t.query(internal.homepage.pending, { id });
    expect(syncPriceHistoryForUser).toHaveBeenCalledWith(
      expect.anything(),
      "a",
    );
    expect(row!.priceSyncStartedAt).toBeUndefined();
    expect(row!.revision).toBe(1);
    expect(row!.pendingBody).toContain('"userId":"a"');
  });

  it("does not clear a newer lease or export when an older sync finishes", async () => {
    vi.mocked(syncPriceHistoryForUser).mockResolvedValue(synced);
    const t = convexTest(schema, modules);
    const newer = Date.now();
    const id = await t.run((ctx) =>
      ctx.db.insert("homepageEnrollments", {
        userId: "a",
        timezone: "America/New_York",
        enabled: true,
        revision: 0,
        nextRunAt: 0,
        attempt: 0,
        priceSyncStartedAt: newer,
      }),
    );
    await t.action(internal.homepage.runPriceSync, {
      userId: "a",
      startedAt: newer - 1,
    });
    const row = await t.query(internal.homepage.pending, { id });
    expect(row!.priceSyncStartedAt).toBe(newer);
    expect(row!.revision).toBe(0);
    expect(row!.pendingBody).toBeUndefined();
  });

  it("queues a fresh snapshot behind an in-flight export", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T16:00:00Z"));
    vi.mocked(syncPriceHistoryForUser).mockResolvedValue(synced);
    const t = convexTest(schema, modules);
    const startedAt = Date.now();
    const id = await t.run((ctx) =>
      ctx.db.insert("homepageEnrollments", {
        userId: "a",
        timezone: "America/New_York",
        enabled: true,
        revision: 1,
        nextRunAt: Date.now() + 5 * 60_000,
        attempt: 0,
        pendingBody: "frozen-before-price-sync",
        pendingExportId: "a-1",
        priceSyncStartedAt: startedAt,
      }),
    );

    await t.action(internal.homepage.runPriceSync, { userId: "a", startedAt });
    const queued = await t.query(internal.homepage.pending, { id });
    expect(queued!.pendingBody).toBe("frozen-before-price-sync");
    expect(queued!.pendingExportId).toBe("a-1");
    expect(queued!.exportRequested).toBe(true);
    expect(queued!.priceSyncStartedAt).toBeUndefined();

    await t.mutation(internal.homepage.deliveryResult, {
      id,
      exportId: "a-1",
      ok: true,
      permanent: false,
    });
    const ready = await t.query(internal.homepage.pending, { id });
    expect(ready!.pendingBody).toBeUndefined();
    expect(ready!.pendingExportId).toBeUndefined();
    expect(ready!.exportRequested).toBeUndefined();
    expect(ready!.nextRunAt).toBe(Date.now());

    await t.mutation(internal.homepage.freeze, { id });
    const fresh = await t.query(internal.homepage.pending, { id });
    expect(fresh!.revision).toBe(2);
    expect(fresh!.pendingBody).toContain('"userId":"a"');
  });
});
