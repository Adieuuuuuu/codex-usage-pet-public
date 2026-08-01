import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PUBLISH_BODY_BYTES,
  RelayError,
  hashAuthToken,
  isAllowedTransport,
  isCanonicalBase64Url,
  isRoomId,
  parseBearer,
  readBoundedJson,
  validateAuthFrame,
  validateEnvelope,
  validateRefreshRequestFrame,
} from "../src/protocol.js";

const ROOM_ID = base64url(16, 1);
const TOKEN = base64url(32, 2);
const NONCE = base64url(12, 3);
const CIPHERTEXT = base64url(32, 4);

test("accepts canonical protocol identifiers and rejects non-canonical values", () => {
  assert.equal(isRoomId(ROOM_ID), true);
  assert.equal(isRoomId(`${ROOM_ID}=`), false);
  assert.equal(isCanonicalBase64Url("AB", 1), false);
  assert.equal(isCanonicalBase64Url(base64url(1, 5), 1), true);
});

test("parses only a canonical 32-byte bearer token", () => {
  const request = new Request("https://relay.example/health", {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(parseBearer(request), TOKEN);

  assert.throws(
    () =>
      parseBearer(
        new Request("https://relay.example/health", {
          headers: { authorization: "Bearer short" },
        }),
      ),
    (error) => relayError(error, 401, "unauthorized"),
  );
});

test("normalizes a valid encrypted envelope and rejects extra metadata", () => {
  const input = {
    version: 1,
    roomId: ROOM_ID,
    sequence: 42,
    nonce: NONCE,
    ciphertext: CIPHERTEXT,
  };
  assert.deepEqual(validateEnvelope(input, ROOM_ID), input);

  assert.throws(
    () => validateEnvelope({ ...input, plaintext: "must not pass" }, ROOM_ID),
    (error) => relayError(error, 400, "invalid_envelope"),
  );
  assert.throws(
    () => validateEnvelope({ ...input, sequence: 0 }, ROOM_ID),
    (error) => relayError(error, 400, "invalid_envelope"),
  );
  assert.throws(
    () => validateEnvelope(input, base64url(16, 9)),
    (error) => relayError(error, 400, "invalid_envelope"),
  );
});

test("reads bounded JSON and rejects unsupported or oversized bodies", async () => {
  const validRequest = new Request("https://relay.example/snapshot", {
    method: "PUT",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ ok: true }),
  });
  assert.deepEqual(await readBoundedJson(validRequest), { ok: true });

  await assert.rejects(
    readBoundedJson(
      new Request("https://relay.example/snapshot", {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: "{}",
      }),
    ),
    (error) => relayError(error, 415, "unsupported_media_type"),
  );

  await assert.rejects(
    readBoundedJson(
      new Request("https://relay.example/snapshot", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "x".repeat(MAX_PUBLISH_BODY_BYTES + 1),
      }),
    ),
    (error) => relayError(error, 413, "payload_too_large"),
  );
});

test("requires the exact first-frame authentication shape", () => {
  const frame = JSON.stringify({ type: "auth", version: 1, token: TOKEN });
  assert.deepEqual(validateAuthFrame(frame), {
    token: TOKEN,
    role: "phone",
  });
  assert.deepEqual(validateAuthFrame(JSON.stringify({
    type: "auth",
    version: 1,
    token: TOKEN,
    role: "desktop",
  })), {
    token: TOKEN,
    role: "desktop",
  });
  assert.throws(
    () =>
      validateAuthFrame(
        JSON.stringify({
          type: "auth",
          version: 1,
          token: TOKEN,
          roomId: ROOM_ID,
        }),
      ),
    (error) => relayError(error, 400, "invalid_auth_frame"),
  );
});

test("accepts only bounded version-4 refresh request IDs", () => {
  const request = {
    type: "refresh_request",
    version: 1,
    requestId: "8d573f92-b480-4cd7-84ad-8eb6ce239318",
  };
  assert.deepEqual(
    validateRefreshRequestFrame(JSON.stringify(request)),
    request,
  );
  assert.throws(
    () => validateRefreshRequestFrame(JSON.stringify({
      ...request,
      plaintext: "must not pass",
    })),
    (error) => relayError(error, 400, "invalid_refresh_request"),
  );
});

test("hashes authentication material without returning the token", async () => {
  const hash = await hashAuthToken(TOKEN);
  assert.equal(isCanonicalBase64Url(hash, 32), true);
  assert.notEqual(hash, TOKEN);
  assert.equal(hash, await hashAuthToken(TOKEN));
});

test("requires TLS except on loopback development origins", () => {
  assert.equal(isAllowedTransport(new URL("https://relay.example/health")), true);
  assert.equal(isAllowedTransport(new URL("http://localhost:8787/health")), true);
  assert.equal(isAllowedTransport(new URL("http://relay.example/health")), false);
});

function base64url(length, fill) {
  return Buffer.alloc(length, fill).toString("base64url");
}

function relayError(error, status, code) {
  return (
    error instanceof RelayError &&
    error.status === status &&
    error.code === code
  );
}
