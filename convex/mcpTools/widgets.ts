import { z } from "zod";
import type { Id } from "../_generated/dataModel";
import {
  hasRequiredScope,
  WIDGETS_READ_SCOPE,
  WIDGETS_WRITE_SCOPE,
  type ParsedMcpScopes,
} from "../mcpScopes";
import {
  WIDGET_DATA_MAX_BYTES,
  WIDGET_KINDS,
  parseWidgetData,
  widgetDataInputSchema,
  widgetDataReadInputSchema,
  type WidgetDataInput,
} from "../../packages/home-feed/src/widgets";
import { mcpError, mcpToolResult, type McpToolDescriptor } from "./common";

type PublishWidgetResult = {
  id: Id<"widgetData">;
  createdAt: number;
  duplicate: boolean;
};

type ReadWidgetResult = {
  id: Id<"widgetData">;
  createdAt: number;
  kind: WidgetDataInput["kind"];
  schemaVersion: number;
  dataJson: string;
} | null;

type WidgetToolHandler = (
  rpcId: unknown,
  sessionUserId: string,
  parsedScopes: ParsedMcpScopes,
  rawArgs: unknown,
) => Promise<Response>;

export type WidgetExecutors = {
  read: (args: {
    userId: string;
    kind: WidgetDataInput["kind"];
  }) => Promise<ReadWidgetResult>;
  publish: (args: {
    userId: string;
    kind: WidgetDataInput["kind"];
    schemaVersion: number;
    dataJson: string;
    idempotencyKey?: string;
  }) => Promise<PublishWidgetResult>;
};

const generatedInputSchema = z.toJSONSchema(widgetDataInputSchema);
delete generatedInputSchema.$schema;
// MCP Tool.inputSchema must itself be an object schema. Zod emits a root
// `oneOf` for discriminated unions, which some clients reject unless the
// common object type is stated explicitly.
generatedInputSchema.type = "object";
const generatedReadInputSchema = z.toJSONSchema(widgetDataReadInputSchema);
delete generatedReadInputSchema.$schema;

export const widgetToolDescriptors: McpToolDescriptor[] = [
  {
    name: "readWidgetData",
    description:
      "Read the newest data row for a registered widget kind. Returns null when no data has been published for that kind.",
    inputSchema: generatedReadInputSchema,
  },
  {
    name: "publishWidgetData",
    description:
      "Publish a new immutable data row for a registered widget kind. Clients show the newest row for that kind. Use a stable retry key such as briefing:2026-09-30:morning or strava:2026-10-04. The server generates the widget data ID; do not provide one.",
    inputSchema: generatedInputSchema,
  },
];

function issuePath(path: PropertyKey[]): string {
  if (path.length === 0) return "arguments";
  return path.reduce<string>((result, part) => {
    if (typeof part === "number") return `${result}[${part}]`;
    return result ? `${result}.${String(part)}` : String(part);
  }, "");
}

function validationMessage(error: z.ZodError, expected: string): string {
  const issues = error.issues.map(
    (issue) => `${issuePath(issue.path)}: ${issue.message}`,
  );
  return [
    "Widget data is incompatible with the registered client schema:",
    ...issues.map((issue) => `- ${issue}`),
    expected,
  ].join("\n");
}

export function createWidgetToolHandlers(
  executors: WidgetExecutors,
): Record<string, WidgetToolHandler> {
  return {
    readWidgetData: async (
      rpcId,
      sessionUserId,
      parsedScopes,
      rawArgs,
    ) => {
      if (!hasRequiredScope(parsedScopes, WIDGETS_READ_SCOPE)) {
        return mcpError(
          rpcId,
          -32001,
          `Missing required scope: ${WIDGETS_READ_SCOPE}`,
        );
      }
      const parsed = widgetDataReadInputSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return mcpError(
          rpcId,
          -32602,
          validationMessage(
            parsed.error,
            `Expected read shape with kind set to one of: ${WIDGET_KINDS.join(", ")}.`,
          ),
        );
      }
      try {
        const result = await executors.read({
          userId: sessionUserId,
          kind: parsed.data.kind,
        });
        if (!result) return mcpToolResult(rpcId, null);
        const data = parseWidgetData(
          result.kind,
          result.schemaVersion,
          JSON.parse(result.dataJson),
        );
        return mcpToolResult(rpcId, {
          id: result.id,
          createdAt: result.createdAt,
          kind: result.kind,
          schemaVersion: result.schemaVersion,
          data,
        });
      } catch (error) {
        return mcpError(
          rpcId,
          -32000,
          error instanceof Error ? error.message : "Widget read failed",
        );
      }
    },
    publishWidgetData: async (
      rpcId,
      sessionUserId,
      parsedScopes,
      rawArgs,
    ) => {
      if (!hasRequiredScope(parsedScopes, WIDGETS_WRITE_SCOPE)) {
        return mcpError(
          rpcId,
          -32001,
          `Missing required scope: ${WIDGETS_WRITE_SCOPE}`,
        );
      }
      const parsed = widgetDataInputSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return mcpError(
          rpcId,
          -32602,
          validationMessage(
            parsed.error,
            `Expected a schema-valid registered widget payload for: ${WIDGET_KINDS.map((kind) => `${kind}@1`).join(", ")}. Inspect the generated tool schema for fields.`,
          ),
        );
      }
      const dataJson = JSON.stringify(parsed.data.data);
      const bytes = new TextEncoder().encode(dataJson).length;
      if (bytes > WIDGET_DATA_MAX_BYTES) {
        return mcpError(
          rpcId,
          -32602,
          `data exceeds the ${WIDGET_DATA_MAX_BYTES} byte widget limit (received ${bytes} bytes)`,
        );
      }
      try {
        const result = await executors.publish({
          userId: sessionUserId,
          kind: parsed.data.kind,
          schemaVersion: parsed.data.schemaVersion,
          dataJson,
          idempotencyKey: parsed.data.idempotencyKey,
        });
        return mcpToolResult(rpcId, {
          ...result,
          kind: parsed.data.kind,
          schemaVersion: parsed.data.schemaVersion,
        });
      } catch (error) {
        return mcpError(
          rpcId,
          -32000,
          error instanceof Error ? error.message : "Widget publication failed",
        );
      }
    },
  };
}
