// Portfolio names, tickers and figures below are synthetic.
import { describe, expect, it, vi } from "vitest";
import { PORTFOLIO_READ_SCOPE, type ParsedMcpScopes } from "./mcpScopes";
import {
  createPortfolioToolHandlers,
  portfolioToolDescriptors,
  type PortfolioExecutors,
  type PortfolioSnapshotHistory,
} from "./mcpTools/portfolio";

type JsonRpcBody = {
  error?: { code: number; message: string };
  result?: { content: Array<{ type: string; text: string }> };
};

function scopes(...values: string[]): ParsedMcpScopes {
  return { scopes: new Set(values) };
}

function day(date: string, quantity: number, value: number) {
  return {
    date,
    totalValue: value + 50,
    totalCostBasis: 100,
    accounts: [],
    holdings: [
      { ticker: "AAA", name: "Example Fund", quantity, value, costBasis: 80 },
      { ticker: "", name: "Cash", quantity: 0, value: 50, costBasis: 20 },
    ],
  };
}

const source: PortfolioSnapshotHistory = {
  portfolios: ["Example"],
  availablePortfolios: ["Example"],
  history: {
    status: "ok",
    startDate: "2026-03-01",
    points: [
      day("2026-03-02", 10, 100),
      day("2026-03-03", 10, 110),
      day("2026-03-04", 5, 55),
    ],
  },
};

function setup(result: PortfolioSnapshotHistory = source) {
  const history = vi.fn<PortfolioExecutors["history"]>(async () => result);
  const handlers = createPortfolioToolHandlers({ history }, () =>
    Date.parse("2026-03-04T15:00:00Z"),
  );
  const call = async (args: unknown, granted = [PORTFOLIO_READ_SCOPE]) => {
    const response = await handlers.readPortfolioSnapshots!(
      1,
      "user",
      scopes(...granted),
      args,
    );
    const body = (await response.json()) as JsonRpcBody;
    return {
      error: body.error,
      data: body.result ? JSON.parse(body.result.content[0]!.text) : undefined,
    };
  };
  return { history, call };
}

describe("portfolio MCP tool", () => {
  it("is only listed and callable with the portfolio scope", async () => {
    expect(portfolioToolDescriptors(scopes("tasks:read"))).toEqual([]);
    expect(
      portfolioToolDescriptors(scopes(PORTFOLIO_READ_SCOPE)).map(
        (tool) => tool.name,
      ),
    ).toEqual(["readPortfolioSnapshots"]);

    const { history, call } = setup();
    const { error } = await call({}, ["tasks:read"]);
    expect(error?.code).toBe(-32001);
    expect(history).not.toHaveBeenCalled();
  });

  it("defaults to the last 30 days and splits each holding's change", async () => {
    const { history, call } = setup();
    const { data } = await call(undefined);

    expect(history).toHaveBeenCalledWith({
      userId: "user",
      startDate: "2026-02-02",
      portfolioName: undefined,
    });
    expect(data.total).toEqual({
      startValue: 150,
      endValue: 105,
      priceEffect: 10,
      quantityEffect: -55,
    });
    expect(data.changes[0]).toMatchObject({
      ticker: "AAA",
      name: "Example Fund",
      startQuantity: 10,
      endQuantity: 5,
      startPrice: 10,
      endPrice: 11,
      priceEffect: 10,
      quantityEffect: -55,
    });
    expect(data.days).toHaveLength(3);
    expect(data.days[0]).not.toHaveProperty("holdings");
  });

  it("clips to the requested dates and filters holdings by ticker", async () => {
    const { call } = setup();
    const { data } = await call({
      startDate: "2026-03-03",
      endDate: "2026-03-03",
      detail: "holdings",
      tickers: [""],
    });
    expect(data.days).toEqual([
      {
        date: "2026-03-03",
        totalValue: 160,
        totalCostBasis: 100,
        holdings: [
          { ticker: "Cash", quantity: 0, value: 50, costBasis: 20, price: null },
        ],
      },
    ]);
    expect(data.changes.map((row: { ticker: string }) => row.ticker)).toEqual([
      "Cash",
    ]);
  });

  it("rejects bad arguments and unknown portfolios", async () => {
    const { call } = setup({
      ...source,
      portfolios: [],
      history: { status: "ok", startDate: null, points: [] },
    });
    expect((await call({ startDate: "March" })).error?.code).toBe(-32602);
    expect(
      (await call({ startDate: "2026-03-05", endDate: "2026-03-01" })).error
        ?.message,
    ).toContain("startDate");
    expect((await call({ portfolio: "Missing" })).error?.message).toContain(
      "Available: Example",
    );
  });

  it("surfaces an unavailable history as an error", async () => {
    const { call } = setup({
      ...source,
      history: {
        status: "no_credentials",
        message: "Add credentials",
        startDate: null,
        points: [],
      },
    });
    expect((await call({})).error).toEqual({
      code: -32000,
      message: "Add credentials",
    });
  });
});
