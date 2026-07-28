import assert from "node:assert/strict";
import test from "node:test";

import type { SessionSignal } from "../src/services/rollout-parser.ts";
import {
  aggregateSessionSnapshots,
  createSessionState,
  mergeSessionSignals,
  parseHookEvent,
  reduceSessionSignal,
  reduceSessionSignals,
  selectHighestPriorityStatus,
  snapshotSession,
} from "../src/services/session-reducer.ts";

const rolloutSignal = (
  kind: SessionSignal["kind"],
  capturedAt: string,
  extra: Pick<SessionSignal, "callId" | "requestUserInput"> = {},
): SessionSignal => ({
  kind,
  capturedAt,
  source: "rollout",
  ...extra,
});

test("keeps a started task running until a terminal event arrives", () => {
  const state = reduceSessionSignal(
    createSessionState(),
    rolloutSignal("task_started", "2026-07-26T10:00:00.000Z"),
  );

  assert.equal(state.status, "running");
  assert.deepEqual(
    snapshotSession(state, {
      now: Date.parse("2026-07-26T10:04:00.000Z"),
    }),
    {
      status: "running",
      capturedAt: "2026-07-26T10:00:00.000Z",
      source: "rollout",
      stale: false,
    },
  );
});

test("only an outstanding request_user_input call produces waiting", () => {
  const signals: SessionSignal[] = [
    rolloutSignal("task_started", "2026-07-26T10:00:00.000Z"),
    rolloutSignal("function_call", "2026-07-26T10:00:01.000Z", {
      callId: "ordinary-call",
    }),
    rolloutSignal("function_call_output", "2026-07-26T10:00:02.000Z", {
      callId: "ordinary-call",
    }),
    rolloutSignal("function_call", "2026-07-26T10:00:03.000Z", {
      callId: "input-call",
      requestUserInput: true,
    }),
  ];

  const waiting = reduceSessionSignals(signals);
  assert.equal(waiting.status, "waiting");
  assert.deepEqual(waiting.pendingRequestInputCallIds, ["input-call"]);

  const unrelatedOutput = reduceSessionSignal(
    waiting,
    rolloutSignal("function_call_output", "2026-07-26T10:00:04.000Z", {
      callId: "ordinary-call",
    }),
  );
  assert.equal(unrelatedOutput.status, "waiting");

  const resumed = reduceSessionSignal(
    unrelatedOutput,
    rolloutSignal("function_call_output", "2026-07-26T10:00:05.000Z", {
      callId: "input-call",
    }),
  );
  assert.equal(resumed.status, "running");
  assert.deepEqual(resumed.pendingRequestInputCallIds, []);
});

test("maps task completion to review, abort to idle, and error to failed", () => {
  const started = reduceSessionSignal(
    createSessionState(),
    rolloutSignal("task_started", "2026-07-26T10:00:00.000Z"),
  );
  const reviewed = reduceSessionSignal(
    started,
    rolloutSignal("task_complete", "2026-07-26T10:01:00.000Z"),
  );
  assert.equal(reviewed.status, "review");

  const aborted = reduceSessionSignal(
    started,
    rolloutSignal("turn_aborted", "2026-07-26T10:01:00.000Z"),
  );
  assert.equal(aborted.status, "idle");

  const failed = reduceSessionSignal(
    started,
    rolloutSignal("error", "2026-07-26T10:01:00.000Z"),
  );
  assert.equal(failed.status, "failed");
});

test("sorts merged Hook and rollout signals and ignores an older late arrival", () => {
  const completed = rolloutSignal(
    "task_complete",
    "2026-07-26T10:00:05.000Z",
  );
  const permission = parseHookEvent({
    hookEventName: "PermissionRequest",
    timestamp: "2026-07-26T10:00:10.000Z",
    prompt: "private permission explanation",
  });
  assert.ok(permission);

  const merged = mergeSessionSignals([permission], [completed]);
  assert.deepEqual(
    merged.map(({ kind }) => kind),
    ["task_complete", "permission_request"],
  );
  const waiting = reduceSessionSignals([permission, completed]);
  assert.equal(waiting.status, "waiting");
  assert.equal(waiting.source, "hook");
  assert.equal(waiting.capturedAt, "2026-07-26T10:00:10.000Z");

  const unchanged = reduceSessionSignal(
    waiting,
    rolloutSignal("task_started", "2026-07-26T09:59:00.000Z"),
  );
  assert.strictEqual(unchanged, waiting);
});

