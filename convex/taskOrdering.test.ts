import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

async function createTask(
  t: ReturnType<typeof convexTest>,
  content: string
) {
  return await t.mutation(internal.tasks.createFromMcp, {
    userId: "user-1",
    content,
  });
}

async function readTasks(t: ReturnType<typeof convexTest>) {
  return await t.query(internal.tasks.listForMcp, {
    userId: "user-1",
    includeClosed: false,
  });
}

describe("task manual ordering", () => {
  it("creates tasks at the start and reorders them by neighboring task id", async () => {
    const t = convexTest(schema, modules);
    const first = await createTask(t, "First");
    const second = await createTask(t, "Second");
    const third = await createTask(t, "Third");

    expect((await readTasks(t)).map((task) => task.content)).toEqual([
      "Third",
      "Second",
      "First",
    ]);

    await t.mutation(internal.tasks.updateFromMcp, {
      userId: "user-1",
      id: third.taskId,
      afterTaskId: first.taskId,
    });

    const reordered = await readTasks(t);
    expect(reordered.map((task) => task.content)).toEqual([
      "Second",
      "First",
      "Third",
    ]);
    const orderKeys = reordered.map((task) => task.orderKey);
    expect(orderKeys.every((key) => typeof key === "string")).toBe(true);
    expect(orderKeys).toEqual([...orderKeys].sort());

    await t.mutation(internal.tasks.updateFromMcp, {
      userId: "user-1",
      id: first.taskId,
      beforeTaskId: second.taskId,
    });
    expect((await readTasks(t)).map((task) => task.content)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  it("initializes legacy tasks before applying a move", async () => {
    const t = convexTest(schema, modules);
    const [olderId, newerId] = await t.run(async (ctx) => {
      const olderId = await ctx.db.insert("tasks", {
        userId: "user-1",
        content: "Legacy older",
        tagIds: [],
        status: "not_started",
        priority: "triage",
      });
      const newerId = await ctx.db.insert("tasks", {
        userId: "user-1",
        content: "Legacy newer",
        tagIds: [],
        status: "not_started",
        priority: "triage",
      });
      return [olderId, newerId] as const;
    });

    await t.mutation(internal.tasks.updateFromMcp, {
      userId: "user-1",
      id: olderId,
      beforeTaskId: newerId,
    });

    const tasks = await readTasks(t);
    expect(tasks.map((task) => task.content)).toEqual([
      "Legacy older",
      "Legacy newer",
    ]);
    expect(tasks.every((task) => task.orderKey !== undefined)).toBe(true);
  });
});
