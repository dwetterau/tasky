import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "./auth";
import { widgetKind } from "./schema";
import {
  briefingPayloadSchema,
  WIDGET_DATA_MAX_BYTES,
  widgetDataInputSchema,
  type ModuleSnapshot,
  type WidgetKind,
} from "../packages/home-feed/src/index";

const latestWidgetDataValidator = v.union(
  v.object({
    id: v.id("widgetData"),
    createdAt: v.number(),
    kind: widgetKind,
    schemaVersion: v.number(),
    dataJson: v.string(),
  }),
  v.null(),
);

export async function getLatestWidgetData(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  userId: string,
  kind: WidgetKind,
) {
  return await ctx.db
    .query("widgetData")
    .withIndex("by_user_kind", (q) =>
      q.eq("userId", userId).eq("kind", kind),
    )
    .order("desc")
    .first();
}

export async function projectLatestBriefing(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  userId: string,
  now: number,
): Promise<ModuleSnapshot | undefined> {
  const row = await getLatestWidgetData(ctx, userId, "briefing");
  if (!row) return undefined;
  const payload = briefingPayloadSchema.parse(JSON.parse(row.dataJson));
  return {
    id: "briefing",
    schemaVersion: 1,
    scope: "user",
    sourceRevision: Math.max(1, Math.floor(row._creationTime)),
    sourceDataAt: row._creationTime,
    collectedAt: now,
    freshForMs: 18 * 60 * 60_000,
    maxAgeMs: 7 * 24 * 60 * 60_000,
    status: "available",
    payload,
  };
}

export const latest = query({
  args: { kind: widgetKind },
  returns: latestWidgetDataValidator,
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const row = await getLatestWidgetData(ctx, userId, args.kind);
    return row
      ? {
          id: row._id,
          createdAt: row._creationTime,
          kind: row.kind,
          schemaVersion: row.schemaVersion,
          dataJson: row.dataJson,
        }
      : null;
  },
});

export const latestForMcp = internalQuery({
  args: {
    userId: v.string(),
    kind: widgetKind,
  },
  returns: latestWidgetDataValidator,
  handler: async (ctx, args) => {
    const row = await getLatestWidgetData(ctx, args.userId, args.kind);
    return row
      ? {
          id: row._id,
          createdAt: row._creationTime,
          kind: row.kind,
          schemaVersion: row.schemaVersion,
          dataJson: row.dataJson,
        }
      : null;
  },
});

export const publishFromMcp = internalMutation({
  args: {
    userId: v.string(),
    kind: widgetKind,
    schemaVersion: v.number(),
    dataJson: v.string(),
    idempotencyKey: v.optional(v.string()),
  },
  returns: v.object({
    id: v.id("widgetData"),
    createdAt: v.number(),
    duplicate: v.boolean(),
  }),
  handler: async (ctx, args) => {
    let data: unknown;
    try {
      data = JSON.parse(args.dataJson);
    } catch {
      throw new Error("dataJson must contain valid JSON");
    }
    const parsed = widgetDataInputSchema.parse({
      kind: args.kind,
      schemaVersion: args.schemaVersion,
      data,
      idempotencyKey: args.idempotencyKey,
    });
    const canonicalDataJson = JSON.stringify(parsed.data);
    if (new TextEncoder().encode(canonicalDataJson).length > WIDGET_DATA_MAX_BYTES) {
      throw new Error(
        `Widget data cannot exceed ${WIDGET_DATA_MAX_BYTES} UTF-8 bytes`,
      );
    }

    if (parsed.idempotencyKey) {
      const existing = await ctx.db
        .query("widgetData")
        .withIndex("by_user_kind_idempotency", (q) =>
          q
            .eq("userId", args.userId)
            .eq("kind", parsed.kind)
            .eq("idempotencyKey", parsed.idempotencyKey),
        )
        .unique();
      if (existing) {
        if (
          existing.schemaVersion !== parsed.schemaVersion ||
          existing.dataJson !== canonicalDataJson
        ) {
          throw new Error(
            "idempotencyKey was already used with different widget data",
          );
        }
        return {
          id: existing._id,
          createdAt: existing._creationTime,
          duplicate: true,
        };
      }
    }

    const id = await ctx.db.insert("widgetData", {
      userId: args.userId,
      kind: parsed.kind,
      schemaVersion: parsed.schemaVersion,
      dataJson: canonicalDataJson,
      idempotencyKey: parsed.idempotencyKey,
    });
    const created = await ctx.db.get("widgetData", id);
    if (!created) throw new Error("Widget data was not created");

    const homepage = await ctx.db
      .query("homepageEnrollments")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (homepage?.enabled) {
      await ctx.scheduler.runAfter(0, internal.homepage.requestExport, {
        userId: args.userId,
      });
    }

    return {
      id,
      createdAt: created._creationTime,
      duplicate: false,
    };
  },
});
