import type { TaskSnapshot } from "../shared/contracts.ts";

export interface TaskSummary {
  running: number;
  completed: number;
}

export const summarizeTasks = (
  tasks: readonly TaskSnapshot[],
): TaskSummary => {
  let running = 0;
  let completed = 0;

  for (const task of tasks) {
    if (task.status === "running") {
      running += 1;
    } else if (task.status === "review") {
      completed += 1;
    }
  }

  return { running, completed };
};
