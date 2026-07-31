import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import type { CodexMonitorSnapshot } from "../src/services/codex-monitor.ts";
import {
  derivePhoneSyncKeys,
  type PhoneSyncEnvelope,
} from "../src/services/phone-sync-protocol.ts";
import {
  PhoneSyncPublisher,
  type PhoneSyncStatus,
} from "../src/services/phone-sync-publisher.ts";
import {
  PhoneSyncStore,
  type PhoneSecretProtector,
} from "../src/services/phone-sync-store.ts";

const temporaryRoot = mkdtempSync(
  join(tmpdir(), "usage-pet-phone-publisher-"),
);

after(() => {
  rmSync(temporaryRoot, { recursive: true, force: true });
});

const protector: PhoneSecretProtector = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, "utf8"),
  decryptString: (value) => value.toString("utf8"),
};

const snapshot = (): CodexMonitorSnapshot => ({
  primaryState: "running",
  usage: { status: "unavailable", weekly: null },
  tasks: [
    {
      id: "019fa31c-1650-7c53-baa8-d151a6623358",
      title: "Live task",
      workspaceName: "Usage Pet",
      status: "running",
      updatedAt: 1_785_200_000_000,
      canOpen: true,
    },
  ],
  notificationTasks: [],
  codexRunning: true,
  hookMode: "fallback",
});

test("publishes one encrypted snapshot with bearer authentication", async () => {
  const store = new PhoneSyncStore(
    join(temporaryRoot, "publisher.json"),
    protector,
  );
  const pairing = store.createPairing(
    "https://relay.example.workers.dev",
  );
  const requests: Array<{
    url: string;
    authorization: string | null;
    envelope: PhoneSyncEnvelope;
  }> = [];
  let resolveActive: (() => void) | null = null;
  const active = new Promise<void>((resolve) => {
    resolveActive = resolve;
  });
  const statuses: PhoneSyncStatus[] = [];
  const publisher = new PhoneSyncPublisher({
    store,
    fetch: (async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(input),
        authorization: headers.get("authorization"),
        envelope: JSON.parse(String(init?.body)) as PhoneSyncEnvelope,
      });
      return new Response('{"ok":true}', { status: 201 });
    }) as typeof fetch,
    onStatus: (status) => {
      statuses.push(status);
      if (status === "active") {
        resolveActive?.();
      }
    },
  });

  publisher.update(snapshot());
  await active;
  publisher.update(snapshot());
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(requests.length, 1);
  assert.equal(
    requests[0]?.url,
    `https://relay.example.workers.dev/v1/rooms/`
      + `${pairing.roomId}/snapshot`,
  );
  assert.equal(
    requests[0]?.authorization,
    `Bearer ${derivePhoneSyncKeys(pairing).authToken}`,
  );
  assert.equal(
    JSON.stringify(requests[0]?.envelope).includes("Live task"),
    false,
  );
  assert.deepEqual(statuses.slice(-2), ["publishing", "active"]);
  publisher.stop();
});

test("stops retrying when relay authentication fails", async () => {
  const store = new PhoneSyncStore(
    join(temporaryRoot, "publisher-auth-failed.json"),
    protector,
  );
  store.createPairing("https://relay.example.workers.dev");
  let requestCount = 0;
  let resolveAuthFailed: (() => void) | null = null;
  const authFailed = new Promise<void>((resolve) => {
    resolveAuthFailed = resolve;
  });
  const publisher = new PhoneSyncPublisher({
    store,
    fetch: (async () => {
      requestCount += 1;
      return new Response('{"error":"unauthorized"}', { status: 401 });
    }) as typeof fetch,
    onStatus: (status) => {
      if (status === "auth-failed") {
        resolveAuthFailed?.();
      }
    },
    retryBaseMs: 1,
    retryMaximumMs: 1,
  });

  publisher.update(snapshot());
  await authFailed;
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(requestCount, 1);
  assert.equal(publisher.status, "auth-failed");
  publisher.stop();
});

