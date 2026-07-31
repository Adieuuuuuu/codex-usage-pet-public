import type { CodexMonitorSnapshot } from "./codex-monitor.ts";
import {
  derivePhoneSyncKeys,
  encryptPhoneSnapshot,
  phoneSnapshotContentKey,
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
  onStatus?: (status: PhoneSyncStatus) => void;
  retryBaseMs?: number;
  retryMaximumMs?: number;
  heartbeatMs?: number;
}

interface PendingSnapshot {
  source: CodexMonitorSnapshot;
  contentKey: string;
}

export class PhoneSyncPublisher {
  readonly #store: PhoneSyncStore;
  readonly #fetch: typeof fetch;
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

  constructor(options: PhoneSyncPublisherOptions) {
    this.#store = options.store;
    this.#fetch = options.fetch ?? fetch;
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
      this.#setStatus("unpaired");
      return;
    }
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
    if (this.#retryTimer !== null) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
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
