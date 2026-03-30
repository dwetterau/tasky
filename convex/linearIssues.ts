import { v } from "convex/values";
import { internal } from "./_generated/api";
import { ActionCtx, action, internalAction, internalMutation, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthUserId } from "./auth";
import { decryptApiKey } from "./apiKeys";
import { insertEvent } from "./events";
import { linearWorkflowStateType, type LinearWorkflowStateType } from "./schema";

export function parseLinearIssueUrl(rawUrl: string): {
  url: string;
  domain: string;
  workspace: string;
  identifier: string;
  team: string;
  number: number;
} {
  const trimmed = rawUrl.trim();
  const parseInput = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(parseInput);
  } catch {
    throw new Error("Invalid Linear issue URL");
  }

  const hostname = parsed.hostname.toLowerCase();
  const domain = hostname === "www.linear.app" ? "linear.app" : hostname;
  if (domain !== "linear.app") {
    throw new Error("Only linear.app issue URLs are supported");
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 3 || parts[1].toLowerCase() !== "issue") {
    throw new Error("URL must match linear.app/<workspace>/issue/<identifier>");
  }

  const workspace = parts[0]?.toLowerCase();
  const identifier = parts[2]?.toUpperCase();
  const match = /^([A-Z0-9]+)-(\d+)$/.exec(identifier ?? "");
  if (!workspace || !match) {
    throw new Error("Invalid Linear issue URL");
  }

  const team = match[1];
  const number = Number(match[2]);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error("Invalid Linear issue URL");
  }

  return {
    url: `linear.app/${workspace}/issue/${identifier}`,
    domain,
    workspace,
    identifier,
    team,
    number,
  };
}

function normalizeLinearStateType(value: string | null | undefined): LinearWorkflowStateType | undefined {
  switch ((value ?? "").trim().toLowerCase()) {
    case "triage":
    case "backlog":
    case "unstarted":
    case "started":
    case "completed":
    case "canceled":
      return value!.trim().toLowerCase() as LinearWorkflowStateType;
    default:
      return undefined;
  }
}

export const listByTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const task = await ctx.db.get(args.taskId);
    if (!task || task.userId !== userId) {
      return [];
    }

    const rows = await ctx.db
      .query("linearIssues")
      .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", args.taskId))
      .order("desc")
      .collect();

    return rows.map((row) => {
      try {
        const normalized = parseLinearIssueUrl(row.url);
        return { ...row, normalized };
      } catch {
        return {
          ...row,
          normalized: null,
        };
      }
    });
  },
});

export const createForTask = mutation({
  args: {
    taskId: v.id("tasks"),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const task = await ctx.db.get(args.taskId);
    if (!task || task.userId !== userId) {
      throw new Error("Task not found or access denied");
    }

    let normalized: ReturnType<typeof parseLinearIssueUrl>;
    try {
      normalized = parseLinearIssueUrl(args.url.trim());
    } catch (error) {
      return {
        status: "invalid_linear_issue_url" as const,
        message: error instanceof Error ? error.message : "Invalid Linear issue URL",
      };
    }

    const existing = await ctx.db
      .query("linearIssues")
      .withIndex("by_user_url", (q) => q.eq("userId", userId).eq("url", normalized.url))
      .first();
    if (existing) {
      if (existing.taskId === args.taskId) {
        return {
          status: "already_attached_to_task" as const,
          linearIssueId: existing._id,
          url: normalized.url,
          workspace: normalized.workspace,
          identifier: normalized.identifier,
          team: normalized.team,
          number: normalized.number,
        };
      }
      return {
        status: "linked_to_other_task" as const,
      };
    }

    const now = Date.now();
    const linearIssueId = await ctx.db.insert("linearIssues", {
      userId,
      taskId: args.taskId,
      url: normalized.url,
      identifier: normalized.identifier,
      updatedAt: now,
    });

    await insertEvent(ctx, {
      userId,
      entityId: linearIssueId,
      action: { type: "linear_issue.created" },
      tagIds: task.tagIds.length > 0 ? task.tagIds : undefined,
    });

    return {
      status: "attached" as const,
      linearIssueId,
      url: normalized.url,
      workspace: normalized.workspace,
      identifier: normalized.identifier,
      team: normalized.team,
      number: normalized.number,
    };
  },
});

