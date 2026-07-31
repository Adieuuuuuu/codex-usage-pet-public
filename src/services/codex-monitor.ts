import { execFile } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readSync,
} from "node:fs";
import { uptime } from "node:os";
import { promisify } from "node:util";

import type {
  AppSnapshot,
  TaskNotificationSnapshot,
  TaskSnapshot,
  UsageSnapshot,
  UsageWindowSnapshot,
} from "../shared/contracts.ts";
import {
  evaluateWeeklyRateLimit,
  parseRolloutLine,
  type SessionSignal,
} from "./rollout-parser.ts";
import {
  createSessionState,
  reduceSessionSignal,
  selectHighestPriorityStatus,
  type SessionReducerState,
} from "./session-reducer.ts";
import {
  HookEventStore,
  type HookObservation,
} from "./hook-event-store.ts";
import {
  type CodexThreadRecord,
  ThreadRepository,
} from "./thread-repository.ts";

export interface CodexMonitorSnapshot {
  primaryState: AppSnapshot["primaryState"];
  usage: UsageSnapshot;
  tasks: TaskSnapshot[];
  notificationTasks: TaskNotificationSnapshot[];
  codexRunning: boolean;
  hookMode: AppSnapshot["hookMode"];
}

interface RolloutCursor {
  offset: number | null;
  remainder: string;
  discardFirstPartialLine: boolean;
}

interface TrackedSession {
  thread: CodexThreadRecord;
  reducer: SessionReducerState;
  cursor: RolloutCursor;
  latestUsage: UsageWindowSnapshot | null;
  rolloutReadable: boolean;
}

interface RolloutReadResult {
  lines: string[];
  readable: boolean;
}

const execFileAsync = promisify(execFile);
const INITIAL_TAIL_BYTES = 4 * 1024 * 1024;
const READ_CHUNK_BYTES = 1024 * 1024;
const HOOK_CONNECTED_MS = 5 * 60 * 1_000;
const ACTIVE_STATUS_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const REVIEW_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const FAILED_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const RECENT_THREAD_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1_000;
const PENDING_HOOK_MAX_AGE_MS = 10 * 60 * 1_000;
const PENDING_HOOK_MAX_EVENTS = 256;

export type CodexProcessDetector = () => Promise<boolean>;

const RELEVANT_ROLLOUT_LINE =
  /"type"\s*:\s*"(?:task_started|task_complete|turn_aborted|error|token_count|function_call|function_call_output)"|request_user_input/;

const detectCodexProcess: CodexProcessDetector = async () => {
  if (process.platform !== "win32") {
    return false;
  }
  try {
    const { stdout } = await execFileAsync(
      "C:\\Windows\\System32\\tasklist.exe",
      ["/FI", "IMAGENAME eq Codex.exe", "/FO", "CSV", "/NH"],
      {
        windowsHide: true,
        timeout: 3_000,
        encoding: "utf8",
      },
    );
    if (/"Codex\.exe"/i.test(stdout)) {
      return true;
    }
  } catch {
    // Some managed Windows sessions deny tasklist access even though
    // Get-Process can still query a process by its fixed executable name.
  }

  try {
    await execFileAsync(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "if (Get-Process -Name Codex -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }",
      ],
      {
        windowsHide: true,
        timeout: 3_000,
        encoding: "utf8",
      },
    );
    return true;
  } catch {
    return false;
  }
};

const emptySnapshot = (): CodexMonitorSnapshot => ({
  primaryState: "idle",
  usage: {
    status: "unavailable",
    weekly: null,
    reason: "Codex usage data has not been observed yet.",
  },
  tasks: [],
  notificationTasks: [],
  codexRunning: false,
  hookMode: "fallback",
});

const statusMaxAge = (
  status: SessionReducerState["status"],
): number => {
  switch (status) {
    case "running":
    case "waiting":
      return ACTIVE_STATUS_MAX_AGE_MS;
    case "review":
      return REVIEW_MAX_AGE_MS;
    case "failed":
      return FAILED_MAX_AGE_MS;
    case "idle":
      return 0;
  }
};

export const shouldShowTaskForProcessState = (
  status: SessionReducerState["status"],
  codexProcessKnown: boolean,
  codexRunning: boolean,
): boolean =>
  status !== "running" || !codexProcessKnown || codexRunning;

export const isVolatileTaskFromCurrentWindowsSession = (
  status: SessionReducerState["status"],
  eventAt: number,
  windowsSessionStartedAt: number,
): boolean =>
  (status !== "running" && status !== "waiting") ||
  eventAt >= windowsSessionStartedAt;

