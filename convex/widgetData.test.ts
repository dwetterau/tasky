import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { getLatestWidgetData, projectLatestBriefing } from "./widgetData";
import { moduleSchema } from "../packages/home-feed/src/index";

describe("widget data", () => {
  it("finds the newest row by user and kind", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.widgetData.publishFromMcp, {
      userId: "user-a",
      kind: "briefing",
      schemaVersion: 1,
      dataJson: JSON.stringify({ markdown: "# Morning" }),
    });
    await t.mutation(internal.widgetData.publishFromMcp, {
      userId: "user-b",
      kind: "briefing",
      schemaVersion: 1,
      dataJson: JSON.stringify({ markdown: "# Private" }),
    });
    const evening = await t.mutation(internal.widgetData.publishFromMcp, {
      userId: "user-a",
      kind: "briefing",
      schemaVersion: 1,
      dataJson: JSON.stringify({ markdown: "# Evening" }),
    });

    const latest = await t.run((ctx) =>
      getLatestWidgetData(ctx, "user-a", "briefing"),
    );
    expect(latest?._id).toBe(evening.id);
    expect(JSON.parse(latest!.dataJson)).toEqual({ markdown: "# Evening" });
  });

  it("deduplicates retry keys and rejects conflicting reuse", async () => {
    const t = convexTest(schema, modules);
    const input = {
      userId: "user-a",
      kind: "briefing" as const,
      schemaVersion: 1,
      dataJson: JSON.stringify({ markdown: "# Morning" }),
      idempotencyKey: "briefing:2026-09-30:morning",
    };
    const first = await t.mutation(
      internal.widgetData.publishFromMcp,
      input,
    );
    const retry = await t.mutation(
      internal.widgetData.publishFromMcp,
      input,
    );
    expect(retry).toEqual({ ...first, duplicate: true });

    await expect(
      t.mutation(internal.widgetData.publishFromMcp, {
        ...input,
        dataJson: JSON.stringify({ markdown: "# Different" }),
      }),
    ).rejects.toThrow(
      "idempotencyKey was already used with different widget data",
    );
  });

  it("projects only schema-valid briefing data for the homepage", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.widgetData.publishFromMcp, {
      userId: "user-a",
      kind: "briefing",
      schemaVersion: 1,
      dataJson: JSON.stringify({ markdown: "  # Briefing  " }),
    });
    const projected = await t.run((ctx) =>
      projectLatestBriefing(ctx, "user-a", Date.now()),
    );
    const latest = await t.run((ctx) =>
      getLatestWidgetData(ctx, "user-a", "briefing"),
    );
    expect(projected).toMatchObject({
      id: "briefing",
      schemaVersion: 1,
      sourceDataAt: Math.floor(latest!._creationTime),
      payload: { markdown: "# Briefing" },
    });
    expect(() => moduleSchema.parse(projected)).not.toThrow();
  });
});
