import { z } from "zod";

export const ON_THIS_DAY_SCHEMA_VERSION = 1 as const;
export const ON_THIS_DAY_MAX_MARKDOWN_LENGTH = 16_000;

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

export const onThisDayPayloadSchema = z
  .object({
    date: calendarDaySchema.describe(
      "The local calendar date this journal retrospective is for.",
    ),
    markdown: z
      .string()
      .trim()
      .min(1, "On-this-day markdown cannot be empty")
      .max(
        ON_THIS_DAY_MAX_MARKDOWN_LENGTH,
        `On-this-day markdown cannot exceed ${ON_THIS_DAY_MAX_MARKDOWN_LENGTH} characters`,
      )
      .describe(
        "Markdown bullet list of facts from journal entries on this date in prior years. Raw HTML is not supported.",
      ),
  })
  .strict();

export type OnThisDayPayload = z.infer<typeof onThisDayPayloadSchema>;

export function formatOnThisDayDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}