export const shouldShowReviewTask = (
  isUnread: boolean,
  eventAt: number,
  acknowledgedAt: number | undefined,
): boolean => isUnread && eventAt !== acknowledgedAt;

const isCurrentStatus = (
  session: TrackedSession,
  now: number,
  codexProcessKnown: boolean,
  codexRunning: boolean,
  windowsSessionStartedAt: number,
): boolean => {
  const eventAt = session.reducer.latestEventAt;
  if (
    session.reducer.status === "idle" ||
    eventAt === null ||
    now - eventAt > statusMaxAge(session.reducer.status)
  ) {
    return false;
  }
  if (
    !isVolatileTaskFromCurrentWindowsSession(
      session.reducer.status,
      eventAt,
      windowsSessionStartedAt,
    )
  ) {
    return false;
  }
  if (
    !shouldShowTaskForProcessState(
      session.reducer.status,
      codexProcessKnown,
      codexRunning,
    )
  ) {
    return false;
  }
  return true;
};

export class CodexMonitor {
  readonly #repository: ThreadRepository;
  readonly #hookEvents: HookEventStore;
  readonly #detectCodexProcess: CodexProcessDetector;
  readonly #sessions = new Map<string, TrackedSession>();
  readonly #reviewAcknowledgements = new Map<string, number>();
  readonly #listeners = new Set<(snapshot: CodexMonitorSnapshot) => void>();
  #pendingHookObservations: HookObservation[] = [];
  #snapshot = emptySnapshot();
  #timer: NodeJS.Timeout | null = null;
  #polling: Promise<void> | null = null;
  #lastProcessCheckAt = 0;
  #codexRunning = false;
  #hasProcessCheck = false;
  #hasPublishedSnapshot = false;
  readonly #windowsSessionStartedAt: number;

