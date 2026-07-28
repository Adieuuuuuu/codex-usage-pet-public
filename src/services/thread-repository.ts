import { readFileSync } from "node:fs";
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  toNamespacedPath,
} from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface CodexThreadRecord {
  id: string;
  title: string;
  workspaceName: string | null;
  rolloutPath: string;
  updatedAt: number;
  isUnread: boolean;
}

interface ThreadRow {
  id: unknown;
  title: unknown;
  name: unknown;
  preview: unknown;
  cwd: unknown;
  rollout_path: unknown;
  updated_at: unknown;
  updated_at_ms: unknown;
  recency_at: unknown;
  recency_at_ms: unknown;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonRecord = Record<string, unknown>;

interface ResolvedFileSystemPath {
  logicalPath: string;
  fileSystemPath: string;
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseUnreadThreadIds = (input: unknown): Set<string> => {
  if (!isRecord(input)) {
    return new Set();
  }
  const persistedState = input["electron-persisted-atom-state"];
  if (!isRecord(persistedState)) {
    return new Set();
  }
  const unreadByHost = persistedState["unread-thread-ids-by-host-v1"];
  if (!isRecord(unreadByHost) || !Array.isArray(unreadByHost.local)) {
    return new Set();
  }

  return new Set(
    unreadByHost.local.filter(
      (threadId): threadId is string =>
        typeof threadId === "string" && UUID_PATTERN.test(threadId),
    ),
  );
};

const loadUnreadThreadIds = (globalStatePath: string): Set<string> => {
  try {
    return parseUnreadThreadIds(
      JSON.parse(readFileSync(globalStatePath, "utf8")) as unknown,
    );
  } catch {
    return new Set();
  }
};

const resolveFileSystemPath = (
  candidate: string,
): ResolvedFileSystemPath | null => {
  const windowsPath = candidate.replace(/\//g, "\\");
  if (/^\\\\\.\\/i.test(windowsPath)) {
    return null;
  }

  let logicalPath = windowsPath;
  let namespaced = false;
  if (/^\\\\\?\\UNC\\/i.test(windowsPath)) {
    logicalPath = `\\\\${windowsPath.slice("\\\\?\\UNC\\".length)}`;
    namespaced = true;
  } else if (/^\\\\\?\\[a-z]:\\/i.test(windowsPath)) {
    logicalPath = windowsPath.slice("\\\\?\\".length);
    namespaced = true;
  } else if (/^\\\\\?\\/i.test(windowsPath)) {
    return null;
  }

  const resolved = resolve(logicalPath);
  return {
    logicalPath: resolved,
    fileSystemPath: namespaced ? toNamespacedPath(resolved) : resolved,
  };
};

const isWithinRoot = (
  candidate: ResolvedFileSystemPath,
  root: string,
): boolean => {
  const resolvedRoot = resolveFileSystemPath(root);
  if (resolvedRoot === null) {
    return false;
  }
  const difference = relative(
    resolvedRoot.logicalPath,
    candidate.logicalPath,
  );
  return (
    difference === "" ||
    (!difference.startsWith("..") && !difference.includes(":"))
  );
};

const normalizeText = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return null;
  }
  return normalized.slice(0, maxLength);
};

const loadSessionNames = (sessionIndexPath: string): Map<string, string> => {
  const names = new Map<string, string>();
  try {
    for (const line of readFileSync(sessionIndexPath, "utf8").split(
      /\r?\n/,
    )) {
      if (line.trim().length === 0) {
        continue;
      }
      try {
        const record = JSON.parse(line) as {
          id?: unknown;
          thread_name?: unknown;
        };
        if (
          typeof record.id !== "string" ||
          !UUID_PATTERN.test(record.id)
        ) {
          continue;
        }
        const name = normalizeText(record.thread_name, 90);
        if (name === null) {
          names.delete(record.id);
        } else {
          names.set(record.id, name);
        }
      } catch {
        // Codex may be appending the final JSONL record while we read it.
      }
    }
  } catch {
    // Older Codex versions may not have a session index.
  }
  return names;
};

const normalizeTimestamp = (
  milliseconds: unknown,
  seconds: unknown,
): number => {
  if (typeof milliseconds === "number" && Number.isFinite(milliseconds)) {
    return milliseconds;
  }
  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    return seconds < 1_000_000_000_000 ? seconds * 1_000 : seconds;
  }
  return 0;
};

