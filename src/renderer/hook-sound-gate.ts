import type { TaskSnapshot } from "../shared/contracts.ts";

export const HOOK_SOUND_COOLDOWN_MS = 10_000;

const isAudibleState = (state: TaskSnapshot["status"]): boolean =>
  state === "waiting" || state === "review";

export class HookSoundGate {
  #previousTasks: Map<string, TaskSnapshot["status"]> | null = null;
  #lastPlayedAt = Number.NEGATIVE_INFINITY;

  update(
    tasks: ReadonlyArray<Pick<TaskSnapshot, "id" | "status">>,
    now = Date.now(),
  ): boolean {
    const nextTasks = new Map(
      tasks.map(({ id, status }) => [id, status]),
    );
    const previousTasks = this.#previousTasks;
    this.#previousTasks = nextTasks;
    if (previousTasks === null) {
      return false;
    }

    const enteredAudibleState = tasks.some(
      ({ id, status }) =>
        isAudibleState(status) &&
        previousTasks.get(id) !== status,
    );
    if (
      !enteredAudibleState ||
      now - this.#lastPlayedAt < HOOK_SOUND_COOLDOWN_MS
    ) {
      return false;
    }
    this.#lastPlayedAt = now;
    return true;
  }
}
