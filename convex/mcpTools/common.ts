const jsonHeaders = {
  "content-type": "application/json",
  "cache-control": "private, no-store",
} as const;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

export function mcpError(id: unknown, code: number, message: string): Response {
  return jsonResponse({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

export function mcpToolResult(
  id: unknown,
  payload: unknown,
  options: { compact?: boolean } = {},
): Response {
  return jsonResponse({
    jsonrpc: "2.0",
    id,
    result: {
      content: [
        {
          type: "text",
          // Large tabular payloads skip indentation, which otherwise triples
          // their size for the model reading them.
          text: options.compact
            ? JSON.stringify(payload)
            : JSON.stringify(payload, null, 2),
        },
      ],
    },
  });
}

export type McpToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint: boolean };
};