export const normalizeThreadRow = (
  row: ThreadRow,
  allowedRolloutRoots: readonly string[],
  desktopName?: unknown,
  isUnread = false,
): CodexThreadRecord | null => {
  if (typeof row.id !== "string" || !UUID_PATTERN.test(row.id)) {
    return null;
  }
  if (typeof row.rollout_path !== "string") {
    return null;
  }

  const rolloutPath = resolveFileSystemPath(row.rollout_path);
  if (
    rolloutPath === null ||
    !allowedRolloutRoots.some((root) => isWithinRoot(rolloutPath, root))
  ) {
    return null;
  }

  const title =
    normalizeText(desktopName, 90) ??
    normalizeText(row.name, 90) ??
    normalizeText(row.title, 90) ??
    normalizeText(row.preview, 90) ??
    "Codex 任务";
  const cwd = normalizeText(row.cwd, 1_024);
  const workspaceName =
    cwd === null ? null : normalizeText(basename(cwd), 50);
  const updatedAt = Math.max(
    normalizeTimestamp(row.updated_at_ms, row.updated_at),
    normalizeTimestamp(row.recency_at_ms, row.recency_at),
  );

  return {
    id: row.id,
    title,
    workspaceName,
    rolloutPath: rolloutPath.fileSystemPath,
    updatedAt,
    isUnread,
  };
};

export class ThreadRepository {
  readonly #databasePath: string;
  readonly #rolloutRoots: readonly string[];
  readonly #sessionIndexPath: string;
  readonly #globalStatePath: string;
  #database: DatabaseSync | null = null;

  constructor(databasePath: string, rolloutRoots: readonly string[]) {
    this.#databasePath = databasePath;
    this.#rolloutRoots = rolloutRoots.map((root) => resolve(root));
    this.#sessionIndexPath = join(
      dirname(databasePath),
      "session_index.jsonl",
    );
    this.#globalStatePath = join(
      dirname(databasePath),
      ".codex-global-state.json",
    );
  }

  listRecent(limit = 64): CodexThreadRecord[] {
    const boundedLimit = Math.max(1, Math.min(128, Math.trunc(limit)));
    try {
      const database = this.#getDatabase();
      const rows = database
        .prepare(
          `
            SELECT
              id,
              title,
              name,
              preview,
              cwd,
              rollout_path,
              updated_at,
              updated_at_ms,
              recency_at,
              recency_at_ms
            FROM threads
            WHERE source = ? AND archived = 0
            ORDER BY
              MAX(
                COALESCE(updated_at_ms, updated_at * 1000),
                COALESCE(recency_at_ms, recency_at * 1000)
              ) DESC
            LIMIT ?
          `,
        )
        .all("vscode", boundedLimit) as unknown as ThreadRow[];
      const sessionNames = loadSessionNames(this.#sessionIndexPath);
      const unreadThreadIds = loadUnreadThreadIds(
        this.#globalStatePath,
      );

      return rows
        .map((row) =>
          normalizeThreadRow(
            row,
            this.#rolloutRoots,
            typeof row.id === "string"
              ? sessionNames.get(row.id)
              : undefined,
            typeof row.id === "string" &&
              unreadThreadIds.has(row.id),
          ),
        )
        .filter(
          (thread): thread is CodexThreadRecord => thread !== null,
        );
    } catch {
      this.close();
      return [];
    }
  }

  close(): void {
    try {
      this.#database?.close();
    } catch {
      // The database is owned by Codex. A close failure is non-fatal here.
    } finally {
      this.#database = null;
    }
  }

  #getDatabase(): DatabaseSync {
    if (this.#database === null) {
      this.#database = new DatabaseSync(this.#databasePath, {
        readOnly: true,
      });
    }
    return this.#database;
  }
}
