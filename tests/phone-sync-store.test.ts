import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  loadPhoneRelayConfig,
  normalizeLocalPhoneRelayProxy,
  PhoneSyncStore,
  type PhoneSecretProtector,
} from "../src/services/phone-sync-store.ts";

const temporaryRoot = mkdtempSync(
  join(tmpdir(), "usage-pet-phone-sync-"),
);

after(() => {
  rmSync(temporaryRoot, { recursive: true, force: true });
});

const protector = (): PhoneSecretProtector => ({
  isEncryptionAvailable: () => true,
  encryptString: (value) =>
    Buffer.from(`protected:${value}`, "utf8"),
  decryptString: (value) => {
    const decoded = value.toString("utf8");
    if (!decoded.startsWith("protected:")) {
      throw new Error("invalid protected value");
    }
    return decoded.slice("protected:".length);
  },
});

test("stores pairing protected and reserves monotonic sequences", () => {
  const path = join(temporaryRoot, "pairing.json");
  const store = new PhoneSyncStore(path, protector());
  const pairing = store.createPairing(
    "https://relay.example.workers.dev",
  );

  assert.deepEqual(store.pairing, pairing);
  assert.equal(store.reserveSequence(), 1);
  assert.equal(store.reserveSequence(), 2);
  assert.equal(store.sequence, 2);

  const raw = readFileSync(path, "utf8");
  assert.equal(raw.includes(pairing.masterSecret), false);
  assert.equal(raw.includes("codexphone://"), false);

  store.clear();
  store.clear();
  assert.equal(existsSync(path), false);
  assert.equal(store.pairing, null);
});

test("does not persist pairing when protected storage is unavailable", () => {
  const path = join(temporaryRoot, "unavailable.json");
  const store = new PhoneSyncStore(path, {
    ...protector(),
    isEncryptionAvailable: () => false,
  });

  assert.throws(() =>
    store.createPairing("https://relay.example.workers.dev"),
  );
  assert.equal(store.pairing, null);
});

test("loads a relay endpoint with an optional local HTTP proxy", () => {
  const path = join(temporaryRoot, "relay-config.json");
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      endpoint: "https://relay.example.workers.dev",
      proxy: "http://127.0.0.1:7892",
    }),
  );

  assert.deepEqual(loadPhoneRelayConfig(path), {
    endpoint: "https://relay.example.workers.dev",
    proxy: "http://127.0.0.1:7892",
  });
});

test("rejects a non-local or credentialed relay proxy", () => {
  assert.throws(() =>
    normalizeLocalPhoneRelayProxy("http://proxy.example:7892"),
  );
  assert.throws(() =>
    normalizeLocalPhoneRelayProxy(
      "http://user:password@127.0.0.1:7892",
    ),
  );
});
