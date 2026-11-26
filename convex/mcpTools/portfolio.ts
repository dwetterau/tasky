import { z } from "zod";
import type { PortfolioSnapshotHistoryPoint } from "../lib/accountSnapshots";
import { attributeChanges, holdingKey } from "../lib/portfolioAttribution";
import {
  hasRequiredScope,
  PORTFOLIO_READ_SCOPE,
  type ParsedMcpScopes,
} from "../mcpScopes";
import { mcpError, mcpToolResult, type McpToolDescriptor } from "./common";

const DEFAULT_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), {
    message: "Expected a real calendar date",
  });

export const portfolioSnapshotsInputSchema = z
  .object({
    startDate: isoDate
      .optional()
      .describe(
        `First snapshot date to return (YYYY-MM-DD). Defaults to ${DEFAULT_WINDOW_DAYS} days before endDate.`,
      ),
    endDate: isoDate
      .optional()
      .describe("Last snapshot date to return (YYYY-MM-DD). Defaults to today."),
    portfolio: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Portfolio name, matched case-insensitively. Omit to combine every configured portfolio.",
      ),
    tickers: z
      .array(z.string().trim())
      .max(100)
      .optional()
      .describe(
        'Only return these tickers in holdings and changes. Use "" for cash. Totals always cover the whole portfolio.',
      ),
    detail: z
      .enum(["changes", "totals", "holdings"])
      .optional()
      .describe(
        "changes (default): daily totals plus each holding's change over the window. totals: daily totals only. holdings: adds every holding to every day, which is large.",
      ),
  })
  .strict();

type PortfolioSnapshotsInput = z.infer<typeof portfolioSnapshotsInputSchema>;

export type PortfolioSnapshotHistory = {
  portfolios: string[];
  availablePortfolios: string[];
  history: {
    status: "ok" | "no_credentials" | "airtable_error";
    message?: string;
    startDate: string | null;
    points: PortfolioSnapshotHistoryPoint[];
  };
};

export type PortfolioExecutors = {
  history: (args: {
    userId: string;
    startDate?: string;
    portfolioName?: string;
  }) => Promise<PortfolioSnapshotHistory>;
};

type PortfolioToolHandler = (
  rpcId: unknown,
  sessionUserId: string,
  parsedScopes: ParsedMcpScopes,
  rawArgs: unknown,
) => Promise<Response>;

const inputSchema = z.toJSONSchema(portfolioSnapshotsInputSchema, {
  io: "input",
});
delete inputSchema.$schema;

const descriptors: McpToolDescriptor[] = [
  {
    name: "readPortfolioSnapshots",
    description:
      "Read daily portfolio snapshots: total value and cost basis per day, and for each holding its share count, value and price. Each holding's change over the window is split into priceEffect (the price moved) and quantityEffect (shares were bought, sold or otherwise changed); the two sum to the change in value. Only days where every account has a snapshot are returned.",
    inputSchema,
    annotations: { readOnlyHint: true },
  },
];

/** The tool is only advertised to sessions that were granted the scope. */
export function portfolioToolDescriptors(
  scopes: ParsedMcpScopes,
): McpToolDescriptor[] {
  return hasRequiredScope(scopes, PORTFOLIO_READ_SCOPE) ? descriptors : [];
}

function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

function shares(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function price(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10_000) / 10_000;
}

