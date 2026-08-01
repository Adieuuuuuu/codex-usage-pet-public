import type { CodexMonitorSnapshot } from "./codex-monitor.ts";
import {
  derivePhoneSyncKeys,
  encryptPhoneSnapshot,
  phoneSnapshotContentKey,
  phoneEventsUrl,
  phoneSnapshotUrl,
  projectPhoneSnapshot,
} from "./phone-sync-protocol.ts";
import type { PhoneSyncStore } from "./phone-sync-store.ts";

export type PhoneSyncStatus =
  | "unpaired"
  | "publishing"
  | "active"
  | "offline"
  | "auth-failed";

export interface PhoneSyncPublisherOptions {
  store: PhoneSyncStore;
  fetch?: typeof fetch;
  createWebSocket?: (url: string) => PhoneSyncWebSocket;
  onRefreshRequested?: () => Promise<void>;
  onStatus?: (status: PhoneSyncStatus) => void;
  retryBaseMs?: number;
  retryMaximumMs?: number;
  heartbeatMs?: number;
}

export interface PhoneSyncWebSocket {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface PendingSnapshot {
  source: CodexMonitorSnapshot;
  contentKey: string;
}

export class PhoneSyncPublisher {
  readonly #store: PhoneSyncStore;
  readonly #fetch: typeof fetch;
  readonly #createWebSocket: ((url: string) => PhoneSyncWebSocket) | null;
  readonly #onRefreshRequested: () => Promise<void>;
  readonly #onStatus: (status: PhoneSyncStatus) => void;
  readonly #retryBaseMs: number;
  readonly #retryMaximumMs: number;
  readonly #heartbeatMs: number;
  #status: PhoneSyncStatus = "unpaired";
  #pending: PendingSnapshot | null = null;
  #latestSource: CodexMonitorSnapshot | null = null;
  #lastPublishedContentKey: string | null = null;
  #retryAttempt = 0;
  #retryTimer: NodeJS.Timeout | null = null;
  #heartbeatTimer: NodeJS.Timeout | null = null;
  #publishing = false;
  #stopped = false;
  #pairingRevision = 0;
  #controlSocket: PhoneSyncWebSocket | null = null;
  #controlRetryTimer: NodeJS.Timeout | null = null;
  #controlRetryAttempt = 0;
  #refreshInFlight = false;
  #lastRefreshRequestId: string | null = null;

  constructor(options: PhoneSyncPublisherOptions) {
    this.#store = options.store;
    this.#fetch = options.fetch ?? fetch;
    this.#createWebSocket = options.createWebSocket ?? null;
    this.#onRefreshRequested = options.onRefreshRequested
      ?? (() => Promise.resolve());
    this.#onStatus = options.onStatus ?? (() => undefined);
    this.#retryBaseMs = options.retryBaseMs ?? 1_000;
    this.#retryMaximumMs = options.retryMaximumMs ?? 60_000;
    this.#heartbeatMs = options.heartbeatMs ?? 5 * 60_000;
    this.#setStatus(
      this.#store.pairing === null ? "unpaired" : "offline",
    );
  }

  get status(): PhoneSyncStatus {
    return this.#status;
  }

  update(source: CodexMonitorSnapshot): void {
    this.#latestSource = source;
    if (this.#stopped || this.#store.pairing === null) {
      this.#clearHeartbeat();
      this.#stopControlConnection();
      this.#setStatus("unpaired");
      return;
    }
    this.#ensureControlConnection();
    const contentKey = phoneSnapshotContentKey(source);
    if (contentKey === this.#lastPublishedContentKey) {
      return;
    }
    this.#pending = { source, contentKey };
    if (this.#retryTimer !== null) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
    void this.#drain();
  }

  pairingChanged(source: CodexMonitorSnapshot): void {
    this.#restart(source);
  }

  recover(source: CodexMonitorSnapshot): void {
    const contentKey = phoneSnapshotContentKey(source);
    if (contentKey !== this.#lastPublishedContentKey) {
      this.update(source);
      return;
    }
    this.#restart(source);
  }

  #restart(source: CodexMonitorSnapshot): void {
    this.#pairingRevision += 1;
    this.#stopControlConnection();
    this.#clearHeartbeat();
    this.#lastPublishedContentKey = null;
    this.#retryAttempt = 0;
    this.#pending = null;
    this.update(source);
  }

  stop(): void {
    this.#stopped = true;
    this.#pairingRevision += 1;
    this.#pending = null;
    this.#latestSource = null;
    this.#clearHeartbeat();
    this.#stopControlConnection();
    if (this.#retryTimer !== null) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
  }

  #ensureControlConnection(): void {
    const pairing = this.#store.pairing;
    if (
      this.#stopped ||
      pairing === null ||
      this.#createWebSocket === null ||
      this.#controlSocket !== null ||
      this.#controlRetryTimer !== null
    ) {
      return;
    }

    const pairingRevision = this.#pairingRevision;
    let socket: PhoneSyncWebSocket;
    try {
      socket = this.#createWebSocket(phoneEventsUrl(pairing));
    } catch {
      this.#scheduleControlReconnect();
      return;
    }
    this.#controlSocket = socket;
    socket.onopen = () => {
      if (
        socket !== this.#controlSocket ||
        pairingRevision !== this.#pairingRevision
      ) {
        socket.close(1000, "stale pairing");
        return;
      }
      this.#controlRetryAttempt = 0;
      const { authToken } = derivePhoneSyncKeys(pairing);
      socket.send(JSON.stringify({
        type: "auth",
        version: 1,
        token: authToken,
        role: "desktop",
      }));
    };
    socket.onmessage = (event) => {
      if (
        socket !== this.#controlSocket ||
        pairingRevision !== this.#pairingRevision ||
        typeof event.data !== "string"
      ) {
        return;
      }
      const requestId = refreshRequestId(event.data);
      if (
        requestId === null ||
        requestId === this.#lastRefreshRequestId ||
        this.#refreshInFlight
      ) {
        return;
      }
      this.#lastRefreshRequestId = requestId;
      this.#refreshInFlight = true;
      void this.#onRefreshRequested()
        .catch(() => undefined)
        .finally(() => {
          this.#refreshInFlight = false;
        });
    };
    socket.onclose = () => this.#scheduleControlReconnect(socket);
    socket.onerror = () => this.#scheduleControlReconnect(socket);
  }

