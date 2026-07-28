import assert from "node:assert/strict";
import {
  appendFile,
  mkdir,
  mkdtemp,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, toNamespacedPath } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  CodexMonitor,
  shouldShowTaskForProcessState,
  type CodexMonitorSnapshot,
} from "../src/services/codex-monitor.ts";
import { HookEventStore } from "../src/services/hook-event-store.ts";
import { ThreadRepository } from "../src/services/thread-repository.ts";

const THREAD_ONE = "019f9e6d-7d8b-77d3-a573-8cbc293afe16";
const THREAD_TWO = "019f9e6d-7d8b-77d3-a573-8cbc293afe17";
const THREAD_THREE = "019f9e6d-7d8b-77d3-a573-8cbc293afe18";

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

const waitForSnapshot = async (
  monitor: CodexMonitor,
  predicate: (snapshot: CodexMonitorSnapshot) => boolean,
  timeoutMs = 6_000,
): Promise<CodexMonitorSnapshot> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = monitor.snapshot;
    if (predicate(snapshot)) {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.fail(
    `Timed out waiting for monitor snapshot: ${JSON.stringify(
      monitor.snapshot,
    )}`,
  );
};

test("drops phantom running after Codex process absence is confirmed", () => {
  assert.equal(
    shouldShowTaskForProcessState("running", true, false),
    false,
  );
  assert.equal(
    shouldShowTaskForProcessState("running", false, false),
    true,
  );
  assert.equal(
    shouldShowTaskForProcessState("running", true, true),
    true,
  );
  assert.equal(
    shouldShowTaskForProcessState("waiting", true, false),
    true,
  );
});

