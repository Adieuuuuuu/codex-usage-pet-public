import type {
  UsageSnapshot,
  UsageWindowSnapshot,
} from "../shared/contracts.ts";

export type SessionBusinessStatus =
  | "idle"
  | "running"
  | "waiting"
  | "review"
  | "failed";

export type SessionSignalSource = "rollout" | "hook";

export type SessionSignalKind =
  | "session_started"
  | "session_ended"
  | "task_started"
  | "task_complete"
  | "turn_aborted"
  | "error"
  | "function_call"
  | "function_call_output"
  | "permission_request";

/**
 * A deliberately small, privacy-safe representation of a Codex event.
 * Arguments, prompts, messages, and function output are never copied here.
 */
export interface SessionSignal {
  kind: SessionSignalKind;
  capturedAt: string;
  source: SessionSignalSource;
  callId?: string;
  requestUserInput?: boolean;
}

export interface RolloutParseResult {
  signals: SessionSignal[];
  weeklyUsage: UsageWindowSnapshot | null;
}

type JsonRecord = Record<string, unknown>;

interface RateLimitCandidate {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt: number;
}

const EMPTY_RESULT = (): RolloutParseResult => ({
  signals: [],
  weeklyUsage: null,
});

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const firstValue = (
  record: JsonRecord,
  keys: readonly string[],
): unknown => {
  for (const key of keys) {
    if (Object.hasOwn(record, key)) {
      return record[key];
    }
  }
  return undefined;
};

const firstString = (
  record: JsonRecord,
  keys: readonly string[],
): string | null => {
  const value = firstValue(record, keys);
  return typeof value === "string" && value.length > 0 ? value : null;
};

const normalizeIdentifier = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toEpochMilliseconds = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1_000 : value;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const normalizeCapturedAt = (value: unknown): string | null => {
  const milliseconds = toEpochMilliseconds(value);
  if (milliseconds === null) {
    return null;
  }

  try {
    return new Date(milliseconds).toISOString();
  } catch {
    return null;
  }
};

const normalizeResetSeconds = (value: unknown): number | null => {
  const milliseconds = toEpochMilliseconds(value);
  return milliseconds === null ? null : Math.trunc(milliseconds / 1_000);
};

const parseRateLimitCandidate = (
  value: unknown,
): RateLimitCandidate | null => {
  if (!isRecord(value)) {
    return null;
  }

  const usedPercent = toFiniteNumber(
    firstValue(value, ["used_percent", "usedPercent"]),
  );
  const windowDurationMins = toFiniteNumber(
    firstValue(value, [
      "window_minutes",
      "windowMinutes",
      "window_duration_mins",
      "windowDurationMins",
    ]),
  );
  const resetsAt = normalizeResetSeconds(
    firstValue(value, ["resets_at", "resetsAt"]),
  );

  if (
    usedPercent === null ||
    windowDurationMins === null ||
    windowDurationMins <= 0 ||
    resetsAt === null
  ) {
    return null;
  }

  return {
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    windowDurationMins,
    resetsAt,
  };
};

/**
 * Codex does not guarantee that primary/secondary always mean the same period.
 * The longest advertised window is therefore treated as the weekly window.
 */
export const selectWeeklyRateLimit = (
  rateLimits: unknown,
  capturedAtValue: unknown,
): UsageWindowSnapshot | null => {
  if (!isRecord(rateLimits)) {
    return null;
  }

  const capturedAt = normalizeCapturedAt(capturedAtValue);
  if (capturedAt === null) {
    return null;
  }

  const candidates = Object.values(rateLimits)
    .map(parseRateLimitCandidate)
    .filter((candidate): candidate is RateLimitCandidate => candidate !== null)
    .sort(
      (left, right) =>
        right.windowDurationMins - left.windowDurationMins ||
        right.resetsAt - left.resetsAt,
    );
  const weekly = candidates[0];
  if (weekly === undefined) {
    return null;
  }

  return {
    remainingPercent: Math.min(
      100,
      Math.max(0, 100 - weekly.usedPercent),
    ),
    usedPercent: weekly.usedPercent,
    windowDurationMins: weekly.windowDurationMins,
    resetsAt: weekly.resetsAt,
    capturedAt,
    source: "rollout",
  };
};

export const isWeeklyRateLimitFresh = (
  snapshot: UsageWindowSnapshot,
  now: number | Date = Date.now(),
): boolean => {
  const nowMilliseconds = now instanceof Date ? now.getTime() : now;
  return (
    Number.isFinite(nowMilliseconds) &&
    snapshot.resetsAt * 1_000 > nowMilliseconds
  );
};

