import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { modules } from "./test.setup";

it("lists only one user's portfolios in display order", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { secondId } = await t.run(async (ctx) => {
    const secondId = await ctx.db.insert("portfolios", {
      userId: "user-a",
      name: "Retirement",
      airtableViewId: "view-retirement",
      startDate: "2026-01-01",
      isDefault: false,
      displayOrder: 2,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("portfolios", {
      userId: "user-a",
      name: "Schwab",
      airtableViewId: "view-schwab",
      startDate: "2025-01-01",
      isDefault: true,
      displayOrder: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("portfolios", {
      userId: "user-b",
      name: "Private",
      airtableViewId: "view-private",
      startDate: "2024-01-01",
      isDefault: true,
      displayOrder: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { secondId };
  });

  const portfolios = await t.query(
    internal.portfolios.listForUserInternal,
    { userId: "user-a" },
  );
  expect(portfolios.map((portfolio) => portfolio.name)).toEqual([
    "Schwab",
    "Retirement",
  ]);
  expect(portfolios[1]?._id).toBe(secondId);
  expect(portfolios.every((portfolio) => portfolio.airtableViewId !== "view-private")).toBe(
    true,
  );
});
