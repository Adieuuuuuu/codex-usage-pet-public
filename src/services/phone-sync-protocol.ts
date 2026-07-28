import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import type { CodexMonitorSnapshot } from "./codex-monitor.ts";

export const PHONE_SYNC_VERSION = 1 as const;
export const PHONE_SYNC_MAX_TASKS = 10;

const AUTH_INFO = "codex-phone-auth-v1";
const ENCRYPTION_INFO = "codex-phone-encryption-v1";
const PAIRING_SCHEME = "codexphone:";
const MAX_PLAINTEXT_BYTES = 16 * 1024;

export interface PhoneSyncUsage {
  status: "available" | "unavailable" | "stale";
  remainingPercent?: number;
  resetsAt?: number;
}

export interface PhoneSyncTask {
  id: string;
  title: string;
  workspaceName: string | null;
  status: "running" | "waiting" | "review" | "failed";
  updatedAt: number;
}

export interface PhoneSyncSnapshot {
  version: 1;
  sequence: number;
  capturedAt: number;
  usage: PhoneSyncUsage;
  tasks: PhoneSyncTask[];
}

export interface PhonePairingMaterial {
  version: 1;
  endpoint: string;
  roomId: string;
  masterSecret: string;
}

export interface PhoneSyncEnvelope {
  version: 1;
  roomId: string;
  sequence: number;
  nonce: string;
  ciphertext: string;
}

export const projectPhoneSnapshot = (
  source: CodexMonitorSnapshot,
  sequence: number,
  capturedAt = Date.now(),
): PhoneSyncSnapshot => {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("Phone sync sequence must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(capturedAt) || capturedAt < 1) {
    throw new Error("Phone sync capture time is invalid.");
  }

  const usage: PhoneSyncUsage = { status: source.usage.status };
  if (
    source.usage.status !== "unavailable" &&
    source.usage.weekly !== null
  ) {
    const remainingPercent = Math.round(
      source.usage.weekly.remainingPercent,
    );
    if (
      remainingPercent < 0 ||
      remainingPercent > 100 ||
      !Number.isFinite(source.usage.weekly.resetsAt) ||
      source.usage.weekly.resetsAt <= 0
    ) {
      throw new Error("Phone sync usage values are invalid.");
    }
    usage.remainingPercent = remainingPercent;
    usage.resetsAt = Math.round(source.usage.weekly.resetsAt);
  }

  return {
    version: PHONE_SYNC_VERSION,
    sequence,
    capturedAt,
    usage,
    tasks: source.tasks
      .slice(0, PHONE_SYNC_MAX_TASKS)
      .map((task) => ({
        id: boundedText(task.id, 128, "task id"),
        title: boundedText(task.title, 160, "task title"),
        workspaceName:
          task.workspaceName === null
            ? null
            : boundedText(
                task.workspaceName,
                120,
                "workspace name",
              ),
        status: task.status,
        updatedAt: positiveTimestamp(task.updatedAt),
      })),
  };
};

export const phoneSnapshotContentKey = (
  source: CodexMonitorSnapshot,
): string => {
  const projected = projectPhoneSnapshot(source, 1, 1);
  return JSON.stringify({
    usage: projected.usage,
    tasks: projected.tasks,
  });
};

export const generatePhonePairing = (
  endpoint: string,
): PhonePairingMaterial => ({
  version: PHONE_SYNC_VERSION,
  endpoint: normalizeRelayEndpoint(endpoint),
  roomId: randomBytes(16).toString("base64url"),
  masterSecret: randomBytes(32).toString("base64url"),
});

export const encodePhonePairingUri = (
  pairing: PhonePairingMaterial,
): string => {
  validatePairing(pairing);
  const url = new URL("codexphone://pair");
  url.searchParams.set("v", String(PHONE_SYNC_VERSION));
  url.searchParams.set("endpoint", pairing.endpoint);
  url.searchParams.set("room", pairing.roomId);
  url.searchParams.set("secret", pairing.masterSecret);
  return url.toString();
};

export const decodePhonePairingUri = (
  value: string,
): PhonePairingMaterial => {
  const url = new URL(value);
  if (
    url.protocol !== PAIRING_SCHEME ||
    url.hostname !== "pair" ||
    url.searchParams.get("v") !== String(PHONE_SYNC_VERSION)
  ) {
    throw new Error("Unsupported phone pairing code.");
  }
  const pairing: PhonePairingMaterial = {
    version: PHONE_SYNC_VERSION,
    endpoint: url.searchParams.get("endpoint") ?? "",
    roomId: url.searchParams.get("room") ?? "",
    masterSecret: url.searchParams.get("secret") ?? "",
  };
  validatePairing(pairing);
  return pairing;
};