/**
 * Converts a captured window into the renderer contract without inventing a
 * reset. Once resetsAt has passed, the old percentage remains as provenance
 * but its status is explicitly stale.
 */
export const evaluateWeeklyRateLimit = (
  snapshot: UsageWindowSnapshot | null,
  now: number | Date = Date.now(),
): UsageSnapshot => {
  if (snapshot === null) {
    return {
      status: "unavailable",
      weekly: null,
      reason: "No weekly rate-limit window was found.",
    };
  }

  if (!isWeeklyRateLimitFresh(snapshot, now)) {
    return {
      status: "stale",
      weekly: snapshot,
      reason: "The captured rate-limit window has reset.",
    };
  }

  return {
    status: "available",
    weekly: snapshot,
  };
};

const signal = (
  kind: SessionSignalKind,
  capturedAt: string,
  extra: Pick<SessionSignal, "callId" | "requestUserInput"> = {},
): SessionSignal => ({
  kind,
  capturedAt,
  source: "rollout",
  ...extra,
});

export const parseRolloutRecord = (input: unknown): RolloutParseResult => {
  if (!isRecord(input)) {
    return EMPTY_RESULT();
  }

  const capturedAt = normalizeCapturedAt(
    firstValue(input, ["timestamp", "captured_at", "capturedAt"]),
  );
  const recordType = normalizeIdentifier(firstValue(input, ["type"]));
  const payload = firstValue(input, ["payload"]);
  if (
    capturedAt === null ||
    recordType === null ||
    !isRecord(payload)
  ) {
    return EMPTY_RESULT();
  }

  const payloadType = normalizeIdentifier(firstValue(payload, ["type"]));
  if (payloadType === null) {
    return EMPTY_RESULT();
  }

  if (recordType === "event_msg") {
    if (
      payloadType === "task_started" ||
      payloadType === "task_complete" ||
      payloadType === "turn_aborted" ||
      payloadType === "error"
    ) {
      return {
        signals: [signal(payloadType, capturedAt)],
        weeklyUsage: null,
      };
    }

    if (payloadType === "token_count") {
      const rateLimits = firstValue(payload, ["rate_limits", "rateLimits"]);
      return {
        signals: [],
        weeklyUsage: selectWeeklyRateLimit(rateLimits, capturedAt),
      };
    }

    return EMPTY_RESULT();
  }

  if (recordType !== "response_item") {
    return EMPTY_RESULT();
  }

  const callId = firstString(payload, [
    "call_id",
    "callId",
    "tool_use_id",
    "toolUseId",
  ]);

  if (payloadType === "function_call") {
    const functionName = normalizeIdentifier(
      firstValue(payload, ["name", "function_name", "functionName"]),
    );
    const extra: Pick<SessionSignal, "callId" | "requestUserInput"> = {};
    if (callId !== null) {
      extra.callId = callId;
    }
    if (functionName === "request_user_input") {
      extra.requestUserInput = true;
    }

    return {
      signals: [signal("function_call", capturedAt, extra)],
      weeklyUsage: null,
    };
  }

  if (payloadType === "function_call_output") {
    const extra: Pick<SessionSignal, "callId"> = {};
    if (callId !== null) {
      extra.callId = callId;
    }
    return {
      signals: [signal("function_call_output", capturedAt, extra)],
      weeklyUsage: null,
    };
  }

  return EMPTY_RESULT();
};

export const parseRolloutLine = (line: string): RolloutParseResult => {
  if (line.trim().length === 0) {
    return EMPTY_RESULT();
  }

  try {
    return parseRolloutRecord(JSON.parse(line) as unknown);
  } catch {
    // A tailer may briefly observe a partial final line. It is retried once
    // more bytes arrive rather than being surfaced as a fabricated state.
    return EMPTY_RESULT();
  }
};

export const parseRolloutJsonl = (jsonl: string): RolloutParseResult => {
  const result = EMPTY_RESULT();
  let latestUsageAt = Number.NEGATIVE_INFINITY;

  for (const line of jsonl.split(/\r?\n/)) {
    const parsed = parseRolloutLine(line);
    result.signals.push(...parsed.signals);

    if (parsed.weeklyUsage !== null) {
      const capturedAt = Date.parse(parsed.weeklyUsage.capturedAt);
      if (capturedAt >= latestUsageAt) {
        result.weeklyUsage = parsed.weeklyUsage;
        latestUsageAt = capturedAt;
      }
    }
  }

  return result;
};
