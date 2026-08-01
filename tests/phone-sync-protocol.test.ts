import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodexMonitorSnapshot } from "../src/services/codex-monitor.ts";
import {
  decodePhonePairingUri,
  decryptPhoneEnvelopeForTest,
  derivePhoneSyncKeys,
  encodePhonePairingUri,
  encryptPhoneSnapshot,
  generatePhonePairing,
  phoneSnapshotContentKey,
  phoneEventsUrl,
  projectPhoneSnapshot,
} from "../src/services/phone-sync-protocol.ts";

const monitorSnapshot = (): CodexMonitorSnapshot => ({
  primaryState: "running",
  usage: {
    status: "available",
    weekly: {
      remainingPercent: 21.6,
      usedPercent: 78.4,
      windowDurationMins: 10_080,
      resetsAt: 1_785_628_800,
      capturedAt: "2026-07-28T00:00:00.000Z",
      source: "rollout",
    },
  },
  tasks: [
    {
      id: "019fa31c-1650-7c53-baa8-d151a6623358",
      title: "Connect Codex to phone",
      workspaceName: "Usage Pet",
      status: "running",
      updatedAt: 1_785_200_000_000,
      canOpen: true,
    },
  ],
  notificationTasks: [
    {
      id: "019fa31c-1650-7c53-baa8-d151a6623358",
      status: "running",
    },
  ],
  codexRunning: true,
  hookMode: "fallback",
});

test("projects only the approved phone fields", () => {
  const projected = projectPhoneSnapshot(
    monitorSnapshot(),
    7,
    1_785_200_100_000,
  );

  assert.deepEqual(projected, {
    version: 1,
    sequence: 7,
    capturedAt: 1_785_200_100_000,
    usage: {
      status: "available",
      remainingPercent: 22,
      resetsAt: 1_785_628_800,
    },
    tasks: [
      {
        id: "019fa31c-1650-7c53-baa8-d151a6623358",
        title: "Connect Codex to phone",
        workspaceName: "Usage Pet",
        status: "running",
        updatedAt: 1_785_200_000_000,
      },
    ],
  });
  const serialized = JSON.stringify(projected);
  for (const forbidden of [
    "notificationTasks",
    "codexRunning",
    "hookMode",
    "canOpen",
    "usedPercent",
    "capturedAt\":\"2026",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("preserves all five tasks needed by the Mobile complete list", () => {
  const source = monitorSnapshot();
  source.tasks = Array.from({ length: 5 }, (_, index) => ({
    ...source.tasks[0]!,
    id: `task-${index + 1}`,
    title: `Task ${index + 1}`,
    updatedAt: 1_785_200_000_000 + index,
  }));

  const projected = projectPhoneSnapshot(
    source,
    9,
    1_785_200_100_000,
  );

  assert.deepEqual(
    projected.tasks.map(({ id }) => id),
    ["task-1", "task-2", "task-3", "task-4", "task-5"],
  );
});

test("pairing URI round-trips and derives separate stable keys", () => {
  const pairing = generatePhonePairing(
    "https://relay.example.workers.dev/",
  );
  const decoded = decodePhonePairingUri(
    encodePhonePairingUri(pairing),
  );
  const first = derivePhoneSyncKeys(pairing);
  const second = derivePhoneSyncKeys(decoded);

  assert.deepEqual(decoded, pairing);
  assert.equal(first.authToken, second.authToken);
  assert.deepEqual(first.encryptionKey, second.encryptionKey);
  assert.notEqual(
    first.authToken,
    first.encryptionKey.toString("base64url"),
  );
});

test("builds the paired room WebSocket events URL", () => {
  const pairing = generatePhonePairing("https://relay.example.workers.dev");
  assert.equal(
    phoneEventsUrl(pairing),
    `wss://relay.example.workers.dev/v1/rooms/${pairing.roomId}/events`,
  );
});

test("AES-GCM envelope round-trips and rejects tampering", () => {
  const pairing = generatePhonePairing(
    "https://relay.example.workers.dev",
  );
  const snapshot = projectPhoneSnapshot(
    monitorSnapshot(),
    8,
    1_785_200_100_000,
  );
  const envelope = encryptPhoneSnapshot(pairing, snapshot);

  assert.deepEqual(
    decryptPhoneEnvelopeForTest(pairing, envelope),
    snapshot,
  );

  const tampered = {
    ...envelope,
    ciphertext:
      envelope.ciphertext.slice(0, -1) +
      (envelope.ciphertext.endsWith("A") ? "B" : "A"),
  };
  assert.throws(() =>
    decryptPhoneEnvelopeForTest(pairing, tampered),
  );
});

test("content key ignores local monitor-only fields", () => {
  const first = monitorSnapshot();
  const second: CodexMonitorSnapshot = {
    ...first,
    hookMode: "connected",
    codexRunning: false,
    notificationTasks: [],
  };

  assert.equal(
    phoneSnapshotContentKey(first),
    phoneSnapshotContentKey(second),
  );
});