export const derivePhoneSyncKeys = (
  pairing: PhonePairingMaterial,
): { authToken: string; encryptionKey: Buffer } => {
  validatePairing(pairing);
  const secret = Buffer.from(pairing.masterSecret, "base64url");
  const salt = Buffer.from(pairing.roomId, "base64url");
  return {
    authToken: Buffer.from(
      hkdfSync("sha256", secret, salt, AUTH_INFO, 32),
    ).toString("base64url"),
    encryptionKey: Buffer.from(
      hkdfSync("sha256", secret, salt, ENCRYPTION_INFO, 32),
    ),
  };
};

export const encryptPhoneSnapshot = (
  pairing: PhonePairingMaterial,
  snapshot: PhoneSyncSnapshot,
): PhoneSyncEnvelope => {
  validatePairing(pairing);
  if (
    snapshot.version !== PHONE_SYNC_VERSION ||
    !Number.isSafeInteger(snapshot.sequence) ||
    snapshot.sequence < 1
  ) {
    throw new Error("Phone snapshot header is invalid.");
  }
  const plaintext = Buffer.from(JSON.stringify(snapshot), "utf8");
  if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
    throw new Error("Phone snapshot exceeds the encrypted payload bound.");
  }
  const nonce = randomBytes(12);
  const { encryptionKey } = derivePhoneSyncKeys(pairing);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);
  cipher.setAAD(aad(pairing.roomId, snapshot.sequence));
  const encrypted = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    version: PHONE_SYNC_VERSION,
    roomId: pairing.roomId,
    sequence: snapshot.sequence,
    nonce: nonce.toString("base64url"),
    ciphertext: encrypted.toString("base64url"),
  };
};

export const decryptPhoneEnvelopeForTest = (
  pairing: PhonePairingMaterial,
  envelope: PhoneSyncEnvelope,
): PhoneSyncSnapshot => {
  validatePairing(pairing);
  if (
    envelope.version !== PHONE_SYNC_VERSION ||
    envelope.roomId !== pairing.roomId ||
    !Number.isSafeInteger(envelope.sequence) ||
    envelope.sequence < 1
  ) {
    throw new Error("Phone envelope header is invalid.");
  }
  const encrypted = Buffer.from(envelope.ciphertext, "base64url");
  if (encrypted.length < 16) {
    throw new Error("Phone envelope ciphertext is invalid.");
  }
  const ciphertext = encrypted.subarray(0, -16);
  const tag = encrypted.subarray(-16);
  const { encryptionKey } = derivePhoneSyncKeys(pairing);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey,
    Buffer.from(envelope.nonce, "base64url"),
  );
  decipher.setAAD(aad(pairing.roomId, envelope.sequence));
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8"),
  ) as PhoneSyncSnapshot;
};

export const phoneSnapshotUrl = (
  pairing: PhonePairingMaterial,
): string =>
  `${pairing.endpoint}/v1/rooms/${pairing.roomId}/snapshot`;

export const normalizeRelayEndpoint = (value: string): string => {
  const url = new URL(value.trim());
  const localHttp =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("Phone relay endpoint must use HTTPS.");
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new Error("Phone relay endpoint must be an origin.");
  }
  return url.origin;
};

const validatePairing = (pairing: PhonePairingMaterial): void => {
  if (pairing.version !== PHONE_SYNC_VERSION) {
    throw new Error("Unsupported phone pairing version.");
  }
  normalizeRelayEndpoint(pairing.endpoint);
  if (
    !isCanonicalBase64Url(pairing.roomId, 16) ||
    !isCanonicalBase64Url(pairing.masterSecret, 32)
  ) {
    throw new Error("Phone pairing material is invalid.");
  }
};

const isCanonicalBase64Url = (
  value: string,
  expectedBytes: number,
): boolean => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    return false;
  }
  const decoded = Buffer.from(value, "base64url");
  return (
    decoded.length === expectedBytes &&
    decoded.toString("base64url") === value
  );
};

const aad = (roomId: string, sequence: number): Buffer =>
  Buffer.from(`codex-phone-v1|${roomId}|${sequence}`, "utf8");

const boundedText = (
  value: string,
  maximum: number,
  name: string,
): string => {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new Error(`Phone sync ${name} is invalid.`);
  }
  return normalized;
};

const positiveTimestamp = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Phone sync task timestamp is invalid.");
  }
  return Math.round(value);
};
