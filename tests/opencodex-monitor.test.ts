import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CodexMonitor,
  type CodexMonitorSnapshot,
} from "../src/services/codex-monitor.ts";
import { HookEventStore } from "../src/services/hook-event-store.ts";

const THREAD_ID = "019f9e6d-7d8b-77d3-a573-8cbc293afe16";

const line = (
  timestamp: string,
  type: string,
  payload: Record<string, unknown> = {},
): string =>
  JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: { type, ...payload },
  });

const waitForUsage = async (
  monitor: CodexMonitor,
): Promise<CodexMonitorSnapshot> => {
  const deadline = Date.now() + 6_000;
  while (Date.now() < deadline) {
    if (monitor.snapshot.usage.status === "available") {
      return monitor.snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.fail(`Timed out waiting for usage: ${JSON.stringify(monitor.snapshot)}`);
};

test("uses the OpenCodex quota cache instead of a synthetic rollout window", async () => {
  const root = await mkdtemp(join(tmpdir(), "usage-pet-opencodex-monitor-"));
  const sessionsRoot = join(root, "sessions");
  const hookPath = join(root, "hook-events.jsonl");
  await mkdir(sessionsRoot, { recursive: true });

  const now = Date.now();
  const rolloutPath = join(sessionsRoot, "opencodex.jsonl");
  await writeFile(
    rolloutPath,
    [
      line(new Date(now - 1_000).toISOString(), "task_started"),
      line(new Date(now - 500).toISOString(), "token_count", {
        rate_limits: {
          primary: {
            used_percent: 0,
            window_minutes: 10_080,
            resets_at: Math.floor(now / 1_000) + 7 * 24 * 60 * 60,
          },
        },
      }),
      "",
    ].join("\n"),
    "utf8",
  );

  const monitor = new CodexMonitor(
    {
      listRecent() {
        return [
          {
            id: THREAD_ID,
            title: "OpenCodex quota task",
            workspaceName: "Usage Pet",
            rolloutPath,
            updatedAt: now,
            isUnread: false,
          },
        ];
      },
      close() {},
    } as unknown as ConstructorParameters<typeof CodexMonitor>[0],
    new HookEventStore(hookPath),
    async () => true,
    0,
    {},
    () => ({
      remainingPercent: 97,
      usedPercent: 3,
      windowDurationMins: 10_080,
      resetsAt: Math.floor(now / 1_000) + 7 * 24 * 60 * 60,
      capturedAt: new Date(now - 1_000).toISOString(),
      source: "opencodex-quota-cache" as const,
    }),
  );

  try {
    const snapshotPromise = monitor.start().then(() => monitor.snapshot);
    const snapshot = await waitForUsage(monitor);
    await snapshotPromise;
    assert.equal(snapshot.usage.weekly?.remainingPercent, 97);
    assert.equal(snapshot.usage.weekly?.source, "opencodex-quota-cache");
  } finally {
    monitor.stop();
  }
});
