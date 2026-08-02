import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateWeeklyRateLimit,
  isWeeklyRateLimitFresh,
  parseRolloutJsonl,
  parseRolloutLine,
  parseRolloutRecord,
  selectWeeklyRateLimit,
} from "../src/services/rollout-parser.ts";

const SECRET_PROMPT = "SECRET prompt should never leave the parser";
const SECRET_OUTPUT = "SECRET output should never leave the parser";
const SECRET_ERROR = "SECRET error detail should never leave the parser";

test("parses real snake_case lifecycle records without retaining body fields", () => {
  const taskStarted = parseRolloutRecord({
    timestamp: "2026-07-26T10:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "task_started",
      prompt: SECRET_PROMPT,
      message: SECRET_PROMPT,
    },
  });
  const taskComplete = parseRolloutRecord({
    timestamp: "2026-07-26T10:01:00.000Z",
    type: "event_msg",
    payload: {
      type: "task_complete",
      last_agent_message: SECRET_OUTPUT,
    },
  });
  const turnAborted = parseRolloutRecord({
    timestamp: "2026-07-26T10:02:00.000Z",
    type: "event_msg",
    payload: {
      type: "turn_aborted",
      reason: SECRET_PROMPT,
    },
  });
  const error = parseRolloutRecord({
    timestamp: "2026-07-26T10:03:00.000Z",
    type: "event_msg",
    payload: {
      type: "error",
      message: SECRET_ERROR,
    },
  });

  assert.deepEqual(
    [
      taskStarted.signals[0]?.kind,
      taskComplete.signals[0]?.kind,
      turnAborted.signals[0]?.kind,
      error.signals[0]?.kind,
    ],
    ["task_started", "task_complete", "turn_aborted", "error"],
  );
  const serialized = JSON.stringify([
    taskStarted,
    taskComplete,
    turnAborted,
    error,
  ]);
  assert.equal(serialized.includes(SECRET_PROMPT), false);
  assert.equal(serialized.includes(SECRET_OUTPUT), false);
  assert.equal(serialized.includes(SECRET_ERROR), false);
});

test("tracks request_user_input by call id but never retains arguments or output", () => {
  const call = parseRolloutRecord({
    timestamp: "2026-07-26T10:00:00.000Z",
    type: "response_item",
    payload: {
      type: "function_call",
      name: "request_user_input",
      arguments: JSON.stringify({ question: SECRET_PROMPT }),
      call_id: "call-safe-metadata",
    },
  });
  const output = parseRolloutRecord({
    timestamp: "2026-07-26T10:00:05.000Z",
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: "call-safe-metadata",
      output: SECRET_OUTPUT,
    },
  });

  assert.deepEqual(call.signals, [
    {
      kind: "function_call",
      capturedAt: "2026-07-26T10:00:00.000Z",
      source: "rollout",
      callId: "call-safe-metadata",
      requestUserInput: true,
    },
  ]);
  assert.deepEqual(output.signals, [
    {
      kind: "function_call_output",
      capturedAt: "2026-07-26T10:00:05.000Z",
      source: "rollout",
      callId: "call-safe-metadata",
    },
  ]);
  const serialized = JSON.stringify([call, output]);
  assert.equal(serialized.includes(SECRET_PROMPT), false);
  assert.equal(serialized.includes(SECRET_OUTPUT), false);
  assert.equal(serialized.includes('"arguments":'), false);
  assert.equal(serialized.includes('"output":'), false);
});

test("accepts camelCase record, payload, and call-id variants", () => {
  const started = parseRolloutRecord({
    timestamp: "2026-07-26T10:00:00Z",
    type: "eventMsg",
    payload: { type: "taskStarted" },
  });
  const call = parseRolloutRecord({
    capturedAt: "2026-07-26T10:00:01Z",
    type: "responseItem",
    payload: {
      type: "functionCall",
      functionName: "requestUserInput",
      callId: "camel-call",
      arguments: SECRET_PROMPT,
    },
  });
  const output = parseRolloutRecord({
    captured_at: "2026-07-26T10:00:02Z",
    type: "response-item",
    payload: {
      type: "functionCallOutput",
      toolUseId: "camel-call",
      output: SECRET_OUTPUT,
    },
  });

  assert.equal(started.signals[0]?.kind, "task_started");
  assert.equal(call.signals[0]?.requestUserInput, true);
  assert.equal(call.signals[0]?.callId, "camel-call");
  assert.equal(output.signals[0]?.kind, "function_call_output");
  assert.equal(output.signals[0]?.callId, "camel-call");
});