function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function buildPortfolioSnapshotsResult(
  input: PortfolioSnapshotsInput,
  source: PortfolioSnapshotHistory,
  startDate: string,
  endDate: string,
) {
  const detail = input.detail ?? "changes";
  const wanted = input.tickers
    ? new Set(input.tickers.map(holdingKey))
    : null;
  const includes = (ticker: string) =>
    wanted === null || wanted.has(holdingKey(ticker));
  const points = source.history.points.filter(
    (point) => point.date >= startDate && point.date <= endDate,
  );
  const names = new Map<string, string>();
  for (const point of points) {
    for (const holding of point.holdings) {
      if (holding.name) names.set(holdingKey(holding.ticker), holding.name);
    }
  }
  const attribution = attributeChanges(points);

  return {
    portfolios: source.portfolios,
    startDate: points[0]?.date ?? null,
    endDate: points.at(-1)?.date ?? null,
    snapshotDays: points.length,
    total: {
      startValue: cents(attribution.total.startValue),
      endValue: cents(attribution.total.endValue),
      priceEffect: cents(attribution.total.priceEffect),
      quantityEffect: cents(attribution.total.quantityEffect),
    },
    ...(detail === "totals"
      ? {}
      : {
          changes: attribution.holdings
            .filter((holding) => includes(holding.key))
            .map((holding) => ({
              ticker: holding.key || "Cash",
              name: names.get(holding.key) ?? "",
              startValue: cents(holding.startValue),
              endValue: cents(holding.endValue),
              startQuantity: shares(holding.startQuantity),
              endQuantity: shares(holding.endQuantity),
              startPrice: price(holding.startPrice),
              endPrice: price(holding.endPrice),
              priceEffect: cents(holding.priceEffect),
              quantityEffect: cents(holding.quantityEffect),
            })),
        }),
    days: points.map((point) => ({
      date: point.date,
      totalValue: cents(point.totalValue),
      totalCostBasis: cents(point.totalCostBasis),
      ...(detail === "holdings"
        ? {
            holdings: point.holdings
              .filter((holding) => includes(holding.ticker))
              .map((holding) => ({
                ticker: holding.ticker || "Cash",
                quantity: shares(holding.quantity),
                value: cents(holding.value),
                costBasis: cents(holding.costBasis),
                price: price(
                  holding.ticker && holding.quantity > 0 && holding.value > 0
                    ? holding.value / holding.quantity
                    : null,
                ),
              })),
          }
        : {}),
    })),
  };
}

export function createPortfolioToolHandlers(
  executors: PortfolioExecutors,
  now: () => number = Date.now,
): Record<string, PortfolioToolHandler> {
  return {
    readPortfolioSnapshots: async (
      rpcId,
      sessionUserId,
      parsedScopes,
      rawArgs,
    ) => {
      if (!hasRequiredScope(parsedScopes, PORTFOLIO_READ_SCOPE)) {
        return mcpError(
          rpcId,
          -32001,
          `Missing required scope: ${PORTFOLIO_READ_SCOPE}`,
        );
      }
      const parsed = portfolioSnapshotsInputSchema.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        return mcpError(
          rpcId,
          -32602,
          parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`)
            .join("\n"),
        );
      }
      const endDate =
        parsed.data.endDate ?? new Date(now()).toISOString().slice(0, 10);
      const startDate =
        parsed.data.startDate ?? shiftDays(endDate, -DEFAULT_WINDOW_DAYS);
      if (startDate > endDate) {
        return mcpError(rpcId, -32602, "startDate must not be after endDate");
      }
      try {
        const source = await executors.history({
          userId: sessionUserId,
          startDate,
          portfolioName: parsed.data.portfolio,
        });
        if (parsed.data.portfolio && source.portfolios.length === 0) {
          return mcpError(
            rpcId,
            -32602,
            `No portfolio named "${parsed.data.portfolio}". Available: ${
              source.availablePortfolios.join(", ") || "none configured"
            }.`,
          );
        }
        if (source.history.status !== "ok") {
          return mcpError(
            rpcId,
            -32000,
            source.history.message ?? "Portfolio snapshots are unavailable",
          );
        }
        return mcpToolResult(
          rpcId,
          buildPortfolioSnapshotsResult(
            parsed.data,
            source,
            startDate,
            endDate,
          ),
          { compact: true },
        );
      } catch (error) {
        return mcpError(
          rpcId,
          -32000,
          error instanceof Error ? error.message : "Portfolio read failed",
        );
      }
    },
  };
}
