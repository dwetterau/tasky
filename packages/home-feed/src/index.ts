import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";

export const VERSION = 1 as const;
export const LIMITS = {
  tasks: 12,
  captures: 6,
  signals: 12,
  scorecards: 8,
  text: 240,
  bytes: 96_000,
} as const;
export const identitySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
const timestamp = z.number().int().nonnegative();
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const text = z.string().max(LIMITS.text);
const id = z.string().min(1).max(128);
export const timezoneSchema = z
  .string()
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Invalid IANA timezone");
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Invalid calendar date");
export const taskSchema = z
  .object({
    id,
    title: text,
    status: z.enum(["not_started", "in_progress", "agent_running", "blocked"]),
    priority: z.enum(["triage", "low", "medium", "high", "urgent"]),
    dueDate: localDateSchema.optional(),
    due: z.enum(["overdue", "today", "upcoming", "later", "none"]),
    labels: z.array(z.string().max(60)).max(3),
  })
  .strict();
export const signalSchema = z
  .object({
    id,
    name: text,
    kind: z.enum(["activity", "inventory"]),
    attention: z.enum(["ok", "soon", "due", "unknown"]),
    reason: text,
    ratio: z.number().min(0).max(1),
    isComplete: z.boolean(),
    todayCount: z.number().int().nonnegative().default(0),
  })
  .strict();
export const scorecardSchema = z
  .object({
    id,
    name: text,
    ratio: z.number().min(0).max(1),
    isComplete: z.boolean(),
    count: z.number().nonnegative(),
    target: z.number().positive().optional(),
  })
  .strict();
export const taskyPayloadSchema = z
  .object({
    localDate: localDateSchema,
    tasks: z.array(taskSchema).max(LIMITS.tasks),
    captures: z
      .array(z.object({ id, text, createdAt: timestamp }).strict())
      .max(LIMITS.captures),
    signals: z.array(signalSchema).max(LIMITS.signals),
    scorecards: z.array(scorecardSchema).max(LIMITS.scorecards),
    counts: z
      .object({
        active: z.number().int().nonnegative(),
        overdue: z.number().int().nonnegative(),
        dueToday: z.number().int().nonnegative(),
        captures: z.number().int().nonnegative(),
      })
      .strict(),
    truncated: z.boolean(),
  })
  .strict();
export const portfolioPayloadSchema = z
  .object({
    currency: z.literal("USD"),
    totalValue: z.number(),
    gainLoss: z.number(),
    gainLossPercent: z.number(),
    holdingsCount: z.number().int().nonnegative(),
    holdings: z
      .array(
        z
          .object({
            ticker: z.string().max(24),
            name: text,
            value: z.number(),
            allocation: z.number(),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();
export type PortfolioPayload = z.infer<typeof portfolioPayloadSchema>;

export const weatherPayloadSchema = z
  .object({
    location: z.string().max(120),
    units: z.enum(["F", "C"]),
    current: z
      .object({
        temperature: z.number(),
        description: text,
        observedAt: timestamp,
        isDay: z.boolean().optional(),
      })
      .strict()
      .nullable(),
    forecast: z
      .array(
        z
          .object({
            date: z.string().datetime({ offset: true }),
            high: z.number(),
            low: z.number(),
            description: text,
          })
          .strict(),
      )
      .max(5),
    forecastObservedAt: timestamp.nullable(),
    attributionUrl: z
      .url()
      .refine((value) => new URL(value).protocol === "https:"),
  })
  .strict();

export const moduleSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
    schemaVersion: z.literal(1),
    scope: z.enum(["user", "shared"]),
    sourceRevision: revision.optional(),
    sourceDataAt: timestamp.nullable(),
    collectedAt: timestamp.nullable(),
    freshForMs: z.number().positive(),
    maxAgeMs: z.number().positive(),
    status: z.enum(["available", "stale", "unavailable", "disabled"]),
    error: z
      .enum([
        "collection_failed",
        "configuration",
        "rate_limited",
        "awaiting_data",
      ])
      .optional(),
    payload: z.unknown().nullable(),
  })
  .strict()
  .refine((m) => m.maxAgeMs >= m.freshForMs);
export const exportSchema = z
  .object({
    schemaVersion: z.literal(VERSION),
    exportId: id,
    userId: identitySchema,
    sourceRevision: revision,
    exportedAt: timestamp,
    timezone: timezoneSchema,
    payload: taskyPayloadSchema,
    portfolio: moduleSchema
      .refine((module) => module.id === "portfolio")
      .optional(),
  })
  .strict();

export const feedSchema = z
  .object({
    schemaVersion: z.literal(VERSION),
    userId: identitySchema,
    revision,
    publishedAt: timestamp,
    timezone: timezoneSchema,
    displayName: z.string().max(80),
    modules: z.array(moduleSchema).max(20),
  })
  .strict();
export const editionSchema = z
  .object({
    schemaVersion: z.literal(VERSION),
    feed: feedSchema,
    html: z.string().max(500_000),
  })
  .strict();
export type TaskyPayload = z.infer<typeof taskyPayloadSchema>;
export type WeatherPayload = z.infer<typeof weatherPayloadSchema>;
export type TaskyExport = z.infer<typeof exportSchema>;
export type ModuleSnapshot = z.infer<typeof moduleSchema>;
export type Feed = z.infer<typeof feedSchema>;
export type Edition = z.infer<typeof editionSchema>;

export function withFreshness(
  module: ModuleSnapshot,
  now: number,
): ModuleSnapshot {
  if (module.status === "disabled") return module;
  if (!module.payload || module.sourceDataAt === null)
    return { ...module, status: "unavailable" };
  const age = Math.max(0, now - module.sourceDataAt);
  return {
    ...module,
    status:
      age > module.maxAgeMs
        ? "unavailable"
        : age > module.freshForMs
          ? "stale"
          : "available",
  };
}

/** Calendar bounds in the user's timezone, including DST and Monday-start weeks. */
export function calendar(now: number, timezone: string) {
  const date =
    Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(timezone);
  const day = date.startOfDay();
  const week = day.subtract({ days: day.dayOfWeek - 1 });
  const month = day.with({ day: 1 });
  const range = (start: typeof day, end: typeof day) => ({
    startAt: start.epochMilliseconds,
    endAt: end.epochMilliseconds,
  });
  return {
    localDate: day.toPlainDate().toString(),
    upcomingDate: day.add({ days: 7 }).toPlainDate().toString(),
    day: range(day, day.add({ days: 1 })),
    week: range(week, week.add({ weeks: 1 })),
    month: range(month, month.add({ months: 1 })),
  };
}

/** Plain text only: no source HTML/Markdown is rendered as markup. */
export function summary(value: string, limit: number = LIMITS.text) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*_`>~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}