test("chooses the longest rate-limit window instead of assuming primary/secondary meaning", () => {
  const capturedAt = "2026-07-26T10:00:00.000Z";
  const usage = selectWeeklyRateLimit(
    {
      primary: {
        used_percent: 11,
        window_minutes: 300,
        resets_at: 1_785_200_000,
      },
      secondary: {
        used_percent: 4,
        window_minutes: 10_080,
        resets_at: 1_785_800_000,
      },
      credits: { balance: "not a rate window" },
    },
    capturedAt,
  );

  assert.deepEqual(usage, {
    remainingPercent: 96,
    usedPercent: 4,
    windowDurationMins: 10_080,
    resetsAt: 1_785_800_000,
    capturedAt,
    source: "rollout",
  });
});

test("parses camelCase token_count payloads and clamps invalid percentages", () => {
  const parsed = parseRolloutRecord({
    timestamp: "2026-07-26T10:00:00.000Z",
    type: "eventMsg",
    payload: {
      type: "tokenCount",
      rateLimits: {
        short: {
          usedPercent: -2,
          windowMinutes: 60,
          resetsAt: 1_785_800_000,
        },
        weekly: {
          usedPercent: 104,
          windowDurationMins: 10_080,
          resetsAt: 1_785_900_000,
        },
      },
    },
  });

  assert.equal(parsed.weeklyUsage?.usedPercent, 100);
  assert.equal(parsed.weeklyUsage?.remainingPercent, 0);
  assert.equal(parsed.weeklyUsage?.windowDurationMins, 10_080);
});

test("chooses the newest usage capture even when JSONL records arrive out of order", () => {
  const newest = JSON.stringify({
    timestamp: "2026-07-26T12:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      rate_limits: {
        weekly: {
          used_percent: 8,
          window_minutes: 10_080,
          resets_at: 1_785_900_000,
        },
      },
    },
  });
  const older = JSON.stringify({
    timestamp: "2026-07-26T11:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      rate_limits: {
        weekly: {
          used_percent: 2,
          window_minutes: 10_080,
          resets_at: 1_785_900_000,
        },
      },
    },
  });

  const parsed = parseRolloutJsonl(
    [newest, '{"partial":', older, ""].join("\n"),
  );

  assert.equal(parsed.weeklyUsage?.usedPercent, 8);
  assert.equal(parsed.weeklyUsage?.remainingPercent, 92);
});

test("marks an elapsed reset as stale without fabricating a fresh 100 percent", () => {
  const snapshot = selectWeeklyRateLimit(
    {
      weekly: {
        used_percent: 37,
        window_minutes: 10_080,
        resets_at: 1_785_000_000,
      },
    },
    "2026-07-26T10:00:00.000Z",
  );
  assert.ok(snapshot);

  const afterReset = 1_785_000_001_000;
  assert.equal(isWeeklyRateLimitFresh(snapshot, afterReset), false);
  assert.deepEqual(evaluateWeeklyRateLimit(snapshot, afterReset), {
    status: "stale",
    weekly: snapshot,
    reason: "The captured rate-limit window has reset.",
  });
  assert.equal(snapshot.remainingPercent, 63);
});

test("marks an old OpenCodex cache value as stale while preserving its percent", () => {
  const snapshot = {
    remainingPercent: 96,
    usedPercent: 4,
    windowDurationMins: 10_080,
    resetsAt: 1_786_159_991,
    capturedAt: "2026-08-01T10:00:00.000Z",
    source: "opencodex-quota-cache" as const,
    stale: true,
  };

  assert.deepEqual(evaluateWeeklyRateLimit(snapshot, 1_785_625_000_000), {
    status: "stale",
    weekly: snapshot,
    reason: "The OpenCodex quota cache is waiting for refresh.",
  });
});

test("returns empty metadata for malformed or unrelated lines", () => {
  assert.deepEqual(parseRolloutLine('{"incomplete":'), {
    signals: [],
    weeklyUsage: null,
  });
  assert.deepEqual(
    parseRolloutRecord({
      timestamp: "2026-07-26T10:00:00Z",
      type: "response_item",
      payload: { type: "agent_message", message: SECRET_OUTPUT },
    }),
    { signals: [], weeklyUsage: null },
  );
});
