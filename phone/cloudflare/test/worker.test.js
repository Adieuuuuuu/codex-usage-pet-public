import assert from "node:assert/strict";
import test from "node:test";
import { handleWorkerRequest } from "../src/worker.js";

const ROOM_ID = Buffer.alloc(16, 7).toString("base64url");

test("returns a non-secret health response", async () => {
  const response = await handleWorkerRequest(
    new Request("https://relay.example/health"),
    {},
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, version: 1 });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("rejects plaintext production transport", async () => {
  const response = await handleWorkerRequest(
    new Request("http://relay.example/health"),
    {},
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "https_required" });
});

test("rejects unsupported methods before creating a room object", async () => {
  const response = await handleWorkerRequest(
    new Request(`https://relay.example/v1/rooms/${ROOM_ID}/snapshot`),
    {},
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "PUT");
});

test("routes a valid room to its named Durable Object", async () => {
  const calls = [];
  const env = {
    CODEX_PHONE_ROOMS: {
      getByName(name) {
        calls.push(name);
        return {
          fetch(request) {
            calls.push(request.url);
            return new Response(null, { status: 204 });
          },
        };
      },
    },
  };

  const response = await handleWorkerRequest(
    new Request(`https://relay.example/v1/rooms/${ROOM_ID}/events`, {
      headers: { upgrade: "websocket" },
    }),
    env,
  );
  assert.equal(response.status, 204);
  assert.deepEqual(calls, [
    ROOM_ID,
    `https://relay.example/v1/rooms/${ROOM_ID}/events`,
  ]);
});

test("rejects malformed room identifiers and missing upgrades", async () => {
  const invalidRoom = await handleWorkerRequest(
    new Request("https://relay.example/v1/rooms/not-a-room/snapshot", {
      method: "PUT",
    }),
    {},
  );
  assert.equal(invalidRoom.status, 400);

  const noUpgrade = await handleWorkerRequest(
    new Request(`https://relay.example/v1/rooms/${ROOM_ID}/events`),
    {},
  );
  assert.equal(noUpgrade.status, 426);
  assert.equal(noUpgrade.headers.get("upgrade"), "websocket");
});