export const createForTaskIfMissingInternal = internalMutation({
  args: {
    userId: v.string(),
    taskId: v.id("tasks"),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.userId !== args.userId) {
      throw new Error("Task not found or access denied");
    }

    let normalized: ReturnType<typeof parseLinearIssueUrl>;
    try {
      normalized = parseLinearIssueUrl(args.url.trim());
    } catch (error) {
      return {
        status: "invalid_linear_issue_url" as const,
        message: error instanceof Error ? error.message : "Invalid Linear issue URL",
      };
    }

    const existing = await ctx.db
      .query("linearIssues")
      .withIndex("by_user_url", (q) => q.eq("userId", args.userId).eq("url", normalized.url))
      .first();
    if (existing) {
      if (existing.taskId === args.taskId) {
        return {
          status: "already_attached_to_task" as const,
          linearIssueId: existing._id,
          url: normalized.url,
          workspace: normalized.workspace,
          identifier: normalized.identifier,
          team: normalized.team,
          number: normalized.number,
        };
      }
      return {
        status: "linked_to_other_task" as const,
      };
    }

    const now = Date.now();
    const linearIssueId = await ctx.db.insert("linearIssues", {
      userId: args.userId,
      taskId: args.taskId,
      url: normalized.url,
      identifier: normalized.identifier,
      updatedAt: now,
    });

    await insertEvent(ctx, {
      userId: args.userId,
      entityId: linearIssueId,
      action: { type: "linear_issue.created" },
      tagIds: task.tagIds.length > 0 ? task.tagIds : undefined,
    });

    return {
      status: "attached" as const,
      linearIssueId,
      url: normalized.url,
      workspace: normalized.workspace,
      identifier: normalized.identifier,
      team: normalized.team,
      number: normalized.number,
    };
  },
});

export const remove = mutation({
  args: { id: v.id("linearIssues") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const linearIssue = await ctx.db.get(args.id);
    if (!linearIssue || linearIssue.userId !== userId) {
      throw new Error("Linear issue not found or access denied");
    }

    const task = await ctx.db.get(linearIssue.taskId);
    const tagIds = task && task.userId === userId && task.tagIds.length > 0 ? task.tagIds : undefined;

    await insertEvent(ctx, {
      userId,
      entityId: args.id,
      action: { type: "linear_issue.deleted" },
      tagIds,
    });

    await ctx.db.delete(args.id);
  },
});

export const patchSyncFieldsInternal = internalMutation({
  args: {
    linearIssueId: v.id("linearIssues"),
    userId: v.string(),
    url: v.string(),
    identifier: v.string(),
    title: v.optional(v.string()),
    linearStatus: v.optional(v.string()),
    linearStateType: v.optional(linearWorkflowStateType),
    lastSyncedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const linearIssue = await ctx.db.get(args.linearIssueId);
    if (!linearIssue || linearIssue.userId !== args.userId) {
      return false;
    }

    await ctx.db.patch(args.linearIssueId, {
      url: args.url,
      identifier: args.identifier,
      title: args.title,
      linearStatus: args.linearStatus,
      linearStateType: args.linearStateType,
      lastSyncedAt: args.lastSyncedAt,
      updatedAt: Date.now(),
    });

    return true;
  },
});

type BatchItem = {
  linearIssueId: Id<"linearIssues">;
  identifier: string;
  alias: string;
};

type DedupedBatchItem = {
  identifier: string;
  alias: string;
  linearIssueIds: Id<"linearIssues">[];
};

type LinearIssueSyncArgs = {
  userId: string;
  items: Array<{
    linearIssueId: Id<"linearIssues">;
    url: string;
    identifier?: string;
  }>;
};

function sanitizeGraphQlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildBatchQuery(items: BatchItem[]): string {
  const fields = items
    .map(
      (item) =>
        `${item.alias}: issue(id: "${sanitizeGraphQlString(item.identifier)}") { id identifier url title state { name type } }`
    )
    .join("\n");
  return `query LinearIssueBatchSync {\n${fields}\n}`;
}

function normalizeBatchItem(
  item: {
    linearIssueId: Id<"linearIssues">;
    url: string;
    identifier?: string;
  },
  alias: string
): BatchItem | null {
  const identifier = item.identifier?.trim().toUpperCase();
  if (identifier && /^([A-Z0-9]+)-(\d+)$/.test(identifier)) {
    return {
      linearIssueId: item.linearIssueId,
      identifier,
      alias,
    };
  }

  try {
    const parsed = parseLinearIssueUrl(item.url);
    return {
      linearIssueId: item.linearIssueId,
      identifier: parsed.identifier,
      alias,
    };
  } catch {
    return null;
  }
}

