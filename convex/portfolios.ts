import { v } from "convex/values";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { getAuthUserId } from "./auth";
import type { Doc } from "./_generated/dataModel";

const MAX_PORTFOLIOS_PER_USER = 5;

const portfolioValidator = v.object({
  _id: v.id("portfolios"),
  _creationTime: v.number(),
  name: v.string(),
  airtableViewId: v.string(),
  startDate: v.string(),
  isDefault: v.boolean(),
  displayOrder: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function normalizeConfiguration(args: {
  name: string;
  airtableViewId: string;
  startDate: string;
}) {
  const name = args.name.trim();
  const airtableViewId = args.airtableViewId.trim();
  const startDate = args.startDate.trim();
  if (!name) throw new Error("Portfolio name is required");
  if (name.length > 80) {
    throw new Error("Portfolio name must be 80 characters or fewer");
  }
  if (!airtableViewId) throw new Error("Airtable view ID is required");
  if (
    airtableViewId.length > 128 ||
    !/^viw[a-zA-Z0-9]+$/.test(airtableViewId)
  ) {
    throw new Error("A valid Airtable view ID is required");
  }
  if (!isValidIsoDate(startDate)) {
    throw new Error("Portfolio start date must be in YYYY-MM-DD format");
  }
  return { name, airtableViewId, startDate };
}

async function listForUser(ctx: MutationCtx, userId: string) {
  return await ctx.db
    .query("portfolios")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(MAX_PORTFOLIOS_PER_USER + 1);
}

function sortPortfolios(portfolios: Doc<"portfolios">[]) {
  return [...portfolios].sort(
    (a, b) =>
      a.displayOrder - b.displayOrder ||
      a._creationTime - b._creationTime,
  );
}

function publicPortfolio(portfolio: Doc<"portfolios">) {
  return {
    _id: portfolio._id,
    _creationTime: portfolio._creationTime,
    name: portfolio.name,
    airtableViewId: portfolio.airtableViewId,
    startDate: portfolio.startDate,
    isDefault: portfolio.isDefault,
    displayOrder: portfolio.displayOrder,
    createdAt: portfolio.createdAt,
    updatedAt: portfolio.updatedAt,
  };
}

export const list = query({
  args: {},
  returns: v.array(portfolioValidator),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("portfolios")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(MAX_PORTFOLIOS_PER_USER + 1);
    return sortPortfolios(rows).map(publicPortfolio);
  },
});

export const listForUserInternal = internalQuery({
  args: { userId: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("portfolios"),
      name: v.string(),
      airtableViewId: v.string(),
      startDate: v.string(),
      isDefault: v.boolean(),
      displayOrder: v.number(),
    }),
  ),
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("portfolios")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(MAX_PORTFOLIOS_PER_USER + 1);
    return sortPortfolios(rows).map((row) => ({
      _id: row._id,
      name: row.name,
      airtableViewId: row.airtableViewId,
      startDate: row.startDate,
      isDefault: row.isDefault,
      displayOrder: row.displayOrder,
    }));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    airtableViewId: v.string(),
    startDate: v.string(),
  },
  returns: v.id("portfolios"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const input = normalizeConfiguration(args);
    const existingView = await ctx.db
      .query("portfolios")
      .withIndex("by_user_view", (q) =>
        q.eq("userId", userId).eq("airtableViewId", input.airtableViewId),
      )
      .unique();
    if (existingView) {
      throw new Error("That Airtable view is already configured");
    }

    const portfolios = await listForUser(ctx, userId);
    if (portfolios.length >= MAX_PORTFOLIOS_PER_USER) {
      throw new Error(
        `A maximum of ${MAX_PORTFOLIOS_PER_USER} portfolios is supported`,
      );
    }
    const now = Date.now();
    const displayOrder =
      portfolios.reduce(
        (max, portfolio) => Math.max(max, portfolio.displayOrder),
        -1,
      ) + 1;
    return await ctx.db.insert("portfolios", {
      userId,
      ...input,
      isDefault: portfolios.length === 0,
      displayOrder,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("portfolios"),
    name: v.string(),
    airtableViewId: v.string(),
    startDate: v.string(),
  },
  returns: v.id("portfolios"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const portfolio = await ctx.db.get("portfolios", args.id);
    if (!portfolio || portfolio.userId !== userId) {
      throw new Error("Portfolio not found or access denied");
    }
    const input = normalizeConfiguration(args);
    const existingView = await ctx.db
      .query("portfolios")
      .withIndex("by_user_view", (q) =>
        q.eq("userId", userId).eq("airtableViewId", input.airtableViewId),
      )
      .unique();
    if (existingView && existingView._id !== args.id) {
      throw new Error("That Airtable view is already configured");
    }
    await ctx.db.patch("portfolios", args.id, {
      ...input,
      updatedAt: Date.now(),
    });
    return args.id;
  },
});

export const setDefault = mutation({
  args: { id: v.id("portfolios") },
  returns: v.id("portfolios"),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const portfolio = await ctx.db.get("portfolios", id);
    if (!portfolio || portfolio.userId !== userId) {
      throw new Error("Portfolio not found or access denied");
    }
    const rows = await listForUser(ctx, userId);
    for (const row of rows) {
      if (row.isDefault !== (row._id === id)) {
        await ctx.db.patch("portfolios", row._id, {
          isDefault: row._id === id,
          updatedAt: Date.now(),
        });
      }
    }
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("portfolios") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const portfolio = await ctx.db.get("portfolios", id);
    if (!portfolio || portfolio.userId !== userId) {
      throw new Error("Portfolio not found or access denied");
    }
    await ctx.db.delete("portfolios", id);
    if (portfolio.isDefault) {
      const remaining = sortPortfolios(await listForUser(ctx, userId));
      const next = remaining[0];
      if (next) {
        await ctx.db.patch("portfolios", next._id, {
          isDefault: true,
          updatedAt: Date.now(),
        });
      }
    }
    return null;
  },
});
