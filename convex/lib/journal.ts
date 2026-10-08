import { z } from "zod";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";

export const MODEL = "openai/text-embedding-3-small";
export const DIMENSIONS = 1536;
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "Invalid calendar date",
  );
const bounds = {
  date_from: dateSchema.optional(),
  date_to: dateSchema.optional(),
};
const validBounds = (s: { date_from?: string; date_to?: string }) =>
  !s.date_from || !s.date_to || s.date_from <= s.date_to;
export const searchSchema = z
  .object({
    query: z.string().trim().min(1).max(4000),
    mode: z.enum(["semantic", "hybrid"]).default("hybrid"),
    ...bounds,
    limit: z.number().int().min(1).max(50).default(10),
  })
  .strict()
  .refine(validBounds, "Invalid date range");
export const textSchema = z
  .object({
    query: z.string().min(1).max(4000),
    mode: z.enum(["literal", "terms", "phrase"]).default("literal"),
    ...bounds,
    limit: z.number().int().min(1).max(50).default(10),
    cursor: z.string().max(4096).optional(),
  })
  .strict()
  .refine(validBounds, "Invalid date range");
export const listSchema = z
  .object({
    ...bounds,
    limit: z.number().int().min(1).max(100).default(25),
    cursor: z.string().max(4096).optional(),
  })
  .strict()
  .refine(validBounds, "Invalid date range");
export const getSchema = z
  .object({
    dates: z.array(dateSchema).max(100).default([]),
    ids: z.array(z.string().max(256)).max(100).default([]),
  })
  .strict()
  .refine(
    (s) =>
      s.dates.length + s.ids.length > 0 && s.dates.length + s.ids.length <= 100,
    "Provide 1–100 dates/IDs",
  );
export async function settingsFor(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  userId: string,
  requireReadable = true,
) {
  const settings = await ctx.db
    .query("journalSettings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!settings?.enabled || (requireReadable && !settings.readable))
    throw new Error("Journal is not available");
  return settings;
}
export function present(d: Doc<"journalEntries">, excerpt = false) {
  const text = Array.from(d.text);
  return {
    id: d.sourceKey,
    date: d.date,
    text: excerpt ? text.slice(0, 4000).join("") : d.text,
    url: d.url,
    content_hash: d.contentHash,
    kind: "journal",
    text_truncated: excerpt && text.length > 4000,
  };
}
export async function digest(text: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
export function validVector(vector: number[]) {
  return (
    vector.length === DIMENSIONS &&
    vector.every(Number.isFinite) &&
    vector.some((x) => x !== 0)
  );
}
export function cosine(a: number[], b: number[]) {
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return dot / Math.sqrt(aa * bb);
}
export function matches(
  text: string,
  query: string,
  mode: "literal" | "terms" | "phrase",
) {
  if (mode === "literal") return text.includes(query);
  const tokenize = (s: string): string[] =>
    s.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? [];
  const words = tokenize(text),
    terms = tokenize(query);
  if (!terms.length) return false;
  return mode === "terms"
    ? terms.some((t) => words.includes(t))
    : words.some((_, i) => terms.every((t, j) => words[i + j] === t));
}
export async function cursorBinding(
  userId: string,
  input: unknown,
  revision: number,
) {
  return digest(JSON.stringify([userId, input, revision]));
}
export function encodeCursor(signature: string, cursor: string) {
  return JSON.stringify({ signature, cursor });
}
export function decodeCursor(
  input: string | undefined,
  signature: string,
): string | null {
  if (!input) return null;
  try {
    const parsed = JSON.parse(input);
    if (parsed.signature === signature && typeof parsed.cursor === "string")
      return parsed.cursor;
  } catch {
    /* generic error */
  }
  throw new Error("Cursor is invalid or journal changed; restart pagination");
}