async function syncLinearIssuesBatchImpl(ctx: ActionCtx, args: LinearIssueSyncArgs) {
  const now = Date.now();
  const keyRow = await ctx.runQuery(internal.apiKeys.getLatestByTypeInternal, {
    userId: args.userId,
    type: "linear",
  });
  if (!keyRow) {
    return {
      status: "skipped_no_pat" as const,
      updatedCount: 0,
      results: args.items.map((item) => ({
        linearIssueId: item.linearIssueId,
        status: "skipped_no_pat" as const,
      })),
    };
  }

  const token = await decryptApiKey(keyRow.encryptedValue, keyRow.iv);
  if (!token.trim()) {
    return {
      status: "skipped_no_pat" as const,
      updatedCount: 0,
      results: args.items.map((item) => ({
        linearIssueId: item.linearIssueId,
        status: "skipped_no_pat" as const,
      })),
    };
  }

  const normalizedItems = args.items.map((item, index) => normalizeBatchItem(item, `issue${index.toString(36)}`));
  const validItems = normalizedItems.filter((item): item is BatchItem => item !== null);
  const invalidResults = normalizedItems
    .map((item, index) => ({ normalized: item, original: args.items[index] }))
    .filter((item) => item.normalized === null)
    .map((item) => ({
      linearIssueId: item.original.linearIssueId,
      status: "invalid_url" as const,
    }));

  if (validItems.length === 0) {
    return {
      status: "ok" as const,
      updatedCount: 0,
      results: invalidResults,
    };
  }

  const dedupedByIdentifier = new Map<string, DedupedBatchItem>();
  for (const item of validItems) {
    const externalKey = item.identifier.toUpperCase();
    const existing = dedupedByIdentifier.get(externalKey);
    if (existing) {
      if (!existing.linearIssueIds.includes(item.linearIssueId)) {
        existing.linearIssueIds.push(item.linearIssueId);
      }
      continue;
    }
    dedupedByIdentifier.set(externalKey, {
      identifier: item.identifier,
      alias: `issue${dedupedByIdentifier.size.toString(36)}`,
      linearIssueIds: [item.linearIssueId],
    });
  }
  const dedupedItems = Array.from(dedupedByIdentifier.values());

  const queryText = buildBatchQuery(
    dedupedItems.map((item) => ({
      linearIssueId: item.linearIssueIds[0],
      identifier: item.identifier,
      alias: item.alias,
    }))
  );
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
      "User-Agent": "tasky-linear-sync",
    },
    body: JSON.stringify({ query: queryText }),
  });

  if (!response.ok) {
    return {
      status: "failed" as const,
      updatedCount: 0,
      results: [
        ...invalidResults,
        ...dedupedItems.flatMap((item) =>
          item.linearIssueIds.map((linearIssueId) => ({
            linearIssueId,
            status: "failed" as const,
            reason: `Linear API returned ${response.status}`,
          }))
        ),
      ],
    };
  }

  const payload = (await response.json()) as {
    data?: Record<
      string,
      | {
          id: string;
          identifier: string;
          url: string;
          title: string;
          state: {
            name: string;
            type: string;
          } | null;
        }
      | null
    >;
    errors?: Array<{ path?: Array<string | number>; message?: string }>;
  };

  const errorsByAlias = new Map<string, string>();
  for (const error of payload.errors ?? []) {
    const alias = error.path?.[0];
    if (typeof alias === "string" && error.message) {
      errorsByAlias.set(alias, error.message);
    }
  }

  const successResults: Array<{
    linearIssueId: (typeof args.items)[number]["linearIssueId"];
    status: "updated" | "not_found" | "failed";
    reason?: string;
  }> = [];
  let updatedCount = 0;

  for (const item of dedupedItems) {
    const aliasNode = payload.data?.[item.alias];
    const fieldError = errorsByAlias.get(item.alias);
    if (fieldError) {
      for (const linearIssueId of item.linearIssueIds) {
        successResults.push({
          linearIssueId,
          status: "failed",
          reason: fieldError,
        });
      }
      continue;
    }

    const issueNode = aliasNode;
    if (!issueNode) {
      for (const linearIssueId of item.linearIssueIds) {
        successResults.push({
          linearIssueId,
          status: "not_found",
        });
      }
      continue;
    }

    let nextUrl = args.items.find((candidate) => candidate.linearIssueId === item.linearIssueIds[0])?.url ?? "";
    let nextIdentifier = issueNode.identifier;
    try {
      const parsed = parseLinearIssueUrl(issueNode.url);
      nextUrl = parsed.url;
      nextIdentifier = parsed.identifier;
    } catch {
      const fallback = args.items.find((candidate) => candidate.linearIssueId === item.linearIssueIds[0]);
      if (fallback) {
        nextUrl = fallback.url;
      }
    }

    for (const linearIssueId of item.linearIssueIds) {
      try {
        const patched = await ctx.runMutation(internal.linearIssues.patchSyncFieldsInternal, {
          linearIssueId,
          userId: args.userId,
          url: nextUrl,
          identifier: nextIdentifier,
          title: issueNode.title?.trim() || undefined,
          linearStatus: issueNode.state?.name?.trim() || undefined,
          linearStateType: normalizeLinearStateType(issueNode.state?.type),
          lastSyncedAt: now,
        });
        if (!patched) {
          successResults.push({
            linearIssueId,
            status: "not_found",
          });
          continue;
        }
        updatedCount += 1;
        successResults.push({
          linearIssueId,
          status: "updated",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown patch error";
        successResults.push({
          linearIssueId,
          status: "failed",
          reason: message,
        });
      }
    }
  }

  return {
    status: "ok" as const,
    updatedCount,
    results: [...invalidResults, ...successResults],
  };
}

export const syncLinearIssuesBatchInternal = internalAction({
  args: {
    userId: v.string(),
    items: v.array(
      v.object({
        linearIssueId: v.id("linearIssues"),
        url: v.string(),
        identifier: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => syncLinearIssuesBatchImpl(ctx, args),
});

export const syncLinearIssuesBatch = action({
  args: {
    items: v.array(
      v.object({
        linearIssueId: v.id("linearIssues"),
        url: v.string(),
        identifier: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    return await syncLinearIssuesBatchImpl(ctx, {
      userId,
      items: args.items,
    });
  },
});