test("clears Hook permission waiting when the matching tool call finishes", () => {
  const permission = parseHookEvent({
    hook_event_name: "PermissionRequest",
    timestamp: "2026-07-26T10:00:00.000Z",
    tool_use_id: "permission-call",
  });
  const finished = parseHookEvent({
    hook_event_name: "PostToolUse",
    timestamp: "2026-07-26T10:00:01.000Z",
    tool_use_id: "permission-call",
  });
  assert.ok(permission);
  assert.ok(finished);

  const state = reduceSessionSignals([permission, finished]);
  assert.equal(state.status, "running");
  assert.deepEqual(state.pendingRequestInputCallIds, []);
  assert.equal(state.waitingWithoutCallId, false);
});

test("clears anonymous Hook permission waiting on the next tool completion", () => {
  const permission = parseHookEvent({
    hook_event_name: "PermissionRequest",
    timestamp: "2026-07-26T10:00:00.000Z",
  });
  const finished = parseHookEvent({
    hook_event_name: "PostToolUse",
    timestamp: "2026-07-26T10:00:01.000Z",
    tool_use_id: "tool-call-with-id",
  });
  assert.ok(permission);
  assert.ok(finished);

  const state = reduceSessionSignals([permission, finished]);
  assert.equal(state.status, "running");
  assert.equal(state.waitingWithoutCallId, false);
});

test("parses snake_case and camelCase Hook metadata without copying private bodies", () => {
  const preTool = parseHookEvent({
    hook_event_name: "PreToolUse",
    timestamp: "2026-07-26T10:00:00.000Z",
    tool_name: "request_user_input",
    tool_use_id: "hook-call",
    tool_input: { prompt: "private body" },
  });
  const postTool = parseHookEvent({
    eventName: "PostToolUse",
    capturedAt: "2026-07-26T10:00:01.000Z",
    toolName: "requestUserInput",
    toolUseId: "hook-call",
    toolOutput: "private body",
  });
  assert.ok(preTool);
  assert.ok(postTool);

  assert.deepEqual(preTool, {
    kind: "function_call",
    capturedAt: "2026-07-26T10:00:00.000Z",
    source: "hook",
    callId: "hook-call",
    requestUserInput: true,
  });
  assert.deepEqual(postTool, {
    kind: "function_call_output",
    capturedAt: "2026-07-26T10:00:01.000Z",
    source: "hook",
    callId: "hook-call",
    requestUserInput: true,
  });
  assert.equal(JSON.stringify([preTool, postTool]).includes("private body"), false);
});

test("Hook Stop completes to review and SessionEnd returns to idle", () => {
  const started = parseHookEvent(
    { hook_event_name: "UserPromptSubmit" },
    "2026-07-26T10:00:00.000Z",
  );
  const stopped = parseHookEvent(
    { hook_event_name: "Stop" },
    "2026-07-26T10:01:00.000Z",
  );
  const ended = parseHookEvent(
    { hook_event_name: "SessionEnd" },
    "2026-07-26T10:02:00.000Z",
  );
  assert.ok(started);
  assert.ok(stopped);
  assert.ok(ended);

  assert.equal(reduceSessionSignals([stopped, started]).status, "review");
  assert.equal(reduceSessionSignals([ended, stopped, started]).status, "idle");
});

test("explicit freshness policy downgrades an old state to idle", () => {
  const state = reduceSessionSignals([
    rolloutSignal("task_started", "2026-07-26T10:00:00.000Z"),
  ]);

  assert.deepEqual(
    snapshotSession(state, {
      now: Date.parse("2026-07-26T10:10:00.001Z"),
      staleAfterMs: 10 * 60 * 1_000,
    }),
    {
      status: "idle",
      capturedAt: "2026-07-26T10:00:00.000Z",
      source: "rollout",
      stale: true,
    },
  );
});

test("aggregates task states using failed > waiting > review > running > idle", () => {
  assert.equal(
    selectHighestPriorityStatus([
      "idle",
      "running",
      "review",
      "failed",
      "waiting",
    ]),
    "failed",
  );
  assert.equal(
    selectHighestPriorityStatus(["idle", "running", "review", "failed"]),
    "failed",
  );

  const aggregate = aggregateSessionSnapshots([
    {
      status: "failed",
      capturedAt: "2026-07-26T10:00:02.000Z",
      source: "rollout",
      stale: false,
    },
    {
      status: "waiting",
      capturedAt: "2026-07-26T10:00:01.000Z",
      source: "hook",
      stale: false,
    },
    {
      status: "review",
      capturedAt: "2026-07-26T10:00:03.000Z",
      source: "rollout",
      stale: false,
    },
  ]);
  assert.equal(aggregate.status, "failed");
  assert.equal(aggregate.source, "rollout");

  const staleFailure = aggregateSessionSnapshots([
    {
      status: "failed",
      capturedAt: "2026-07-26T09:00:00.000Z",
      source: "rollout",
      stale: true,
    },
    {
      status: "running",
      capturedAt: "2026-07-26T10:00:00.000Z",
      source: "hook",
      stale: false,
    },
  ]);
  assert.equal(staleFailure.status, "running");
});
