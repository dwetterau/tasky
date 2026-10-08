import { describe, expect, it, vi } from "vitest";
import {
  WIDGETS_READ_SCOPE,
  WIDGETS_WRITE_SCOPE,
  type ParsedMcpScopes,
} from "./mcpScopes";
import {
  createWidgetToolHandlers,
  widgetToolDescriptors,
  type WidgetExecutors,
} from "./mcpTools/widgets";

type JsonRpcBody = {
  error?: { code: number; message: string };
  result?: {
    content: Array<{ type: string; text: string }>;
  };
};

async function responseBody(response: Response): Promise<JsonRpcBody> {
  return (await response.json()) as JsonRpcBody;
}

function scopes(...values: string[]): ParsedMcpScopes {
  return { scopes: new Set(values) };
}

const stravaData = {
  latestRun: {
    sport: "run" as const,
    activityUrl: "https://www.strava.com/activities/20421937807",
    startedAt: "2026-10-02T15:46:42Z",
    distanceMeters: 4866.9,
    totalElevationGainMeters: 13,
    movingTimeSeconds: 1563,
    elapsedTimeSeconds: 1672,
    averageSpeedMetersPerSecond: 3.114,
    averageHeartRateBpm: 165.8,
  },
  latestRide: {
    sport: "ride" as const,
    activityUrl: "https://www.strava.com/activities/20380252374",
    startedAt: "2026-09-29T14:15:57Z",
    distanceMeters: 35857.6,
    totalElevationGainMeters: 214.3,
    movingTimeSeconds: 6544,
    elapsedTimeSeconds: 6833,
    averageSpeedMetersPerSecond: 5.479,
    averagePowerWatts: 75.2,
    averageHeartRateBpm: 137.4,
  },
};

function makeHandler() {
  const read = vi.fn<WidgetExecutors["read"]>(async () => ({
    id: "widget-data-1" as never,
    createdAt: 123,
    kind: "briefing",
    schemaVersion: 1,
    dataJson: JSON.stringify({ markdown: "# Morning" }),
  }));
  const publish = vi.fn<WidgetExecutors["publish"]>(async () => ({
    id: "widget-data-1" as never,
    createdAt: 123,
    duplicate: false,
  }));
  return {
    read,
    publish,
    handlers: createWidgetToolHandlers({ read, publish }),
  };
}

