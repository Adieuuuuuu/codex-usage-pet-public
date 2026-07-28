import {
  normalizeCapturedAt,
  type SessionBusinessStatus,
  type SessionSignal,
  type SessionSignalKind,
  type SessionSignalSource,
} from "./rollout-parser.ts";

type JsonRecord = Record<string, unknown>;

export interface SessionReducerState {
  status: SessionBusinessStatus;
  capturedAt: string | null;
  source: SessionSignalSource | null;
  latestEventAt: number | null;
  pendingRequestInputCallIds: readonly string[];
  waitingWithoutCallId: boolean;
}

export interface SessionSnapshot {
  status: SessionBusinessStatus;
  capturedAt: string | null;
  source: SessionSignalSource | null;
  stale: boolean;
}

export interface SnapshotOptions {
  now?: number | Date;
  staleAfterMs?: number;
}

const STATUS_PRIORITY: Readonly<Record<SessionBusinessStatus, number>> = {
  idle: 0,
  running: 1,
  review: 2,
  waiting: 3,
  failed: 4,
};

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

const normalizedNow = (now: number | Date): number =>
  now instanceof Date ? now.getTime() : now;

const normalizeSnapshotTime = (capturedAt: string | null): number | null => {
  if (capturedAt === null) {
    return null;
  }
  const milliseconds = Date.parse(capturedAt);
  return Number.isFinite(milliseconds) ? milliseconds : null;
};

export const createSessionState = (): SessionReducerState => ({
  status: "idle",
  capturedAt: null,
  source: null,
  latestEventAt: null,
  pendingRequestInputCallIds: [],
  waitingWithoutCallId: false,
});

const withObservation = (
  state: SessionReducerState,
  event: SessionSignal,
  status: SessionBusinessStatus,
  pendingRequestInputCallIds: readonly string[],
  waitingWithoutCallId: boolean,
): SessionReducerState => ({
  ...state,
  status,
  capturedAt: event.capturedAt,
  source: event.source,
  latestEventAt: Date.parse(event.capturedAt),
  pendingRequestInputCallIds,
  waitingWithoutCallId,
});

const hasPendingInput = (
  pendingRequestInputCallIds: readonly string[],
  waitingWithoutCallId: boolean,
): boolean =>
  waitingWithoutCallId || pendingRequestInputCallIds.length > 0;

export const reduceSessionSignal = (
  state: SessionReducerState,
  event: SessionSignal,
): SessionReducerState => {
  const eventAt = Date.parse(event.capturedAt);
  if (
    !Number.isFinite(eventAt) ||
    (state.latestEventAt !== null && eventAt < state.latestEventAt)
  ) {
    return state;
  }

  switch (event.kind) {
    case "session_started":
    case "session_ended":
    case "turn_aborted":
      return withObservation(state, event, "idle", [], false);

    case "task_started":
      return withObservation(state, event, "running", [], false);

    case "task_complete":
      return withObservation(state, event, "review", [], false);

    case "error":
      return withObservation(state, event, "failed", [], false);

    case "permission_request":
      if (event.callId !== undefined) {
        const pendingRequestInputCallIds =
          state.pendingRequestInputCallIds.includes(event.callId)
            ? state.pendingRequestInputCallIds
            : [...state.pendingRequestInputCallIds, event.callId];
        return withObservation(
          state,
          event,
          "waiting",
          pendingRequestInputCallIds,
          state.waitingWithoutCallId,
        );
      }
      return withObservation(
        state,
        event,
        "waiting",
        state.pendingRequestInputCallIds,
        true,
      );

    case "function_call": {
      if (event.requestUserInput !== true) {
        const waiting = hasPendingInput(
          state.pendingRequestInputCallIds,
          state.waitingWithoutCallId,
        );
        return withObservation(
          state,
          event,
          waiting ? "waiting" : "running",
          state.pendingRequestInputCallIds,
          state.waitingWithoutCallId,
        );
      }

      if (event.callId === undefined) {
        return withObservation(
          state,
          event,
          "waiting",
          state.pendingRequestInputCallIds,
          true,
        );
      }

      const pendingRequestInputCallIds =
        state.pendingRequestInputCallIds.includes(event.callId)
          ? state.pendingRequestInputCallIds
          : [...state.pendingRequestInputCallIds, event.callId];
      return withObservation(
        state,
        event,
        "waiting",
        pendingRequestInputCallIds,
        state.waitingWithoutCallId,
      );
    }

    case "function_call_output": {
      const pendingRequestInputCallIds =
        event.callId === undefined
          ? state.pendingRequestInputCallIds
          : state.pendingRequestInputCallIds.filter(
              (callId) => callId !== event.callId,
            );
      const waitingWithoutCallId = false;
      const waiting = hasPendingInput(
        pendingRequestInputCallIds,
        waitingWithoutCallId,
      );
      return withObservation(
        state,
        event,
        waiting ? "waiting" : "running",
        pendingRequestInputCallIds,
        waitingWithoutCallId,
      );
    }
  }
};