  #scheduleControlReconnect(socket?: PhoneSyncWebSocket): void {
    if (socket !== undefined && socket !== this.#controlSocket) {
      return;
    }
    if (socket !== undefined) {
      try {
        socket.close(1011, "control connection failed");
      } catch {
        // The client may already be closed after an error event.
      }
    }
    this.#controlSocket = null;
    if (
      this.#stopped ||
      this.#store.pairing === null ||
      this.#controlRetryTimer !== null
    ) {
      return;
    }
    const delay = Math.min(
      60_000,
      1_000 * (2 ** Math.min(this.#controlRetryAttempt, 6)),
    );
    this.#controlRetryAttempt += 1;
    this.#controlRetryTimer = setTimeout(() => {
      this.#controlRetryTimer = null;
      this.#ensureControlConnection();
    }, delay);
    this.#controlRetryTimer.unref();
  }

  #stopControlConnection(): void {
    if (this.#controlRetryTimer !== null) {
      clearTimeout(this.#controlRetryTimer);
      this.#controlRetryTimer = null;
    }
    const socket = this.#controlSocket;
    this.#controlSocket = null;
    this.#controlRetryAttempt = 0;
    this.#refreshInFlight = false;
    this.#lastRefreshRequestId = null;
    if (socket !== null) {
      socket.close(1000, "publisher stopping");
    }
  }

  async #drain(): Promise<void> {
    if (
      this.#stopped ||
      this.#publishing ||
      this.#retryTimer !== null ||
      this.#pending === null
    ) {
      return;
    }
    const pairing = this.#store.pairing;
    if (pairing === null) {
      this.#setStatus("unpaired");
      return;
    }

    const pending = this.#pending;
    const pairingRevision = this.#pairingRevision;
    this.#clearHeartbeat();
    this.#publishing = true;
    this.#setStatus("publishing");
    try {
      const sequence = this.#store.reserveSequence();
      const snapshot = projectPhoneSnapshot(
        pending.source,
        sequence,
      );
      const envelope = encryptPhoneSnapshot(pairing, snapshot);
      const { authToken } = derivePhoneSyncKeys(pairing);
      const response = await this.#fetch(phoneSnapshotUrl(pairing), {
        method: "PUT",
        headers: {
          authorization: `Bearer ${authToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(10_000),
      });

      if (pairingRevision !== this.#pairingRevision) {
        return;
      }
      if (response.status === 401) {
        this.#pending = null;
        this.#setStatus("auth-failed");
        return;
      }
      if (!response.ok) {
        throw new Error(`Relay rejected snapshot: ${response.status}`);
      }

      this.#lastPublishedContentKey = pending.contentKey;
      this.#retryAttempt = 0;
      this.#setStatus("active");
      this.#scheduleHeartbeat();
      if (this.#pending?.contentKey === pending.contentKey) {
        this.#pending = null;
      }
    } catch {
      if (pairingRevision !== this.#pairingRevision) {
        return;
      }
      this.#setStatus("offline");
      this.#scheduleRetry();
    } finally {
      this.#publishing = false;
      if (this.#retryTimer === null && this.#pending !== null) {
        void this.#drain();
      }
    }
  }

  #scheduleRetry(): void {
    if (this.#stopped || this.#retryTimer !== null) {
      return;
    }
    const multiplier = 2 ** Math.min(this.#retryAttempt, 6);
    const delay = Math.min(
      this.#retryMaximumMs,
      this.#retryBaseMs * multiplier,
    );
    this.#retryAttempt += 1;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      void this.#drain();
    }, delay);
    this.#retryTimer.unref();
  }

  #scheduleHeartbeat(): void {
    if (
      this.#stopped ||
      this.#store.pairing === null ||
      this.#latestSource === null
    ) {
      return;
    }
    this.#clearHeartbeat();
    this.#heartbeatTimer = setTimeout(() => {
      this.#heartbeatTimer = null;
      const latest = this.#latestSource;
      if (latest === null) {
        return;
      }
      this.#lastPublishedContentKey = null;
      this.update(latest);
    }, this.#heartbeatMs);
    this.#heartbeatTimer.unref();
  }

  #clearHeartbeat(): void {
    if (this.#heartbeatTimer !== null) {
      clearTimeout(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
  }

  #setStatus(status: PhoneSyncStatus): void {
    if (status === this.#status) {
      return;
    }
    this.#status = status;
    this.#onStatus(status);
  }
}

const refreshRequestId = (frame: string): string | null => {
  if (Buffer.byteLength(frame, "utf8") > 256) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(frame);
  } catch {
    return null;
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "requestId,type,version" ||
    record.type !== "refresh_request" ||
    record.version !== 1 ||
    typeof record.requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(record.requestId)
  ) {
    return null;
  }
  return record.requestId;
};
