import { describe, expect, it } from "vitest";
import {
  formatRecurringExpenseAmount,
  formatRecurringExpenseDate,
  formatRecurringExpenseMonth,
  getUpcomingRecurringExpenses,
  getVisibleRecurringExpenseCategoryTotals,
  recurringExpensesPayloadSchema,
  type RecurringExpensesPayload,
} from "./recurring-expenses";

const payload: RecurringExpensesPayload = {
  asOf: "2026-10-04",
  currency: "USD",
  upcomingExpenses: [
    {
      name: "Already paid",
      monthlyAmount: 10,
      category: "Software",
      nextPaymentDate: "2026-10-03",
    },
    {
      name: "Cloud storage",
      monthlyAmount: 2.99,
      category: "Software",
      nextPaymentDate: "2026-10-05",
    },
    {
      name: "Gym",
      monthlyAmount: 75,
      category: "Health",
      nextPaymentDate: "2026-10-11",
    },
    {
      name: "Later",
      monthlyAmount: 20,
      category: "Entertainment",
      nextPaymentDate: "2026-10-12",
    },
  ],
  monthlyTotals: {
    month: "2026-10",
    byCategory: [
      { category: "Software", totalMonthlyAmount: 42.98 },
      { category: "Housing", totalMonthlyAmount: 3200 },
      { category: "Health", totalMonthlyAmount: 75 },
    ],
  },
};

describe("recurring expenses widget", () => {
  it("validates strict dates, amounts, and unique category totals", () => {
    expect(recurringExpensesPayloadSchema.parse(payload)).toEqual(payload);
    expect(() =>
      recurringExpensesPayloadSchema.parse({
        ...payload,
        upcomingExpenses: [
          {
            name: "Impossible",
            monthlyAmount: 10,
            category: "Software",
            nextPaymentDate: "2026-02-30",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      recurringExpensesPayloadSchema.parse({
        ...payload,
        monthlyTotals: {
          ...payload.monthlyTotals,
          byCategory: [
            { category: "Software", totalMonthlyAmount: 42.98 },
            { category: "software", totalMonthlyAmount: 10 },
          ],
        },
      }),
    ).toThrow("Category totals must be unique");
  });

  it("keeps only payments from today through seven days ahead", () => {
    expect(
      getUpcomingRecurringExpenses(payload, "2026-10-04").map(
        (expense) => expense.name,
      ),
    ).toEqual(["Cloud storage", "Gym"]);
  });

  it("hides housing only from the rendered category summary", () => {
    expect(
      getVisibleRecurringExpenseCategoryTotals(payload).map(
        (total) => total.category,
      ),
    ).toEqual(["Health", "Software"]);
    expect(payload.monthlyTotals.byCategory).toContainEqual({
      category: "Housing",
      totalMonthlyAmount: 3200,
    });
  });

  it("formats money and calendar labels consistently", () => {
    expect(formatRecurringExpenseAmount(75, "USD")).toBe("$75");
    expect(formatRecurringExpenseAmount(2.99, "USD")).toBe("$2.99");
    expect(formatRecurringExpenseDate("2026-10-05", "2026-10-04")).toBe(
      "Mon, Oct 5",
    );
    expect(formatRecurringExpenseMonth("2026-10")).toBe("October 2026");
  });
});
