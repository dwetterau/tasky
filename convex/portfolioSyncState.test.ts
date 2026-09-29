import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { getMissingPriceDates } from "./portfolio";
import { modules } from "./test.setup";

it("backfills an earlier portfolio start while extending shared prices", () => {
  expect(
    getMissingPriceDates("2026-01-01", "2026-01-12", {
      earliestDate: "2026-01-06",
      latestDate: "2026-01-08",
    }),
  ).toEqual([
    "2026-01-01",
    "2026-01-02",
    "2026-01-05",
    "2026-01-09",
    "2026-01-12",
  ]);
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