test("republishes an unchanged snapshot as a bounded heartbeat", async () => {
  const store = new PhoneSyncStore(
    join(temporaryRoot, "publisher-heartbeat.json"),
    protector,
  );
  store.createPairing("https://relay.example.workers.dev");
  const envelopes: PhoneSyncEnvelope[] = [];
  let resolveSecondPublish: (() => void) | null = null;
  const secondPublish = new Promise<void>((resolve) => {
    resolveSecondPublish = resolve;
  });
  const publisher = new PhoneSyncPublisher({
    store,
    fetch: (async (_input, init) => {
      envelopes.push(
        JSON.parse(String(init?.body)) as PhoneSyncEnvelope,
      );
      if (envelopes.length === 2) {
        resolveSecondPublish?.();
      }
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch,
    heartbeatMs: 5,
  });

  publisher.update(snapshot());
  await secondPublish;
  publisher.stop();

  assert.deepEqual(
    envelopes.map(({ sequence }) => sequence),
    [1, 2],
  );
  assert.notEqual(envelopes[0]?.nonce, envelopes[1]?.nonce);
});

test("recovery republishes unchanged content without waiting for heartbeat", async () => {
  const store = new PhoneSyncStore(
    join(temporaryRoot, "publisher-recovery.json"),
    protector,
  );
  store.createPairing("https://relay.example.workers.dev");
  const envelopes: PhoneSyncEnvelope[] = [];
  let resolveFirst!: () => void;
  const firstPublish = new Promise<void>((resolve) => {
    resolveFirst = resolve;
  });
  let resolveSecond!: () => void;
  const secondPublish = new Promise<void>((resolve) => {
    resolveSecond = resolve;
  });
  const publisher = new PhoneSyncPublisher({
    store,
    fetch: (async (_input, init) => {
      envelopes.push(
        JSON.parse(String(init?.body)) as PhoneSyncEnvelope,
      );
      if (envelopes.length === 1) {
        resolveFirst();
      }
      if (envelopes.length === 2) {
        resolveSecond();
      }
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch,
    heartbeatMs: 60_000,
  });

  publisher.update(snapshot());
  await firstPublish;
  publisher.recover(snapshot());
  await secondPublish;
  publisher.stop();

  assert.deepEqual(
    envelopes.map(({ sequence }) => sequence),
    [1, 2],
  );
  assert.notEqual(envelopes[0]?.nonce, envelopes[1]?.nonce);
});

test("does not let an in-flight old pairing supersede a rotated pairing", async () => {
  const store = new PhoneSyncStore(
    join(temporaryRoot, "publisher-rotation.json"),
    protector,
  );
  const firstPairing = store.createPairing(
    "https://relay.example.workers.dev",
  );
  const requestedRooms: string[] = [];
  let finishFirstRequest!: () => void;
  const firstRequestGate = new Promise<void>((resolve) => {
    finishFirstRequest = resolve;
  });
  let resolveSecondRequest: (() => void) | null = null;
  const secondRequest = new Promise<void>((resolve) => {
    resolveSecondRequest = resolve;
  });
  const publisher = new PhoneSyncPublisher({
    store,
    fetch: (async (input) => {
      const room = new URL(String(input)).pathname.split("/").at(-2);
      requestedRooms.push(room ?? "");
      if (requestedRooms.length === 1) {
        await firstRequestGate;
      } else {
        resolveSecondRequest?.();
      }
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch,
  });

  publisher.update(snapshot());
  await new Promise((resolve) => setTimeout(resolve, 10));
  const secondPairing = store.rotatePairing(
    "https://relay.example.workers.dev",
  );
  publisher.pairingChanged(snapshot());
  finishFirstRequest();
  await secondRequest;

  assert.deepEqual(requestedRooms, [
    firstPairing.roomId,
    secondPairing.roomId,
  ]);
  publisher.stop();
});
