import { z } from "zod";
import {
  STRAVA_SCHEMA_VERSION,
  stravaPayloadSchema,
  type StravaPayload,
} from "./widgets/strava";
import {
  RELEASES_SCHEMA_VERSION,
  releasesPayloadSchema,
  type ReleasesPayload,
} from "./widgets/releases";
import {
  RECURRING_EXPENSES_SCHEMA_VERSION,
  recurringExpensesPayloadSchema,
  type RecurringExpensesPayload,
} from "./widgets/recurring-expenses";

export {
  formatStravaDistance,
  formatStravaDuration,
  formatStravaElevationGain,
  formatStravaPace,
  getStravaActivityStats,
  STRAVA_SCHEMA_VERSION,
  stravaActivitySchema,
  stravaPayloadSchema,
  type StravaActivity,
  type StravaPayload,
} from "./widgets/strava";
export {
  formatReleaseDate,
  getUpcomingReleases,
  localDateAt,
  RELEASES_MAX_ITEMS,
  RELEASES_SCHEMA_VERSION,
  releaseDateSchema,
  releasesPayloadSchema,
  upcomingReleaseSchema,
  type ReleasesPayload,
  type UpcomingRelease,
} from "./widgets/releases";
export {
  formatRecurringExpenseAmount,
  formatRecurringExpenseDate,
  formatRecurringExpenseMonth,
  getUpcomingRecurringExpenses,
  getVisibleRecurringExpenseCategoryTotals,
  RECURRING_EXPENSES_MAX_CATEGORIES,
  RECURRING_EXPENSES_MAX_UPCOMING,
  RECURRING_EXPENSES_SCHEMA_VERSION,
  RECURRING_EXPENSES_WINDOW_DAYS,
  recurringExpenseCategoryTotalSchema,
  recurringExpenseSchema,
  recurringExpensesPayloadSchema,
  type RecurringExpense,
  type RecurringExpenseCategoryTotal,
  type RecurringExpensesPayload,
} from "./widgets/recurring-expenses";

export const WIDGET_KINDS = [
  "briefing",
  "strava",
  "releases",
  "recurring-expenses",
] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

export const BRIEFING_SCHEMA_VERSION = 1 as const;
export const BRIEFING_MAX_MARKDOWN_LENGTH = 16_000;
export const WIDGET_DATA_MAX_BYTES = 32_000;

export const briefingPayloadSchema = z
  .object({
    markdown: z
      .string()
      .trim()
      .min(1, "Briefing markdown cannot be empty")
      .max(
        BRIEFING_MAX_MARKDOWN_LENGTH,
        `Briefing markdown cannot exceed ${BRIEFING_MAX_MARKDOWN_LENGTH} characters`,
      )
      .describe(
        "Markdown briefing text. Raw HTML is not supported; keep headings and lists concise.",
      ),
  })
  .strict();

export const widgetDefinitions = {
  briefing: {
    schemaVersion: BRIEFING_SCHEMA_VERSION,
    payloadSchema: briefingPayloadSchema,
    freshForMs: 18 * 60 * 60_000,
    maxAgeMs: 7 * 24 * 60 * 60_000,
  },
  strava: {
    schemaVersion: STRAVA_SCHEMA_VERSION,
    payloadSchema: stravaPayloadSchema,
    freshForMs: 30 * 60 * 60_000,
    maxAgeMs: 7 * 24 * 60 * 60_000,
  },
  releases: {
    schemaVersion: RELEASES_SCHEMA_VERSION,
    payloadSchema: releasesPayloadSchema,
    freshForMs: 8 * 24 * 60 * 60_000,
    maxAgeMs: 21 * 24 * 60 * 60_000,
  },
  "recurring-expenses": {
    schemaVersion: RECURRING_EXPENSES_SCHEMA_VERSION,
    payloadSchema: recurringExpensesPayloadSchema,
    freshForMs: 8 * 24 * 60 * 60_000,
    maxAgeMs: 21 * 24 * 60 * 60_000,
  },
} as const;

export const widgetDataReadInputSchema = z
  .object({
    kind: z
      .enum(WIDGET_KINDS)
      .describe("The registered widget kind whose newest row should be read."),
  })
  .strict();

export const widgetDataInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z
        .literal("briefing")
        .describe("The registered widget kind to publish."),
      schemaVersion: z
        .literal(BRIEFING_SCHEMA_VERSION)
        .describe("The payload schema version expected by clients."),
      data: briefingPayloadSchema,
      idempotencyKey: z
        .string()
        .trim()
        .min(1, "idempotencyKey cannot be empty")
        .max(160, "idempotencyKey cannot exceed 160 characters")
        .describe(
          "Optional retry key, for example briefing:2026-09-30:morning. Reusing it with different data is rejected.",
        )
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z
        .literal("strava")
        .describe("The latest Strava activities widget."),
      schemaVersion: z
        .literal(STRAVA_SCHEMA_VERSION)
        .describe("The payload schema version expected by clients."),
      data: stravaPayloadSchema,
      idempotencyKey: z
        .string()
        .trim()
        .min(1, "idempotencyKey cannot be empty")
        .max(160, "idempotencyKey cannot exceed 160 characters")
        .describe(
          "Optional retry key, for example strava:2026-10-04. Reusing it with different data is rejected.",
        )
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z
        .literal("releases")
        .describe("Dated upcoming TV and movie releases."),
      schemaVersion: z
        .literal(RELEASES_SCHEMA_VERSION)
        .describe("The payload schema version expected by clients."),
      data: releasesPayloadSchema,
      idempotencyKey: z
        .string()
        .trim()
        .min(1, "idempotencyKey cannot be empty")
        .max(160, "idempotencyKey cannot exceed 160 characters")
        .describe(
          "Optional retry key, for example releases:2026-10-04. Reusing it with different data is rejected.",
        )
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z
        .literal("recurring-expenses")
        .describe("Recurring expenses due soon and monthly category totals."),
      schemaVersion: z
        .literal(RECURRING_EXPENSES_SCHEMA_VERSION)
        .describe("The payload schema version expected by clients."),
      data: recurringExpensesPayloadSchema,
      idempotencyKey: z
        .string()
        .trim()
        .min(1, "idempotencyKey cannot be empty")
        .max(160, "idempotencyKey cannot exceed 160 characters")
        .describe(
          "Optional retry key, for example recurring-expenses:2026-10-04. Reusing it with different data is rejected.",
        )
        .optional(),
    })
    .strict(),
]);

export type BriefingPayload = z.infer<typeof briefingPayloadSchema>;
export type WidgetDataReadInput = z.infer<typeof widgetDataReadInputSchema>;
export type WidgetDataInput = z.infer<typeof widgetDataInputSchema>;
export type WidgetPayload =
  | BriefingPayload
  | StravaPayload
  | ReleasesPayload
  | RecurringExpensesPayload;

export function parseWidgetData(
  kind: WidgetKind,
  schemaVersion: number,
  data: unknown,
): WidgetPayload {
  const definition = widgetDefinitions[kind];
  if (schemaVersion !== definition.schemaVersion) {
    throw new Error(
      `Unsupported ${kind} schemaVersion: ${schemaVersion}. Expected ${definition.schemaVersion}.`,
    );
  }
  return definition.payloadSchema.parse(data);
}