  constructor(
    repository: ThreadRepository,
    hookEvents: HookEventStore,
    processDetector: CodexProcessDetector = detectCodexProcess,
    windowsSessionStartedAt = Date.now() - uptime() * 1_000,
    reviewAcknowledgements: Readonly<Record<string, number>> = {},
  ) {
    this.#repository = repository;
    this.#hookEvents = hookEvents;
    this.#detectCodexProcess = processDetector;
    this.#windowsSessionStartedAt = Math.max(
      0,
      Math.floor(windowsSessionStartedAt),
    );
    for (const [threadId, completedAt] of Object.entries(
      reviewAcknowledgements,
    )) {
      this.#reviewAcknowledgements.set(threadId, completedAt);
    }
  }

  get snapshot(): CodexMonitorSnapshot {
    return this.#snapshot;
  }

  subscribe(
    listener: (snapshot: CodexMonitorSnapshot) => void,
  ): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  start(): Promise<void> {
    if (this.#timer === null) {
      this.#timer = setInterval(() => {
        void this.refreshNow();
      }, 1_000);
      this.#timer.unref();
    }
    return this.refreshNow(true);
  }

  refreshNow(forceProcessCheck = false): Promise<void> {
    if (this.#polling !== null) {
      return this.#polling;
    }
    const polling = this.#poll(forceProcessCheck).finally(() => {
      if (this.#polling === polling) {
        this.#polling = null;
      }
    });
    this.#polling = polling;
    return polling;
  }

  reviewEventAt(threadId: string): number | null {
    const session = this.#sessions.get(threadId);
    const completedAt = session?.reducer.latestEventAt ?? null;
    if (
      session?.reducer.status !== "review" ||
      completedAt === null
    ) {
      return null;
    }
    return completedAt;
  }

  acknowledgeReview(
    threadId: string,
    expectedCompletedAt: number,
  ): number | null {
    const completedAt = this.reviewEventAt(threadId);
    if (completedAt !== expectedCompletedAt) {
      return null;
    }
    this.#reviewAcknowledgements.set(threadId, completedAt);
    this.#publish(Date.now());
    return completedAt;
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#repository.close();
    this.#listeners.clear();
    this.#pendingHookObservations = [];
  }

  async #poll(forceProcessCheck: boolean): Promise<void> {
    const now = Date.now();
    const shouldCheckProcess =
      forceProcessCheck || now - this.#lastProcessCheckAt >= 10_000;
    const processCheck = shouldCheckProcess
      ? this.#detectCodexProcess()
      : null;
    if (shouldCheckProcess) {
      this.#lastProcessCheckAt = now;
    }

    this.#syncThreads(now);
    this.#readRollouts();
    this.#readHooks();

    if (processCheck !== null) {
      const codexRunning = await processCheck;
      this.#hasProcessCheck = true;
      this.#codexRunning = codexRunning;
    }

    this.#publish(Date.now());
  }

  #syncThreads(now: number): void {
    const threads = this.#repository.listRecent(64);
    const observedIds = new Set<string>();

    for (const thread of threads) {
      observedIds.add(thread.id);
      const existing = this.#sessions.get(thread.id);
      if (existing === undefined) {
        if (
          thread.updatedAt > 0 &&
          now - thread.updatedAt > RECENT_THREAD_MAX_AGE_MS
        ) {
          continue;
        }
        this.#sessions.set(thread.id, {
          thread,
          reducer: createSessionState(),
          cursor: {
            offset: null,
            remainder: "",
            discardFirstPartialLine: false,
          },
          latestUsage: null,
          rolloutReadable: false,
        });
      } else {
        if (existing.thread.rolloutPath !== thread.rolloutPath) {
          existing.cursor = {
            offset: null,
            remainder: "",
            discardFirstPartialLine: false,
          };
          existing.reducer = createSessionState();
          existing.latestUsage = null;
          existing.rolloutReadable = false;
        }
        existing.thread = thread;
      }
    }

    for (const [threadId, session] of this.#sessions) {
      const oldEnough =
        session.thread.updatedAt > 0 &&
        now - session.thread.updatedAt > RECENT_THREAD_MAX_AGE_MS;
      if (!observedIds.has(threadId) || oldEnough) {
        this.#sessions.delete(threadId);
      }
    }
  }

  #readRollouts(): void {
    for (const session of this.#sessions.values()) {
      const result = this.#readNewLines(
        session.thread.rolloutPath,
        session.cursor,
      );
      session.rolloutReadable = result.readable;
      for (const line of result.lines) {
        if (!RELEVANT_ROLLOUT_LINE.test(line)) {
          continue;
        }
        const parsed = parseRolloutLine(line);
        for (const signal of parsed.signals) {
          session.reducer = reduceSessionSignal(
            session.reducer,
            signal,
          );
        }
        if (
          parsed.weeklyUsage !== null &&
          (session.latestUsage === null ||
            Date.parse(parsed.weeklyUsage.capturedAt) >=
              Date.parse(session.latestUsage.capturedAt))
        ) {
          session.latestUsage = parsed.weeklyUsage;
        }
      }
    }
  }

  #readHooks(): void {
    const observations = [
      ...this.#pendingHookObservations,
      ...this.#hookEvents.readNew(),
    ];
    this.#pendingHookObservations = [];
    const oldestAcceptedAt = Date.now() - PENDING_HOOK_MAX_AGE_MS;

    for (const observation of observations) {
      const session = this.#sessions.get(observation.threadId);
      if (session === undefined) {
        const capturedAt = Date.parse(observation.signal.capturedAt);
        if (
          Number.isFinite(capturedAt) &&
          capturedAt >= oldestAcceptedAt
        ) {
          this.#pendingHookObservations.push(observation);
        }
        continue;
      }
      session.reducer = reduceSessionSignal(
        session.reducer,
        observation.signal,
      );
    }
    if (
      this.#pendingHookObservations.length >
      PENDING_HOOK_MAX_EVENTS
    ) {
      this.#pendingHookObservations =
        this.#pendingHookObservations.slice(-PENDING_HOOK_MAX_EVENTS);
    }
  }

  #publish(now: number): void {
    const currentSessions = [...this.#sessions.values()]
      .filter((session) =>
        isCurrentStatus(
          session,
          now,
          this.#hasProcessCheck,
          this.#codexRunning,
          this.#windowsSessionStartedAt,
        ),
      )
      .sort(
        (left, right) =>
          (right.reducer.latestEventAt ?? right.thread.updatedAt) -
          (left.reducer.latestEventAt ?? left.thread.updatedAt),
      );
    const notificationTasks = currentSessions.map<TaskNotificationSnapshot>(
      (session) => ({
        id: session.thread.id,
        status: session.reducer.status as TaskSnapshot["status"],
      }),
    );
    const tasks = currentSessions
      .filter(
        (session) => {
          if (session.reducer.status !== "review") {
            return true;
          }
          const eventAt = session.reducer.latestEventAt;
          return (
            eventAt !== null &&
            shouldShowReviewTask(
              session.thread.isUnread,
              eventAt,
              this.#reviewAcknowledgements.get(session.thread.id),
            )
          );
        },
      )
      .map<TaskSnapshot>((session) => ({
        id: session.thread.id,
        title: session.thread.title,
        workspaceName: session.thread.workspaceName,
        status: session.reducer.status as TaskSnapshot["status"],
        updatedAt:
          session.reducer.latestEventAt ?? session.thread.updatedAt,
        canOpen: true,
      }));

    const latestUsageEntry = [...this.#sessions.values()]
      .map(({ latestUsage, rolloutReadable }) => ({
        usage: latestUsage,
        rolloutReadable,
      }))
      .filter(
        (
          entry,
        ): entry is {
          usage: UsageWindowSnapshot;
          rolloutReadable: boolean;
        } => entry.usage !== null,
      )
      .sort(
        (left, right) =>
          Date.parse(right.usage.capturedAt) -
          Date.parse(left.usage.capturedAt),
      )[0] ?? null;
    const usage =
      latestUsageEntry !== null && !latestUsageEntry.rolloutReadable
        ? {
            status: "unavailable" as const,
            weekly: null,
            reason: "The latest Codex usage source is temporarily unreadable.",
          }
        : evaluateWeeklyRateLimit(
            latestUsageEntry?.usage ?? null,
            now,
          );

    const hookEventAt = this.#hookEvents.latestEventAt;
    const nextSnapshot: CodexMonitorSnapshot = {
      primaryState: selectHighestPriorityStatus(
        tasks.map(({ status }) => status),
      ),
      usage,
      tasks,
      notificationTasks,
      codexRunning: this.#hasProcessCheck
        ? this.#codexRunning
        : tasks.some(
            ({ status }) =>
              status === "running" || status === "waiting",
          ),
      hookMode:
        hookEventAt !== null && now - hookEventAt <= HOOK_CONNECTED_MS
          ? "connected"
          : "fallback",
    };

    if (
      this.#hasPublishedSnapshot &&
      JSON.stringify(nextSnapshot) === JSON.stringify(this.#snapshot)
    ) {
      return;
    }
    this.#snapshot = nextSnapshot;
    this.#hasPublishedSnapshot = true;
    for (const listener of this.#listeners) {
      listener(nextSnapshot);
    }
  }

  #readNewLines(
    filePath: string,
    cursor: RolloutCursor,
  ): RolloutReadResult {
    if (!existsSync(filePath)) {
      return { lines: [], readable: false };
    }

    let descriptor: number | null = null;
    try {
      descriptor = openSync(filePath, "r");
      const size = fstatSync(descriptor).size;
      if (cursor.offset === null || size < cursor.offset) {
        cursor.offset = Math.max(0, size - INITIAL_TAIL_BYTES);
        cursor.remainder = "";
        cursor.discardFirstPartialLine = cursor.offset > 0;
      }

      const lines: string[] = [];
      while (cursor.offset < size) {
        const length = Math.min(
          READ_CHUNK_BYTES,
          size - cursor.offset,
        );
        const buffer = Buffer.allocUnsafe(length);
        const bytesRead = readSync(
          descriptor,
          buffer,
          0,
          length,
          cursor.offset,
        );
        if (bytesRead <= 0) {
          break;
        }
        cursor.offset += bytesRead;
        const complete = `${cursor.remainder}${buffer.toString(
          "utf8",
          0,
          bytesRead,
        )}`;
        const chunkLines = complete.split(/\r?\n/);
        cursor.remainder = chunkLines.pop() ?? "";
        for (const line of chunkLines) {
          if (cursor.discardFirstPartialLine) {
            cursor.discardFirstPartialLine = false;
            continue;
          }
          lines.push(line);
        }
        if (cursor.remainder.length > READ_CHUNK_BYTES) {
          cursor.remainder = "";
          cursor.discardFirstPartialLine = true;
        }
      }
      return { lines, readable: true };
    } catch {
      cursor.offset = null;
      cursor.remainder = "";
      cursor.discardFirstPartialLine = false;
      return { lines: [], readable: false };
    } finally {
      if (descriptor !== null) {
        closeSync(descriptor);
      }
    }
  }

}

export const reduceSignalsForTest = (
  signals: readonly SessionSignal[],
): SessionReducerState =>
  signals.reduce(reduceSessionSignal, createSessionState());
