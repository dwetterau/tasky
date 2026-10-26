import { describe, expect, it } from "vitest";
import { feedSchema } from "@tasky/home-feed";
import { renderEdition } from "../src/rendering/page";
import { fixtureEdition } from "./fixtures";

describe("recurring expenses homepage module", () => {
  it("renders upcoming payments and non-housing category totals", () => {
    const now = Date.parse("2026-10-04T14:00:00Z");
    const edition = fixtureEdition("user-a", 1, now);
    edition.feed.modules.push({
      id: "recurring-expenses",
      schemaVersion: 1,
      scope: "user",
      sourceDataAt: now,
      collectedAt: now,
      freshForMs: 8 * 24 * 60 * 60_000,
      maxAgeMs: 21 * 24 * 60 * 60_000,
      status: "available",
      payload: {
        asOf: "2026-10-04",
        currency: "USD",
        upcomingExpenses: [
          {
            name: "Cloud storage",
            monthlyAmount: 2.99,
            category: "Software",
            nextPaymentDate: "2026-10-05",
          },
          {
            name: "Rent",
            monthlyAmount: 3200,
            category: "Housing",
            nextPaymentDate: "2026-10-15",
          },
          {
            name: "Usage-based service",
            monthlyAmount: 0,
            category: "Utilities",
            nextPaymentDate: "2026-10-06",
          },
        ],
        monthlyTotals: {
          month: "2026-10",
          byCategory: [
            { category: "Housing", totalMonthlyAmount: 3200 },
            { category: "Software", totalMonthlyAmount: 42.98 },
            { category: "Health", totalMonthlyAmount: 75 },
            { category: "Utilities", totalMonthlyAmount: 0 },
          ],
        },
      },
    });
    edition.feed = feedSchema.parse(edition.feed);

    const html = renderEdition(
      edition.feed,
      "https://tasky.example.test",
    );

    expect(html).toContain("Recurring expenses");
    expect(html).toContain("Cloud storage");
    expect(html).toContain("Software");
    expect(html).toContain("$2.99");
    expect(html).toContain("Mon, Oct 5");
    expect(html).toContain("October 2026 by category");
    expect(html).toContain("$42.98");
    expect(html).toContain("<dt>Total</dt><dd>$117.98</dd>");
    expect(html).not.toContain("Rent");
    expect(html).not.toContain("Housing");
    expect(html).not.toContain("$3,200");
    expect(html).not.toContain("Usage-based service");
    expect(html).not.toContain("Utilities");
  });

  it("collapses long sections behind portfolio-style expansion controls", () => {
    const now = Date.parse("2026-10-04T14:00:00Z");
    const edition = fixtureEdition("user-a", 1, now);
    edition.feed.modules.push({
      id: "recurring-expenses",
      schemaVersion: 1,
      scope: "user",
      sourceDataAt: now,
      collectedAt: now,
      freshForMs: 8 * 24 * 60 * 60_000,
      maxAgeMs: 21 * 24 * 60 * 60_000,
      status: "available",
      payload: {
        asOf: "2026-10-04",
        currency: "USD",
        upcomingExpenses: Array.from({ length: 7 }, (_, index) => ({
          name: `Expense ${index + 1}`,
          monthlyAmount: index + 1,
          category: "Software",
          nextPaymentDate: "2026-10-05",
        })),
        monthlyTotals: {
          month: "2026-10",
          byCategory: Array.from({ length: 8 }, (_, index) => ({
            category: `Category ${index + 1}`,
            totalMonthlyAmount: index + 1,
          })),
        },
      },
    });
    edition.feed = feedSchema.parse(edition.feed);

    const html = renderEdition(edition.feed, "https://tasky.example.test");

    expect(html).toContain(
      'data-expense-expand data-total="7" aria-expanded="false">Show all 7',
    );
    expect(html).toContain(
      'data-expense-expand data-total="8" aria-expanded="false">Show all 8',
    );
    expect(html).toContain(
      '.expense-list[data-expanded="false"] li:nth-child(n + 6)',
    );
    expect(html).toContain(
      "[data-expense-category]:nth-child(n + 7)",
    );
  });
});
