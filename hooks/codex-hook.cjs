"use strict";

const {
  appendFileSync,
  mkdirSync,
  statSync,
  truncateSync,
} = require("node:fs");
const { join } = require("node:path");
const { spawn } = require("node:child_process");

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_EVENT_FILE_BYTES = 4 * 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_SEARCH =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const ALLOWED_EVENTS = new Set([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "Stop",
  "SessionEnd",
]);

const safeString = (value, maxLength = 128) =>
  typeof value === "string" && value.length > 0
    ? value.slice(0, maxLength)
    : undefined;

const first = (record, keys) => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }
  return undefined;
};

const findThreadId = (input) => {
  const direct = first(input, [
    "thread_id",
    "threadId",
    "session_id",
    "sessionId",
    "conversation_id",
    "conversationId",
  ]);
  if (typeof direct === "string" && UUID_PATTERN.test(direct)) {
    return direct;
  }

  const transcript = first(input, [
    "transcript_path",
    "transcriptPath",
  ]);
  if (typeof transcript !== "string") {
    return null;
  }
  return transcript.match(UUID_SEARCH)?.[0] ?? null;
};

const normalizeEventName = (value) => {
  if (typeof value !== "string") {
    return null;
  }
  const compact = value.replace(/[_\s-]+/g, "").toLowerCase();
  for (const allowed of ALLOWED_EVENTS) {
    if (allowed.toLowerCase() === compact) {
      return allowed;
    }
  }
  return null;
};

const launchUsagePet = () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;

  try {
    const child = spawn(process.execPath, ["--from-codex-hook"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env,
    });
    child.unref();
  } catch {
    // The next login start or manual launch remains a safe fallback.
  }
};

const persistObservation = (input) => {
  const hookEventName = normalizeEventName(
    first(input, [
      "hook_event_name",
      "hookEventName",
      "event_name",
      "eventName",
      "type",
    ]),
  );
  const threadId = findThreadId(input);
  if (hookEventName === null || threadId === null) {
    return;
  }

  const record = {
    hookEventName,
    threadId,
    capturedAt: new Date().toISOString(),
  };

  const turnId = safeString(
    first(input, ["turn_id", "turnId"]),
  );
  const toolName = safeString(
    first(input, ["tool_name", "toolName"]),
  );
  const callId = safeString(
    first(input, [
      "call_id",
      "callId",
      "tool_use_id",
      "toolUseId",
    ]),
  );
  if (turnId !== undefined) {
    record.turnId = turnId;
  }
  if (toolName !== undefined) {
    record.toolName = toolName;
  }
  if (callId !== undefined) {
    record.callId = callId;
  }

  const appData = process.env.APPDATA;
  if (typeof appData !== "string" || appData.length === 0) {
    return;
  }
  const dataDirectory =
    process.env.USAGE_PET_DATA_DIR || join(appData, "Usage Pet");
  mkdirSync(dataDirectory, { recursive: true });
  const eventFile = join(dataDirectory, "hook-events.jsonl");
  try {
    if (statSync(eventFile).size >= MAX_EVENT_FILE_BYTES) {
      truncateSync(eventFile, 0);
    }
  } catch {
    // The file normally does not exist before the first Hook event.
  }
  appendFileSync(
    eventFile,
    `${JSON.stringify(record)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  if (hookEventName === "SessionStart") {
    launchUsagePet();
  }
};

let inputText = "";
let exceededLimit = false;

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  if (exceededLimit) {
    return;
  }
  inputText += chunk;
  if (Buffer.byteLength(inputText, "utf8") > MAX_INPUT_BYTES) {
    inputText = "";
    exceededLimit = true;
  }
});

process.stdin.on("end", () => {
  try {
    if (!exceededLimit) {
      const parsed = JSON.parse(inputText);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        persistObservation(parsed);
      }
    }
  } catch {
    // Hooks must never block Codex because the observer could not parse input.
  } finally {
    process.stdout.write("{}\n");
  }
});

process.stdin.resume();
