import { z } from "zod";

export const RELEASES_SCHEMA_VERSION = 1 as const;
export const RELEASES_MAX_ITEMS = 24;

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

export const releaseDateSchema = z.union([
  calendarDaySchema,
  calendarMonthSchema,
]);

export const upcomingReleaseSchema = z
  .object({
    kind: z.enum(["tv", "movie"]),
    title: z.string().trim().min(1).max(120),
    detail: z.string().trim().min(1).max(80).optional(),
    releaseDate: releaseDateSchema.describe(
      "Known release date as YYYY-MM-DD, or YYYY-MM when only the month is known.",
    ),
  })
  .strict();

export const releasesPayloadSchema = z
  .object({
    asOf: calendarDaySchema.describe(
      "Date when the agent last checked release information.",
    ),
    releases: z
      .array(upcomingReleaseSchema)
      .max(RELEASES_MAX_ITEMS)
      .describe(
        "Dated upcoming TV and movie releases. Exclude undated and catch-up entries.",
      ),
  })
  .strict();

export type UpcomingRelease = z.infer<typeof upcomingReleaseSchema>;
export type ReleasesPayload = z.infer<typeof releasesPayloadSchema>;

function releaseSortDate(releaseDate: string): string {
  return releaseDate.length === 7 ? `${releaseDate}-01` : releaseDate;
}

export function getUpcomingReleases(
  payload: ReleasesPayload,
  today: string,
  limit = 8,
): UpcomingRelease[] {
  const currentMonth = today.slice(0, 7);
  return payload.releases
    .filter((release) =>
      release.releaseDate.length === 7
        ? release.releaseDate >= currentMonth
        : release.releaseDate >= today,
    )
    .sort(
      (a, b) =>
        releaseSortDate(a.releaseDate).localeCompare(
          releaseSortDate(b.releaseDate),
        ) ||
        a.title.localeCompare(b.title) ||
        (a.detail ?? "").localeCompare(b.detail ?? ""),
    )
    .slice(0, Math.max(0, limit));
}

export function localDateAt(at: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function formatReleaseDate(
  releaseDate: string,
  today: string,
): string {
  if (releaseDate.length === 10 && releaseDate === today) return "Today";
  if (releaseDate.length === 10) {
    const tomorrow = new Date(`${today}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    if (releaseDate === tomorrow.toISOString().slice(0, 10)) {
      return "Tomorrow";
    }
  }
  const date = new Date(
    releaseDate.length === 7
      ? `${releaseDate}-01T00:00:00Z`
      : `${releaseDate}T00:00:00Z`,
  );
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: releaseDate.length === 7 ? "long" : "short",
    ...(releaseDate.length === 10 ? { day: "numeric" as const } : {}),
    ...(releaseDate.slice(0, 4) !== today.slice(0, 4)
      ? { year: "numeric" as const }
      : {}),
  }).format(date);
}
