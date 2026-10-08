import { getServiceToken } from "convex/server";
import { internalAction } from "./_generated/server";
import { DIMENSIONS, MODEL, validVector } from "./lib/journal";

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (
    texts.length < 1 ||
    texts.length > 32 ||
    texts.some((s) => !s.trim() || new TextEncoder().encode(s).length > 24000)
  )
    throw new Error("Embedding input exceeds configured bounds");
  const token = await getServiceToken("ai-gateway");
  const response = await fetch("https://ai-gateway.convex.dev/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      input: texts,
      dimensions: DIMENSIONS,
      encoding_format: "float",
    }),
    signal: AbortSignal.timeout(45_000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(`Embedding service HTTP ${response.status}`);
  const body = (await response.json()) as {
    data?: Array<{ index: number; embedding: number[] }>;
    model?: string;
  };
  const rows = body.data?.slice().sort((a, b) => a.index - b.index);
  if (
    !rows ||
    rows.length !== texts.length ||
    rows.some((r, i) => r.index !== i || !validVector(r.embedding))
  )
    throw new Error("Invalid embedding response");
  if (body.model && ![MODEL, "text-embedding-3-small"].includes(body.model))
    throw new Error("Embedding model mismatch");
  return rows.map((r) => r.embedding);
}
// Operator-only entitlement probe. Never reads private records or returns vectors.
export const probe = internalAction({
  args: {},
  handler: async () => {
    const vectors = await embedTexts([
      "Synthetic journal search readiness check.",
    ]);
    return { model: MODEL, dimensions: vectors[0].length, ready: true };
  },
});