export const mergeSessionSignals = (
  ...groups: ReadonlyArray<readonly SessionSignal[]>
): SessionSignal[] =>
  groups
    .flatMap((group) => group)
    .map((event, index) => ({
      event,
      index,
      capturedAt: Date.parse(event.capturedAt),
    }))
    .filter(({ capturedAt }) => Number.isFinite(capturedAt))
    .sort(
      (left, right) =>
        left.capturedAt - right.capturedAt || left.index - right.index,
    )
    .map(({ event }) => event);

export const reduceSessionSignals = (
  signals: readonly SessionSignal[],
  initialState: SessionReducerState = createSessionState(),
): SessionReducerState =>
  mergeSessionSignals(signals).reduce(reduceSessionSignal, initialState);

export const snapshotSession = (
  state: SessionReducerState,
  options: SnapshotOptions = {},
): SessionSnapshot => {
  const now = normalizedNow(options.now ?? Date.now());
  const staleAfterMs = options.staleAfterMs ?? Number.POSITIVE_INFINITY;
  const validStaleAfterMs =
    staleAfterMs === Number.POSITIVE_INFINITY ||
    (Number.isFinite(staleAfterMs) && staleAfterMs >= 0);
  const stale =
    state.latestEventAt === null ||
    !Number.isFinite(now) ||
    !validStaleAfterMs ||
    (state.latestEventAt !== null &&
      staleAfterMs !== Number.POSITIVE_INFINITY &&
      now - state.latestEventAt > staleAfterMs);

  return {
    status: stale ? "idle" : state.status,
    capturedAt: state.capturedAt,
    source: state.source,
    stale,
  };
};

export const selectHighestPriorityStatus = (
  statuses: readonly SessionBusinessStatus[],
): SessionBusinessStatus =>
  statuses.reduce<SessionBusinessStatus>(
    (highest, status) =>
      STATUS_PRIORITY[status] > STATUS_PRIORITY[highest] ? status : highest,
    "idle",
  );

export const aggregateSessionSnapshots = (
  snapshots: readonly SessionSnapshot[],
): SessionSnapshot => {
  if (snapshots.length === 0) {
    return {
      status: "idle",
      capturedAt: null,
      source: null,
      stale: true,
    };
  }

  const highestStatus = selectHighestPriorityStatus(
    snapshots.map(({ status, stale }) => (stale ? "idle" : status)),
  );
  const winner = snapshots
    .filter(
      ({ status, stale }) => (stale ? "idle" : status) === highestStatus,
    )
    .sort(
      (left, right) =>
        (normalizeSnapshotTime(right.capturedAt) ?? Number.NEGATIVE_INFINITY) -
        (normalizeSnapshotTime(left.capturedAt) ?? Number.NEGATIVE_INFINITY),
    )[0];

  if (winner === undefined) {
    return {
      status: "idle",
      capturedAt: null,
      source: null,
      stale: true,
    };
  }

  return {
    ...winner,
    status: highestStatus,
    stale: snapshots.every(({ stale }) => stale),
  };
};

const hookSignal = (
  kind: SessionSignalKind,
  capturedAt: string,
  extra: Pick<SessionSignal, "callId" | "requestUserInput"> = {},
): SessionSignal => ({
  kind,
  capturedAt,
  source: "hook",
  ...extra,
});

/**
 * Converts the metadata-only Hook runner output to the same signal stream as
 * rollout JSONL. Sensitive Hook fields are intentionally not inspected.
 */
export const parseHookEvent = (
  input: unknown,
  fallbackCapturedAt?: unknown,
): SessionSignal | null => {
  if (!isRecord(input)) {
    return null;
  }

  const hookName = normalizeIdentifier(
    firstValue(input, [
      "hook_event_name",
      "hookEventName",
      "event_name",
      "eventName",
      "type",
    ]),
  );
  const capturedAt = normalizeCapturedAt(
    firstValue(input, ["timestamp", "captured_at", "capturedAt"]) ??
      fallbackCapturedAt,
  );
  if (hookName === null || capturedAt === null) {
    return null;
  }

  const callId = firstString(input, [
    "call_id",
    "callId",
    "tool_use_id",
    "toolUseId",
  ]);
  const toolName = normalizeIdentifier(
    firstValue(input, ["tool_name", "toolName"]),
  );
  const callExtra: Pick<SessionSignal, "callId" | "requestUserInput"> = {};
  if (callId !== null) {
    callExtra.callId = callId;
  }
  if (toolName === "request_user_input") {
    callExtra.requestUserInput = true;
  }

  switch (hookName) {
    case "session_start":
    case "session_started":
      return hookSignal("session_started", capturedAt);
    case "user_prompt_submit":
      return hookSignal("task_started", capturedAt);
    case "pre_tool_use":
      return hookSignal("function_call", capturedAt, callExtra);
    case "post_tool_use":
      return hookSignal("function_call_output", capturedAt, callExtra);
    case "permission_request":
      return hookSignal("permission_request", capturedAt, callExtra);
    case "stop":
      return hookSignal("task_complete", capturedAt);
    case "session_end":
    case "session_ended":
      return hookSignal("session_ended", capturedAt);
    default:
      return null;
  }
};
