import { z } from "zod";

export const RECURRING_EXPENSES_SCHEMA_VERSION = 1 as const;
export const RECURRING_EXPENSES_MAX_UPCOMING = 40;
export const RECURRING_EXPENSES_MAX_CATEGORIES = 24;
export const RECURRING_EXPENSES_WINDOW_DAYS = 7;

const calendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Invalid calendar date");

const calendarMonthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .refine((value) => {
    const month = Number(value.slice(5, 7));
    return month >= 1 && month <= 12;
  }, "Invalid calendar month");

const categorySchema = z.string().trim().min(1).max(60);
const amountSchema = z.number().nonnegative().max(10_000_000);

export const recurringExpenseSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    monthlyAmount: amountSchema.describe(
      "The expense's normalized monthly cost in the payload currency.",
    ),
    category: categorySchema,
    nextPaymentDate: calendarDaySchema.describe(
      "The next expected payment date as YYYY-MM-DD.",
    ),
  })
  .strict();

export const recurringExpenseCategoryTotalSchema = z
  .object({
    category: categorySchema,
    totalMonthlyAmount: amountSchema.describe(
      "Total normalized monthly cost for this category in the payload currency.",
    ),
  })
  .strict();

export const recurringExpensesPayloadSchema = z
  .object({
    asOf: calendarDaySchema.describe(
      "Date when the recurring-expense information was last checked.",
    ),
    currency: z.literal("USD"),
    upcomingExpenses: z
      .array(recurringExpenseSchema)
      .max(RECURRING_EXPENSES_MAX_UPCOMING)
      .describe(
        "Recurring expenses expected within the next seven days. Clients re-filter this list at render time.",
      ),
    monthlyTotals: z
      .object({
        month: calendarMonthSchema,
        byCategory: z
          .array(recurringExpenseCategoryTotalSchema)
          .max(RECURRING_EXPENSES_MAX_CATEGORIES),
      })
      .strict()
      .superRefine((value, context) => {
        const seen = new Set<string>();
        value.byCategory.forEach((total, index) => {
          const category = total.category.toLocaleLowerCase("en-US");
          if (seen.has(category)) {
            context.addIssue({
              code: "custom",
              path: ["byCategory", index, "category"],
              message: "Category totals must be unique",
            });
          }
          seen.add(category);
        });
      }),
  })
  .strict();

export type RecurringExpense = z.infer<typeof recurringExpenseSchema>;
export type RecurringExpenseCategoryTotal = z.infer<
  typeof recurringExpenseCategoryTotalSchema
>;
export type RecurringExpensesPayload = z.infer<
  typeof recurringExpensesPayloadSchema
>;

function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function getUpcomingRecurringExpenses(
  payload: RecurringExpensesPayload,
  today: string,
): RecurringExpense[] {
  const through = addCalendarDays(today, RECURRING_EXPENSES_WINDOW_DAYS);
  return payload.upcomingExpenses
    .filter(
      (expense) =>
        expense.nextPaymentDate >= today &&
        expense.nextPaymentDate <= through,
    )
    .sort(
      (a, b) =>
        a.nextPaymentDate.localeCompare(b.nextPaymentDate) ||
        a.name.localeCompare(b.name) ||
        a.category.localeCompare(b.category),
    );
}

export function getVisibleRecurringExpenseCategoryTotals(
  payload: RecurringExpensesPayload,
): RecurringExpenseCategoryTotal[] {
  return payload.monthlyTotals.byCategory
    .filter(
      (total) =>
        total.category.trim().toLocaleLowerCase("en-US") !== "housing",
    )
    .sort(
      (a, b) =>
        b.totalMonthlyAmount - a.totalMonthlyAmount ||
        a.category.localeCompare(b.category),
    );
}

export function formatRecurringExpenseAmount(
  amount: number,
  currency: "USD",
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatRecurringExpenseDate(
  date: string,
  today: string,
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(date.slice(0, 4) !== today.slice(0, 4)
      ? { year: "numeric" as const }
      : {}),
  }).format(new Date(`${date}T00:00:00Z`));
}

export function formatRecurringExpenseMonth(month: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(`${month}-01T00:00:00Z`));
}
