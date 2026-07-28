import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("Hook runner stores only bounded status metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "usage-pet-hook-"));
  const dataDirectory = join(root, "data");
  const secret = "PRIVATE prompt and output must not be persisted";
  const runner = resolve("hooks", "codex-hook.cjs");
  const result = spawnSync(process.execPath, [runner], {
    input: JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "019f9e6d-7d8b-77d3-a573-8cbc293afe16",
      turn_id: "turn-safe",
      prompt: secret,
      tool_input: { private: secret },
      tool_output: secret,
    }),
    encoding: "utf8",
    env: {
      ...process.env,
      APPDATA: root,
      USAGE_PET_DATA_DIR: dataDirectory,
    },
    windowsHide: true,
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "{}");
  const line = readFileSync(
    join(dataDirectory, "hook-events.jsonl"),
    "utf8",
  ).trim();
  const observation = JSON.parse(line) as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(observation).sort(),
    ["capturedAt", "hookEventName", "threadId", "turnId"].sort(),
  );
  assert.equal(observation.hookEventName, "UserPromptSubmit");
  assert.equal(
    observation.threadId,
    "019f9e6d-7d8b-77d3-a573-8cbc293afe16",
  );
  assert.equal(line.includes(secret), false);
});

test("Hook runner bounds its metadata event file", () => {
  const root = mkdtempSync(join(tmpdir(), "usage-pet-hook-bound-"));
  const dataDirectory = join(root, "data");
  const eventFile = join(dataDirectory, "hook-events.jsonl");
  mkdirSync(dataDirectory, { recursive: true });
  writeFileSync(eventFile, Buffer.alloc(4 * 1024 * 1024, 0x78));

  const runner = resolve("hooks", "codex-hook.cjs");
  const result = spawnSync(process.execPath, [runner], {
    input: JSON.stringify({
      hook_event_name: "Stop",
      session_id: "019f9e6d-7d8b-77d3-a573-8cbc293afe16",
    }),
    encoding: "utf8",
    env: {
      ...process.env,
      APPDATA: root,
      USAGE_PET_DATA_DIR: dataDirectory,
    },
    windowsHide: true,
  });

  assert.equal(result.status, 0);
  assert.ok(statSync(eventFile).size < 1_024);
  const observation = JSON.parse(
    readFileSync(eventFile, "utf8").trim(),
  ) as Record<string, unknown>;
  assert.equal(observation.hookEventName, "Stop");
});
