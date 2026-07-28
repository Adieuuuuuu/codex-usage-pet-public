import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, toNamespacedPath } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  normalizeThreadRow,
  parseUnreadThreadIds,
  ThreadRepository,
} from "../src/services/thread-repository.ts";

const root = resolve("C:\\Users\\Adie\\.codex\\sessions");

test("normalizes a valid Codex Desktop thread without exposing extra columns", () => {
  const normalized = normalizeThreadRow(
    {
      id: "019f9e6d-7d8b-77d3-a573-8cbc293afe16",
      title: "  Build\nUsage Pet  ",
      name: "",
      preview: "private long preview",
      cwd: "D:\\Codex\\usage-pet",
      rollout_path:
        "C:\\Users\\Adie\\.codex\\sessions\\2026\\07\\26\\rollout.jsonl",
      updated_at: 1_785_000_000,
      updated_at_ms: 1_785_000_000_123,
      recency_at: 0,
      recency_at_ms: 1_785_000_000_100,
    },
    [root],
  );

  assert.deepEqual(normalized, {
    id: "019f9e6d-7d8b-77d3-a573-8cbc293afe16",
    title: "Build Usage Pet",
    workspaceName: "usage-pet",
    rolloutPath: resolve(
      "C:\\Users\\Adie\\.codex\\sessions\\2026\\07\\26\\rollout.jsonl",
    ),
    updatedAt: 1_785_000_000_123,
    isUnread: false,
  });
});

test("reads only valid local unread thread ids from Codex Desktop state", () => {
  assert.deepEqual(
    parseUnreadThreadIds({
      "electron-persisted-atom-state": {
        "unread-thread-ids-by-host-v1": {
          local: [
            "019f9e6d-7d8b-77d3-a573-8cbc293afe16",
            "not-a-thread-id",
            42,
          ],
          remote: ["019f9e6d-7d8b-77d3-a573-8cbc293afe17"],
        },
      },
    }),
    new Set(["019f9e6d-7d8b-77d3-a573-8cbc293afe16"]),
  );
  assert.deepEqual(parseUnreadThreadIds(null), new Set());
});

test("prefers an explicit thread name and rejects invalid ids or escaped paths", () => {
  const common = {
    title: "Fallback title",
    name: "Named task",
    preview: "",
    cwd: "D:\\Codex",
    updated_at: 1_785_000_000,
    updated_at_ms: null,
    recency_at: 0,
    recency_at_ms: null,
  };

  assert.equal(
    normalizeThreadRow(
      {
        ...common,
        id: "not-a-thread-id",
        rollout_path:
          "C:\\Users\\Adie\\.codex\\sessions\\2026\\07\\26\\rollout.jsonl",
      },
      [root],
    ),
    null,
  );

  assert.equal(
    normalizeThreadRow(
      {
        ...common,
        id: "019f9e6d-7d8b-77d3-a573-8cbc293afe16",
        rollout_path: "C:\\Users\\Adie\\Documents\\private.jsonl",
      },
      [root],
    ),
    null,
  );

  const named = normalizeThreadRow(
    {
      ...common,
      id: "019f9e6d-7d8b-77d3-a573-8cbc293afe16",
      rollout_path:
        "C:\\Users\\Adie\\.codex\\sessions\\2026\\07\\26\\rollout.jsonl",
    },
    [root],
  );
  assert.equal(named?.title, "Named task");
});

test("accepts safe Windows namespaced paths while rejecting traversal and device namespaces", () => {
  const common = {
    id: "019f9e6d-7d8b-77d3-a573-8cbc293afe16",
    title: "Namespaced task",
    name: "",
    preview: "",
    cwd: "D:\\Codex",
    updated_at: 1_785_000_000,
    updated_at_ms: null,
    recency_at: 0,
    recency_at_ms: null,
  };
  const inside = resolve(
    root,
    "2026",
    "07",
    "26",
    "rollout.jsonl",
  );

  assert.ok(
    normalizeThreadRow(
      {
        ...common,
        rollout_path: toNamespacedPath(inside),
      },
      [root],
    ),
  );
  assert.equal(
    normalizeThreadRow(
      {
        ...common,
        rollout_path:
          "\\\\?\\C:\\Users\\Adie\\.codex\\sessions\\..\\private.jsonl",
      },
      [root],
    ),
    null,
  );
  assert.equal(
    normalizeThreadRow(
      {
        ...common,
        rollout_path:
          "\\\\.\\C:\\Users\\Adie\\.codex\\sessions\\rollout.jsonl",
      },
      [root],
    ),
    null,
  );

  const uncRoot = "\\\\server\\share\\.codex\\sessions";
  assert.ok(
    normalizeThreadRow(
      {
        ...common,
        rollout_path:
          "\\\\?\\UNC\\server\\share\\.codex\\sessions\\2026\\07\\26\\rollout.jsonl",
      },
      [uncRoot],
    ),
  );
});

test("uses the explicit Codex Desktop name from session_index.jsonl", async () => {
  const codexHome = await mkdtemp(
    join(tmpdir(), "usage-pet-thread-repository-"),
  );
  const sessionsRoot = join(codexHome, "sessions");
  const databasePath = join(codexHome, "state_5.sqlite");
  const rolloutPath = join(sessionsRoot, "rollout.jsonl");
  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(rolloutPath, "", "utf8");
  await writeFile(
    join(codexHome, "session_index.jsonl"),
    [
      JSON.stringify({
        id: "019f9e6d-7d8b-77d3-a573-8cbc293afe16",
        thread_name: "  开发 Codex\n状态用量桌宠  ",
        updated_at: "2026-07-26T12:37:36.5409712Z",
      }),
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(codexHome, ".codex-global-state.json"),
    JSON.stringify({
      "electron-persisted-atom-state": {
        "unread-thread-ids-by-host-v1": {
          local: ["019f9e6d-7d8b-77d3-a573-8cbc293afe16"],
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
      "019f9e6d-7d8b-77d3-a573-8cbc293afe16",
      "Initial prompt title",
      "Stale database name",
      "Private prompt preview",
      "C:\\Work\\Usage Pet",
      rolloutPath,
      1_785_000_000,
      1_785_000_000_123,
      1_785_000_000,
      1_785_000_000_100,
      "vscode",
      0,
    );
  database.close();

  const repository = new ThreadRepository(databasePath, [sessionsRoot]);
  try {
    const thread = repository.listRecent(1)[0];
    assert.equal(
      thread?.title,
      "开发 Codex 状态用量桌宠",
    );
    assert.equal(thread?.isUnread, true);
  } finally {
    repository.close();
  }
});
