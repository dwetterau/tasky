import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { modules } from "./test.setup";

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
