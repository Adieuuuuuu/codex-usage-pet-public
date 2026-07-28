import assert from "node:assert/strict";
import test from "node:test";

import type { TaskSnapshot } from "../src/shared/contracts.ts";
import { summarizeTasks } from "../src/renderer/task-summary.ts";

const task = (
  id: string,
  status: TaskSnapshot["status"],
): TaskSnapshot => ({
  id,
  title: `Task ${id}`,
  workspaceName: "usage pet",
  status,
  updatedAt: Date.now(),
  canOpen: true,
});

test("summarizes running and completed tasks without miscounting waiting or failed", () => {
  assert.deepEqual(
    summarizeTasks([
      task("running-1", "running"),
      task("running-2", "running"),
      task("review", "review"),
      task("waiting", "waiting"),
      task("failed", "failed"),
    ]),
    {
      running: 2,
      completed: 1,
    },
  );
});

test("returns zero counts for an empty task list", () => {
  assert.deepEqual(summarizeTasks([]), {
    running: 0,
    completed: 0,
  });
});
