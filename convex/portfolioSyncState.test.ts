import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { aggregateHoldingsByTicker, calculateHolding } from "./portfolio";
import { modules } from "./test.setup";

it("keeps an empty-ticker cash position in portfolio value", () => {
  expect(
    calculateHolding({
      id: "cash",
      fields: {
        Ticker: "",
        Name: "Cash",
        Value: 250,
      },
    }),
  ).toMatchObject({
    ticker: "",
    companyName: "Cash",
    shares: 0,
    costBasis: 250,
    currentPrice: null,
    currentValue: 250,
    gainLoss: 0,
  });
});

it("combines duplicate tickers and empty cash positions", () => {
  const holding = (overrides: {
    id: string;
    ticker: string;
    companyName: string;
    shares: number;
    costBasis: number;
    currentValue: number;
    targetAllocation: number | null;
  }) => ({
    ...overrides,
    currentPrice:
      overrides.shares === 0 ? null : overrides.currentValue / overrides.shares,
    gainLoss: overrides.currentValue - overrides.costBasis,
    gainLossPercent: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const aggregated = aggregateHoldingsByTicker([
    holding({
      id: "vti-a",
      ticker: "VTI",
      companyName: "Vanguard Total Market",
      shares: 2,
      costBasis: 180,
      currentValue: 200,
      targetAllocation: 20,
    }),
    holding({
      id: "vti-b",
      ticker: "VTI",
      companyName: "Vanguard Total Market",
      shares: 3,
      costBasis: 270,
      currentValue: 300,
      targetAllocation: 30,
    }),
    holding({
      id: "cash-a",
      ticker: "",
      companyName: "Cash",
      shares: 0,
      costBasis: 25,
      currentValue: 25,
      targetAllocation: null,
    }),
    holding({
      id: "cash-b",
      ticker: "",
      companyName: "Cash",
      shares: 0,
      costBasis: 75,
      currentValue: 75,
      targetAllocation: null,
    }),
  ]);

  expect(aggregated).toHaveLength(2);
  expect(aggregated[0]).toMatchObject({
    ticker: "VTI",
    shares: 5,
    costBasis: 450,
    currentValue: 500,
    currentPrice: 100,
    gainLoss: 50,
    targetAllocation: 50,
  });
  expect(aggregated[1]).toMatchObject({
    ticker: "",
    companyName: "Cash",
    shares: 0,
    costBasis: 100,
    currentValue: 100,
    currentPrice: null,
    gainLoss: 0,
  });
});

it("records one canonical portfolio sync time per user", async () => {
  const t = convexTest(schema, modules);
  expect(
    await t.query(internal.portfolio.getSyncStateInternal, {
      userId: "user-a",
    }),
  ).toBeNull();

  await t.mutation(internal.portfolio.recordSyncInternal, {
    userId: "user-a",
    lastSyncedAt: 100,
  });
  await t.mutation(internal.portfolio.recordSyncInternal, {
    userId: "user-a",
    lastSyncedAt: 200,
  });

  expect(
    await t.query(internal.portfolio.getSyncStateInternal, {
      userId: "user-a",
    }),
  ).toEqual({ lastSyncedAt: 200 });
  expect(
    await t.query(internal.portfolio.getSyncStateInternal, {
      userId: "user-b",
    }),
  ).toBeNull();
});

it("allows only the owner to release a user's sync lease", async () => {
  const t = convexTest(schema, modules);
  expect(
    await t.mutation(internal.portfolio.acquireSyncLeaseInternal, {
      userId: "user-a",
      leaseId: "first",
      startedAt: 1_000,
    }),
  ).toBe(true);
  expect(
    await t.mutation(internal.portfolio.acquireSyncLeaseInternal, {
      userId: "user-a",
      leaseId: "second",
      startedAt: 2_000,
    }),
  ).toBe(false);

  await t.mutation(internal.portfolio.releaseSyncLeaseInternal, {
    userId: "user-a",
    leaseId: "not-the-owner",
  });
  expect(
    await t.mutation(internal.portfolio.acquireSyncLeaseInternal, {
      userId: "user-a",
      leaseId: "second",
      startedAt: 2_000,
    }),
  ).toBe(false);

  await t.mutation(internal.portfolio.releaseSyncLeaseInternal, {
    userId: "user-a",
    leaseId: "first",
  });
  expect(
    await t.mutation(internal.portfolio.acquireSyncLeaseInternal, {
      userId: "user-a",
      leaseId: "second",
      startedAt: 2_000,
    }),
  ).toBe(true);
});