describe("widget MCP tool", () => {
  it("advertises one generated, strict schema for all widget kinds", () => {
    expect(widgetToolDescriptors.map((tool) => tool.name)).toEqual([
      "readWidgetData",
      "publishWidgetData",
    ]);
    expect(
      widgetToolDescriptors.every(
        (tool) => tool.inputSchema.type === "object",
      ),
    ).toBe(true);
    expect(widgetToolDescriptors[1]!.inputSchema).toMatchObject({
      oneOf: [
        {
          properties: {
            kind: { const: "briefing" },
            schemaVersion: { const: 1 },
          },
          additionalProperties: false,
        },
        {
          properties: {
            kind: { const: "on-this-day" },
            schemaVersion: { const: 1 },
          },
          additionalProperties: false,
        },
        {
          properties: {
            kind: { const: "strava" },
            schemaVersion: { const: 1 },
          },
          additionalProperties: false,
        },
        {
          properties: {
            kind: { const: "releases" },
            schemaVersion: { const: 1 },
          },
          additionalProperties: false,
        },
        {
          properties: {
            kind: { const: "recurring-expenses" },
            schemaVersion: { const: 1 },
          },
          additionalProperties: false,
        },
      ],
    });
  });

  it("requires widgets:write", async () => {
    const { handlers, publish } = makeHandler();
    const response = await handlers.publishWidgetData(
      1,
      "user-1",
      scopes("tasks:write"),
      {
        kind: "briefing",
        schemaVersion: 1,
        data: { markdown: "# Morning" },
      },
    );
    expect((await responseBody(response)).error).toEqual({
      code: -32001,
      message: `Missing required scope: ${WIDGETS_WRITE_SCOPE}`,
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it("publishes canonical JSON without a caller-provided row ID", async () => {
    const { handlers, publish } = makeHandler();
    const response = await handlers.publishWidgetData(
      2,
      "user-1",
      scopes(WIDGETS_WRITE_SCOPE),
      {
        kind: "briefing",
        schemaVersion: 1,
        data: { markdown: "  # Evening briefing  " },
        idempotencyKey: "briefing:2026-09-30:evening",
      },
    );
    expect((await responseBody(response)).error).toBeUndefined();
    expect(publish).toHaveBeenCalledWith({
      userId: "user-1",
      kind: "briefing",
      schemaVersion: 1,
      dataJson: JSON.stringify({ markdown: "# Evening briefing" }),
      idempotencyKey: "briefing:2026-09-30:evening",
    });
  });

  it("returns all useful Zod paths for incompatible data", async () => {
    const { handlers, publish } = makeHandler();
    const response = await handlers.publishWidgetData(
      3,
      "user-1",
      scopes(WIDGETS_WRITE_SCOPE),
      {
        kind: "briefing",
        schemaVersion: 1,
        data: { markdown: "", unexpected: true },
        extra: "no",
      },
    );
    const body = await responseBody(response);
    expect(body.error?.code).toBe(-32602);
    expect(body.error?.message).toContain("data.markdown");
    expect(body.error?.message).toContain("arguments");
    expect(body.error?.message).toContain(
      "briefing@1, on-this-day@1, strava@1, releases@1, recurring-expenses@1",
    );
    expect(publish).not.toHaveBeenCalled();
  });

  it("publishes a dated on-this-day journal retrospective", async () => {
    const { handlers, publish } = makeHandler();
    const data = {
      date: "2026-10-08",
      markdown: "  - **2022:** Took the train to Boston.  ",
    };
    const response = await handlers.publishWidgetData(
      4,
      "user-1",
      scopes(WIDGETS_WRITE_SCOPE),
      {
        kind: "on-this-day",
        schemaVersion: 1,
        data,
        idempotencyKey: "on-this-day:2026-10-08",
      },
    );
    expect((await responseBody(response)).error).toBeUndefined();
    expect(publish).toHaveBeenCalledWith({
      userId: "user-1",
      kind: "on-this-day",
      schemaVersion: 1,
      dataJson: JSON.stringify({
        date: "2026-10-08",
        markdown: "- **2022:** Took the train to Boston.",
      }),
      idempotencyKey: "on-this-day:2026-10-08",
    });
  });

  it("publishes normalized Strava activity summaries", async () => {
    const { handlers, publish } = makeHandler();
    const response = await handlers.publishWidgetData(
      4,
      "user-1",
      scopes(WIDGETS_WRITE_SCOPE),
      {
        kind: "strava",
        schemaVersion: 1,
        data: stravaData,
        idempotencyKey: "strava:2026-10-04",
      },
    );
    expect((await responseBody(response)).error).toBeUndefined();
    expect(publish).toHaveBeenCalledWith({
      userId: "user-1",
      kind: "strava",
      schemaVersion: 1,
      dataJson: expect.any(String),
      idempotencyKey: "strava:2026-10-04",
    });
    expect(JSON.parse(publish.mock.calls[0]![0].dataJson)).toEqual(
      stravaData,
    );
  });

  it("rejects average power on runs", async () => {
    const { handlers, publish } = makeHandler();
    const response = await handlers.publishWidgetData(
      5,
      "user-1",
      scopes(WIDGETS_WRITE_SCOPE),
      {
        kind: "strava",
        schemaVersion: 1,
        data: {
          ...stravaData,
          latestRun: {
            ...stravaData.latestRun,
            averagePowerWatts: 250,
          },
        },
      },
    );
    const body = await responseBody(response);
    expect(body.error?.code).toBe(-32602);
    expect(body.error?.message).toContain("averagePowerWatts");
    expect(publish).not.toHaveBeenCalled();
  });

  it("publishes normalized upcoming releases", async () => {
    const { handlers, publish } = makeHandler();
    const data = {
      asOf: "2026-10-04",
      releases: [
        {
          kind: "tv",
          title: "Apothecary Diaries",
          detail: "Season 3",
          releaseDate: "2026-10-02",
        },
        {
          kind: "movie",
          title: "The Deceased Empress' Treasure",
          releaseDate: "2026-12-11",
        },
      ],
    };
    const response = await handlers.publishWidgetData(
      6,
      "user-1",
      scopes(WIDGETS_WRITE_SCOPE),
      {
        kind: "releases",
        schemaVersion: 1,
        data,
        idempotencyKey: "releases:2026-10-04",
      },
    );
    expect((await responseBody(response)).error).toBeUndefined();
    expect(publish).toHaveBeenCalledWith({
      userId: "user-1",
      kind: "releases",
      schemaVersion: 1,
      dataJson: JSON.stringify(data),
      idempotencyKey: "releases:2026-10-04",
    });
  });

  it("publishes normalized recurring expenses and category totals", async () => {
    const { handlers, publish } = makeHandler();
    const data = {
      asOf: "2026-10-04",
      currency: "USD" as const,
      upcomingExpenses: [
        {
          name: "Cloud storage",
          monthlyAmount: 2.99,
          category: "Software",
          nextPaymentDate: "2026-10-05",
        },
      ],
      monthlyTotals: {
        month: "2026-10",
        byCategory: [
          { category: "Housing", totalMonthlyAmount: 3200 },
          { category: "Software", totalMonthlyAmount: 42.98 },
        ],
      },
    };
    const response = await handlers.publishWidgetData(
      7,
      "user-1",
      scopes(WIDGETS_WRITE_SCOPE),
      {
        kind: "recurring-expenses",
        schemaVersion: 1,
        data,
        idempotencyKey: "recurring-expenses:2026-10-04",
      },
    );
    expect((await responseBody(response)).error).toBeUndefined();
    expect(publish).toHaveBeenCalledWith({
      userId: "user-1",
      kind: "recurring-expenses",
      schemaVersion: 1,
      dataJson: JSON.stringify(data),
      idempotencyKey: "recurring-expenses:2026-10-04",
    });
  });

  it("requires widgets:read and returns parsed latest data", async () => {
    const { handlers, read } = makeHandler();
    const denied = await handlers.readWidgetData(
      6,
      "user-1",
      scopes(WIDGETS_WRITE_SCOPE),
      { kind: "briefing" },
    );
    expect((await responseBody(denied)).error).toEqual({
      code: -32001,
      message: `Missing required scope: ${WIDGETS_READ_SCOPE}`,
    });
    expect(read).not.toHaveBeenCalled();

    const response = await handlers.readWidgetData(
      7,
      "user-1",
      scopes(WIDGETS_READ_SCOPE),
      { kind: "briefing" },
    );
    const body = await responseBody(response);
    expect(body.error).toBeUndefined();
    expect(read).toHaveBeenCalledWith({
      userId: "user-1",
      kind: "briefing",
    });
    expect(JSON.parse(body.result!.content[0]!.text)).toMatchObject({
      kind: "briefing",
      schemaVersion: 1,
      data: { markdown: "# Morning" },
    });
  });
});
