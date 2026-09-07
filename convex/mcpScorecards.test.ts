import { describe, expect, it, vi } from "vitest";
import {
  SIGNALS_READ_SCOPE,
  SIGNALS_WRITE_SCOPE,
  type ParsedMcpScopes,
} from "./mcpScopes";
import {
  createScorecardToolHandlers,
  scorecardToolDescriptors,
  type ScorecardExecutors,
} from "./mcpTools/scorecards";

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
  const read = vi.fn<ScorecardExecutors["read"]>(async () => [
    { name: "Exercise" },
  ]);
  const manage = vi.fn<ScorecardExecutors["manage"]>(async () => ({
    scorecardId: "scorecard-1",
  }));
  return {
    read,
    manage,
    handlers: createScorecardToolHandlers({
      read,
      manage,
    }),
  };
}

describe("scorecard MCP tools", () => {
  it("registers scorecard tools", () => {
    expect(scorecardToolDescriptors.map((tool) => tool.name)).toEqual([
      "readScorecards",
      "manageScorecard",
    ]);
  });

  it("requires the signals read scope", async () => {
    const { handlers, read } = makeHandlers();
    const response = await handlers.readScorecards(
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
    const response = await handlers.readScorecards(
      2,
      "user-1",
      scopes(SIGNALS_READ_SCOPE),
      {
        scorecardId: "card-1",
        tagId: "tag-exercise",
        now: 123,
        soonWindowMs: 456,
      },
    );
    const body = await responseBody(response);

    expect(body.error).toBeUndefined();
    expect(read).toHaveBeenCalledWith({
      userId: "user-1",
      tagRootId: undefined,
      scorecardId: "card-1",
      tagId: "tag-exercise",
      now: 123,
      soonWindowMs: 456,
    });

    const invalid = await handlers.readScorecards(
      3,
      "user-1",
      scopes(SIGNALS_READ_SCOPE),
      { unexpected: true },
    );
    expect((await responseBody(invalid)).error).toMatchObject({
      code: -32602,
    });
  });

  it("requires the signals write scope for manage", async () => {
    const { handlers, manage } = makeHandlers();
    const denied = await handlers.manageScorecard(
      4,
      "user-1",
      scopes(SIGNALS_READ_SCOPE),
      {
        operation: {
          type: "scorecard.create",
          name: "Exercise",
          tagIds: [],
          members: [{ signalId: "signal-1", role: "required" }],
          optionalQuota: 0,
        },
      },
    );
    expect((await responseBody(denied)).error).toEqual({
      code: -32001,
      message: `Missing required scope: ${SIGNALS_WRITE_SCOPE}`,
    });
    expect(manage).not.toHaveBeenCalled();
  });

  it("creates, updates, and archives through manageScorecard", async () => {
    const { handlers, manage } = makeHandlers();
    const created = await handlers.manageScorecard(
      5,
      "user-1",
      scopes(SIGNALS_WRITE_SCOPE),
      {
        operation: {
          type: "scorecard.create",
          name: "Exercise",
          tagIds: ["tag-1"],
          members: [
            { signalId: "signal-1", role: "required" },
            { signalId: "signal-2", role: "optional" },
          ],
          optionalQuota: 1,
        },
      },
    );
    expect((await responseBody(created)).error).toBeUndefined();
    expect(manage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        operation: {
          type: "scorecard.create",
          name: "Exercise",
          tagIds: ["tag-1"],
          members: [
            { type: "signal", signalId: "signal-1", role: "required" },
            { type: "signal", signalId: "signal-2", role: "optional" },
          ],
          optionalQuota: 1,
        },
      }),
    );

    const withTarget = await handlers.manageScorecard(
      61,
      "user-1",
      scopes(SIGNALS_WRITE_SCOPE),
      {
        operation: {
          type: "scorecard.create",
          name: "Exercise week",
          tagIds: [],
          members: [{ signalId: "signal-1", role: "optional" }],
          optionalQuota: 0,
          targetCount: 5,
        },
      },
    );
    expect((await responseBody(withTarget)).error).toBeUndefined();
    expect(manage).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          type: "scorecard.create",
          name: "Exercise week",
          targetCount: 5,
        }),
      }),
    );

    const updated = await handlers.manageScorecard(
      6,
      "user-1",
      scopes(SIGNALS_WRITE_SCOPE),
      {
        operation: {
          type: "scorecard.update",
          scorecardId: "scorecard-1",
          optionalQuota: 0,
          targetCount: null,
        },
      },
    );
    expect(manage).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          type: "scorecard.update",
          targetCount: null,
        }),
      }),
    );
    expect((await responseBody(updated)).error).toBeUndefined();

    const archived = await handlers.manageScorecard(
      7,
      "user-1",
      scopes(SIGNALS_WRITE_SCOPE),
      {
        operation: {
          type: "scorecard.archive",
          scorecardId: "scorecard-1",
          archived: true,
        },
      },
    );
    expect((await responseBody(archived)).error).toBeUndefined();

    const nested = await handlers.manageScorecard(
      71,
      "user-1",
      scopes(SIGNALS_WRITE_SCOPE),
      {
        operation: {
          type: "scorecard.create",
          name: "Exercise",
          tagIds: [],
          members: [
            {
              type: "scorecard",
              scorecardId: "scorecard-2",
              role: "optional",
            },
          ],
          optionalQuota: 1,
        },
      },
    );
    expect((await responseBody(nested)).error).toBeUndefined();
    expect(manage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          members: [
            {
              type: "scorecard",
              scorecardId: "scorecard-2",
              role: "optional",
            },
          ],
        }),
      }),
    );
  });

  it("forwards tag-root scope on reads", async () => {
    const { handlers, read } = makeHandlers();
    await handlers.readScorecards(
      8,
      "user-1",
      { scopes: new Set([SIGNALS_READ_SCOPE]), tagRootId: "tag-root" as never },
      {},
    );
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        tagRootId: "tag-root",
      }),
    );
  });
});
