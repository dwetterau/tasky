import {
  formatRecurringExpenseAmount,
  formatRecurringExpenseDate,
  formatRecurringExpenseMonth,
  getUpcomingRecurringExpenses,
  getVisibleRecurringExpenseCategoryTotals,
  localDateAt,
  recurringExpensesPayloadSchema,
  widgetDefinitions,
  type RecurringExpensesPayload,
} from "@tasky/home-feed/widgets";
import type { HomeModule } from "../contract";
import { escapeHtml as e } from "../../rendering/html";

export const recurringExpensesModule: HomeModule<RecurringExpensesPayload> = {
  id: "recurring-expenses",
  title: "Recurring expenses",
  placement: "supporting",
  schemaVersion: 1,
  freshForMs: widgetDefinitions["recurring-expenses"].freshForMs,
  maxAgeMs: widgetDefinitions["recurring-expenses"].maxAgeMs,
  parse: (value) => recurringExpensesPayloadSchema.parse(value),
  render(data, context) {
    const today = localDateAt(context.now, context.timezone);
    const upcoming = getUpcomingRecurringExpenses(data, today);
    const categoryTotals = getVisibleRecurringExpenseCategoryTotals(data);
    const upcomingHtml =
      upcoming.length === 0
        ? '<p class="empty">No recurring payments due in the next week.</p>'
        : `<ul class="expense-list">${upcoming
            .map(
              (expense) => `<li>
                <span class="expense-name"><strong>${e(expense.name)}</strong><span>${e(expense.category)}</span></span>
                <span class="expense-amount">${e(formatRecurringExpenseAmount(expense.monthlyAmount, data.currency))}<small>monthly</small></span>
                <time datetime="${e(expense.nextPaymentDate)}">${e(formatRecurringExpenseDate(expense.nextPaymentDate, today))}</time>
              </li>`,
            )
            .join("")}</ul>`;
    const totalsHtml =
      categoryTotals.length === 0
        ? '<p class="empty">No category totals to show.</p>'
        : `<dl class="expense-category-totals">${categoryTotals
            .map(
              (total) =>
                `<div><dt>${e(total.category)}</dt><dd>${e(formatRecurringExpenseAmount(total.totalMonthlyAmount, data.currency))}</dd></div>`,
            )
            .join("")}</dl>`;
    return `<div class="recurring-expenses">
      <section>
        <h3 class="section-label">Due in the next week</h3>
        ${upcomingHtml}
      </section>
      <section>
        <h3 class="section-label">${e(formatRecurringExpenseMonth(data.monthlyTotals.month))} by category</h3>
        ${totalsHtml}
      </section>
    </div>`;
  },
};
