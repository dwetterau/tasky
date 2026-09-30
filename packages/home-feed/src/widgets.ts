import { z } from "zod";

export const WIDGET_KINDS = ["briefing"] as const;
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
]);

export type BriefingPayload = z.infer<typeof briefingPayloadSchema>;
export type WidgetDataReadInput = z.infer<typeof widgetDataReadInputSchema>;
export type WidgetDataInput = z.infer<typeof widgetDataInputSchema>;

export function parseWidgetData(
  kind: WidgetKind,
  schemaVersion: number,
  data: unknown,
): BriefingPayload {
  if (kind !== "briefing") {
    throw new Error(`Unsupported widget kind: ${kind}`);
  }
  if (schemaVersion !== BRIEFING_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported briefing schemaVersion: ${schemaVersion}. Expected ${BRIEFING_SCHEMA_VERSION}.`,
    );
  }
  return briefingPayloadSchema.parse(data);
}