test("discovers new Codex threads and tails state plus weekly usage", async () => {
  const root = await mkdtemp(join(tmpdir(), "usage-pet-monitor-"));
  const sessionsRoot = join(root, "sessions");
  const databasePath = join(root, "state_5.sqlite");
  const hookPath = join(root, "hook-events.jsonl");
  const globalStatePath = join(root, ".codex-global-state.json");
  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(
    globalStatePath,
    JSON.stringify({
      "electron-persisted-atom-state": {
        "unread-thread-ids-by-host-v1": {
          local: [THREAD_TWO],
        },
      },
    }),
    "utf8",
  );

  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      title TEXT,
      name TEXT,
      preview TEXT,
      cwd TEXT,
      rollout_path TEXT,
      updated_at INTEGER,
      updated_at_ms INTEGER,
      recency_at INTEGER,
      recency_at_ms INTEGER,
      source TEXT,
      archived INTEGER
    )
  `);

  const firstRollout = join(sessionsRoot, "first.jsonl");
  const now = Date.now();
  const eventBase = now - 10_000;
  const startedFourMinutesAgo = new Date(
    eventBase - 4 * 60_000,
  ).toISOString();
  const resetAt = Math.floor(now / 1_000) + 7 * 24 * 60 * 60;
  await writeFile(
    firstRollout,
    [
      line(startedFourMinutesAgo, "task_started"),
      line(new Date(eventBase - 1_000).toISOString(), "token_count", {
        rate_limits: {
          short: {
            used_percent: 10,
            window_minutes: 300,
            resets_at: Math.floor(now / 1_000) + 3_000,
          },
          weekly: {
            used_percent: 34,
            window_minutes: 10_080,
            resets_at: resetAt,
          },
        },
      }),
      "",
    ].join("\n"),
    "utf8",
  );
  database
    .prepare(
      `
        INSERT INTO threads (
          id, title, name, preview, cwd, rollout_path,
          updated_at, updated_at_ms, recency_at, recency_at_ms,
          source, archived
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      THREAD_ONE,
      "First task",
      "",
      "",
      "C:\\Work\\First",
      firstRollout,
      Math.floor(now / 1_000),
      now,
      Math.floor(now / 1_000),
      now,
      "vscode",
      0,
    );
  database.close();

  const monitor = new CodexMonitor(
    new ThreadRepository(databasePath, [sessionsRoot]),
    new HookEventStore(hookPath),
    async () => true,
  );
  monitor.start();

  try {
    const running = await waitForSnapshot(
      monitor,
      (snapshot) =>
        snapshot.primaryState === "running" &&
        snapshot.tasks.some(({ id }) => id === THREAD_ONE),
    );
    assert.equal(running.tasks[0]?.status, "running");
    assert.equal(running.usage.status, "available");
    assert.equal(running.usage.weekly?.remainingPercent, 66);
    assert.equal(running.usage.weekly?.windowDurationMins, 10_080);

    const secondRollout = join(sessionsRoot, "second.jsonl");
    const secondStartedAt = new Date(eventBase + 2_000).toISOString();
    await writeFile(secondRollout, "", "utf8");
    await writeFile(
      hookPath,
      `${JSON.stringify({
        hookEventName: "UserPromptSubmit",
        threadId: THREAD_TWO,
        capturedAt: secondStartedAt,
      })}\n`,
      "utf8",
    );
    await waitForSnapshot(
      monitor,
      (snapshot) => snapshot.hookMode === "connected",
    );
    assert.equal(
      monitor.snapshot.tasks.some(({ id }) => id === THREAD_TWO),
      false,
    );

    const updateDatabase = new DatabaseSync(databasePath);
    updateDatabase
      .prepare(
        `
          INSERT INTO threads (
            id, title, name, preview, cwd, rollout_path,
            updated_at, updated_at_ms, recency_at, recency_at_ms,
            source, archived
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        THREAD_TWO,
        "Second task",
        "",
        "",
        "C:\\Work\\Second",
        secondRollout,
        Math.floor((eventBase + 2_000) / 1_000),
        eventBase + 2_000,
        Math.floor((eventBase + 2_000) / 1_000),
        eventBase + 2_000,
        "vscode",
        0,
      );
    updateDatabase.close();

    const bothRunning = await waitForSnapshot(
      monitor,
      (snapshot) =>
        snapshot.tasks.some(({ id }) => id === THREAD_ONE) &&
        snapshot.tasks.some(({ id }) => id === THREAD_TWO),
    );
    assert.equal(bothRunning.tasks.length, 2);

    const inputCallAt = new Date(eventBase + 3_000).toISOString();
    await appendFile(
      secondRollout,
      `${JSON.stringify({
        timestamp: inputCallAt,
        type: "response_item",
        payload: {
          type: "function_call",
          name: "request_user_input",
          call_id: "input-call",
          arguments: "{\"private\":\"not retained\"}",
        },
      })}\n`,
      "utf8",
    );

    const waiting = await waitForSnapshot(
      monitor,
      (snapshot) =>
        snapshot.tasks.find(({ id }) => id === THREAD_TWO)?.status ===
        "waiting",
    );
    assert.equal(waiting.primaryState, "waiting");

    await appendFile(
      secondRollout,
      [
        JSON.stringify({
          timestamp: new Date(eventBase + 4_000).toISOString(),
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "input-call",
            output: "private answer",
          },
        }),
        line(new Date(eventBase + 5_000).toISOString(), "task_complete"),
        "",
      ].join("\n"),
      "utf8",
    );

    const review = await waitForSnapshot(
      monitor,
      (snapshot) =>
        snapshot.tasks.find(({ id }) => id === THREAD_TWO)?.status ===
        "review",
    );
    assert.equal(review.primaryState, "review");

    const stable = monitor.snapshot;
    assert.equal(
      stable.tasks.find(({ id }) => id === THREAD_ONE)?.status,
      "running",
    );
    assert.equal(
      stable.tasks.find(({ id }) => id === THREAD_TWO)?.status,
      "review",
    );
    assert.equal(stable.usage.weekly?.remainingPercent, 66);

    await writeFile(
      globalStatePath,
      JSON.stringify({
        "electron-persisted-atom-state": {
          "unread-thread-ids-by-host-v1": {
            local: [],
          },
        },
      }),
      "utf8",
    );
    const read = await waitForSnapshot(
      monitor,
      (snapshot) =>
        snapshot.tasks.every(({ id }) => id !== THREAD_TWO),
    );
    assert.equal(read.primaryState, "running");
    assert.deepEqual(
      read.notificationTasks.find(({ id }) => id === THREAD_TWO),
      {
        id: THREAD_TWO,
        status: "review",
      },
    );
  } finally {
    monitor.stop();
  }
});

test("publishes every running Codex Desktop thread when older rollouts use Windows namespaced paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "usage-pet-multi-monitor-"));
  const sessionsRoot = join(root, "sessions");
  const databasePath = join(root, "state_5.sqlite");
  const hookPath = join(root, "hook-events.jsonl");
  await mkdir(sessionsRoot, { recursive: true });

  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      title TEXT,
      name TEXT,
      preview TEXT,
      cwd TEXT,
      rollout_path TEXT,
      updated_at INTEGER,
      updated_at_ms INTEGER,
      recency_at INTEGER,
      recency_at_ms INTEGER,
      source TEXT,
      archived INTEGER
    )
  `);

  const now = Date.now();
  const threads = [
    {
      id: THREAD_ONE,
      title: "First running task",
      rolloutPath: join(sessionsRoot, "first.jsonl"),
      databasePath: toNamespacedPath(
        join(sessionsRoot, "first.jsonl"),
      ),
    },
    {
      id: THREAD_TWO,
      title: "Second running task",
      rolloutPath: join(sessionsRoot, "second.jsonl"),
      databasePath: toNamespacedPath(
        join(sessionsRoot, "second.jsonl"),
      ),
    },
    {
      id: THREAD_THREE,
      title: "Third running task",
      rolloutPath: join(sessionsRoot, "third.jsonl"),
      databasePath: join(sessionsRoot, "third.jsonl"),
    },
  ];

  for (const [index, thread] of threads.entries()) {
    const startedAt = new Date(now - 3_000 + index).toISOString();
    await writeFile(
      thread.rolloutPath,
      `${line(startedAt, "task_started")}\n`,
      "utf8",
    );
    database
      .prepare(
        `
          INSERT INTO threads (
            id, title, name, preview, cwd, rollout_path,
            updated_at, updated_at_ms, recency_at, recency_at_ms,
            source, archived
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        thread.id,
        thread.title,
        "",
        "",
        `C:\\Work\\${index + 1}`,
        thread.databasePath,
        Math.floor(now / 1_000),
        now + index,
        Math.floor(now / 1_000),
        now + index,
        "vscode",
        0,
      );
  }
  database.close();

  const monitor = new CodexMonitor(
    new ThreadRepository(databasePath, [sessionsRoot]),
    new HookEventStore(hookPath),
    async () => true,
  );
  monitor.start();

  try {
    const snapshot = await waitForSnapshot(
      monitor,
      ({ tasks }) => tasks.length === 3,
      2_500,
    );
    assert.deepEqual(
      new Set(snapshot.tasks.map(({ id }) => id)),
      new Set([THREAD_ONE, THREAD_TWO, THREAD_THREE]),
    );
    assert.deepEqual(
      new Set(snapshot.tasks.map(({ status }) => status)),
      new Set(["running"]),
    );
  } finally {
    monitor.stop();
  }
});
