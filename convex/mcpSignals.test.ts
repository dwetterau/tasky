import { describe, expect, it, vi } from "vitest";
import {
  SIGNALS_READ_SCOPE,
  SIGNALS_WRITE_SCOPE,
  type ParsedMcpScopes,
} from "./mcpScopes";
import {
  createSignalToolHandlers,
  signalToolDescriptors,
  type SignalExecutors,
} from "./mcpTools/signals";

type JsonRpcBody = {
  error?: {
    code: number;
    message: string;
  };
  result?: {
    content: Array<{
      type: string;
      text: string;
    }>;
  };
};

async function responseBody(response: Response): Promise<JsonRpcBody> {
  return (await response.json()) as JsonRpcBody;
}

function scopes(...values: string[]): ParsedMcpScopes {
  return { scopes: new Set(values) };
}

function makeHandlers() {
  const read = vi.fn<SignalExecutors["read"]>(
    async () => [{ name: "Run" }],
  );
  const record = vi.fn<SignalExecutors["record"]>(
    async () => ({ idempotent: false }),
  );
  const manage = vi.fn<SignalExecutors["manage"]>(
    async () => ({ signalId: "signal-1" }),
  );
  return {
    read,
    record,
    manage,
    handlers: createSignalToolHandlers({ read, record, manage }),
  };
}

describe("signal MCP tools", () => {
  it("registers the three signal tools", () => {
    expect(signalToolDescriptors.map((tool) => tool.name)).toEqual([
      "readSignals",
      "recordSignal",
      "manageSignal",
    ]);
  });

  it("requires the dedicated read scope", async () => {
    const { handlers, read } = makeHandlers();
    const response = await handlers.readSignals(
      1,
      "user-1",
      scopes("tasks:read"),
      {},
    );
    const body = await responseBody(response);

    expect(body.error).toEqual({
      code: -32001,
      message: `Missing required scope: ${SIGNALS_READ_SCOPE}`,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("parses read filters and rejects unexpected fields", async () => {
    const { handlers, read } = makeHandlers();
    const response = await handlers.readSignals(
      2,
      "user-1",
      scopes(SIGNALS_READ_SCOPE),
      {
        kind: "activity",
        category: "Exercise",
        attention: "due",
        now: 123,
        soonWindowMs: 456,
      },
    );
    const body = await responseBody(response);

    expect(body.error).toBeUndefined();
    expect(read).toHaveBeenCalledWith({
      userId: "user-1",
      kind: "activity",
      category: "Exercise",
      attention: "due",
      now: 123,
      soonWindowMs: 456,
    });

    const invalid = await handlers.readSignals(
      3,
      "user-1",
      scopes(SIGNALS_READ_SCOPE),
      { unexpected: true },
    );
    expect((await responseBody(invalid)).error).toMatchObject({
      code: -32602,
    });
  });

  it("validates and forwards idempotent record operations", async () => {
    const { handlers, record } = makeHandlers();
    const response = await handlers.recordSignal(
      4,
      "user-1",
      scopes(SIGNALS_WRITE_SCOPE),
      {
        signalId: "signal-1",
        idempotencyKey: "request-1",
        soonWindowMs: 1_000,
        operation: {
          type: "inventory.adjusted",
          amount: -1,
        },
      },
    );
    const body = await responseBody(response);

    expect(body.error).toBeUndefined();
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      userId: "user-1",
      signalId: "signal-1",
      idempotencyKey: "request-1",
      operation: {
        type: "inventory.adjusted",
        amount: -1,
      },
      soonWindowMs: 1_000,
    });
    expect(record.mock.calls[0]?.[0].now).toEqual(expect.any(Number));
  });

  it("requires write scope and strictly validates manage operations", async () => {
    const { handlers, manage } = makeHandlers();
    const denied = await handlers.manageSignal(
      5,
      "user-1",
      scopes(SIGNALS_READ_SCOPE),
      {
        operation: {
          type: "activity.create",
          name: "Run",
        },
      },
    );
    expect((await responseBody(denied)).error).toMatchObject({
      code: -32001,
    });

    const created = await handlers.manageSignal(
      6,
      "user-1",
      scopes(SIGNALS_WRITE_SCOPE),
      {
        operation: {
          type: "inventory.create",
          name: "Prescription",
          unit: "pills",
          initialQuantity: 60,
          threshold: {
            value: 14,
            comparison: "atOrBelow",
          },
          flow: {
            amount: -1,
            everyDays: 1,
          },
        },
      },
    );
    expect((await responseBody(created)).error).toBeUndefined();
    expect(manage.mock.calls[0]?.[0]).toMatchObject({
      userId: "user-1",
      operation: {
        type: "inventory.create",
        name: "Prescription",
        unit: "pills",
        initialQuantity: 60,
        threshold: {
          value: 14,
          comparison: "atOrBelow",
        },
        flow: {
          amount: -1,
          everyDays: 1,
        },
      },
    });

    const malformed = await handlers.manageSignal(
      7,
      "user-1",
      scopes(SIGNALS_WRITE_SCOPE),
      {
        operation: {
          type: "inventory.create",
          name: "Prescription",
          unit: "pills",
          initialQuantity: 60,
          threshold: {
            value: 14,
            comparison: "atOrBelow",
            extra: true,
          },
        },
      },
    );
    expect((await responseBody(malformed)).error).toMatchObject({
      code: -32602,
    });
  });
});
