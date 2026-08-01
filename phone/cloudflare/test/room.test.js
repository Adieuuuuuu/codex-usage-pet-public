import assert from "node:assert/strict";
import test from "node:test";
import { hashAuthToken } from "../src/protocol.js";
import { RoomHandler } from "../src/room.js";
import { publicationDecision } from "../src/store.js";

const ROOM_ID = Buffer.alloc(16, 11).toString("base64url");
const TOKEN = Buffer.alloc(32, 12).toString("base64url");
const WRONG_TOKEN = Buffer.alloc(32, 13).toString("base64url");
const NONCE = Buffer.alloc(12, 14).toString("base64url");
const CIPHERTEXT = Buffer.alloc(48, 15).toString("base64url");

test("claims a room, stores only verifier plus ciphertext, and rejects replay", async () => {
  const store = new MemoryStore();
  const context = new FakeContext();
  const handler = createHandler(context, store);

  const first = await handler.fetch(publishRequest(TOKEN, 1));
  assert.equal(first.status, 201);
  assert.equal(store.state.sequence, 1);
  assert.notEqual(store.state.authHash, TOKEN);
  assert.equal(store.state.envelope.includes(CIPHERTEXT), true);
  assert.equal(store.state.envelope.includes(TOKEN), false);

  const replay = await handler.fetch(publishRequest(TOKEN, 1));
  assert.equal(replay.status, 409);
  assert.deepEqual(await replay.json(), { error: "stale_sequence" });

  const unauthorized = await handler.fetch(publishRequest(WRONG_TOKEN, 2));
  assert.equal(unauthorized.status, 401);
  assert.equal(store.state.sequence, 1);
});

test("authenticates a socket from its first frame and sends the latest snapshot", async () => {
  const store = new MemoryStore();
  const context = new FakeContext();
  const handler = createHandler(context, store);
  await handler.fetch(publishRequest(TOKEN, 5));

  const socket = new FakeSocket();
  socket.serializeAttachment({
    authenticated: false,
    authenticating: false,
    connectedAt: 123,
  });
  await handler.webSocketMessage(
    socket,
    JSON.stringify({ type: "auth", version: 1, token: TOKEN }),
  );

  assert.equal(socket.closed, null);
  assert.equal(socket.deserializeAttachment().authenticated, true);
  assert.deepEqual(
    socket.sent.map((frame) => JSON.parse(frame).envelope.sequence),
    [5],
  );
  assert.equal(JSON.stringify(socket.deserializeAttachment()).includes(TOKEN), false);
});

test("rejects wrong or binary WebSocket authentication frames", async () => {
  const store = new MemoryStore();
  const context = new FakeContext();
  const handler = createHandler(context, store);
  await handler.fetch(publishRequest(TOKEN, 1));

  const wrong = new FakeSocket();
  await handler.webSocketMessage(
    wrong,
    JSON.stringify({ type: "auth", version: 1, token: WRONG_TOKEN }),
  );
  assert.equal(wrong.closed.code, 1008);
  assert.deepEqual(wrong.sent, []);

  const binary = new FakeSocket();
  await handler.webSocketMessage(binary, new Uint8Array([1, 2, 3]));
  assert.equal(binary.closed.code, 1003);
});

test("broadcasts a newer snapshot only to authenticated sockets", async () => {
  const authenticated = new FakeSocket();
  authenticated.serializeAttachment({ authenticated: true, role: "phone" });
  const desktop = new FakeSocket();
  desktop.serializeAttachment({ authenticated: true, role: "desktop" });
  const pending = new FakeSocket();
  pending.serializeAttachment({ authenticated: false });
  const context = new FakeContext([authenticated, desktop, pending]);
  const handler = createHandler(context, new MemoryStore());

  const response = await handler.fetch(publishRequest(TOKEN, 1));
  assert.equal(response.status, 201);
  assert.equal(authenticated.sent.length, 1);
  assert.equal(desktop.sent.length, 0);
  assert.equal(pending.sent.length, 0);
});

test("forwards a bounded phone refresh only to a desktop and rate limits it", async () => {
  const phone = new FakeSocket();
  phone.serializeAttachment({ authenticated: true, role: "phone" });
  const desktop = new FakeSocket();
  desktop.serializeAttachment({ authenticated: true, role: "desktop" });
  const context = new FakeContext([phone, desktop]);
  const handler = createHandler(context, new MemoryStore());
  const first = JSON.stringify({
    type: "refresh_request",
    version: 1,
    requestId: "8d573f92-b480-4cd7-84ad-8eb6ce239318",
  });
  const second = JSON.stringify({
    type: "refresh_request",
    version: 1,
    requestId: "d397de29-e688-46aa-a20f-9e53f22efaea",
  });

  await handler.webSocketMessage(phone, first);
  await handler.webSocketMessage(phone, second);

  assert.deepEqual(desktop.sent.map(JSON.parse), [JSON.parse(first)]);
  assert.deepEqual(phone.sent.map(JSON.parse), [
    {
      type: "refresh_result",
      version: 1,
      requestId: "8d573f92-b480-4cd7-84ad-8eb6ce239318",
      result: "forwarded",
    },
    {
      type: "refresh_result",
      version: 1,
      requestId: "d397de29-e688-46aa-a20f-9e53f22efaea",
      result: "throttled",
    },
  ]);
});

test("reports when no authenticated desktop can refresh", async () => {
  const phone = new FakeSocket();
  phone.serializeAttachment({ authenticated: true, role: "phone" });
  const handler = createHandler(
    new FakeContext([phone]),
    new MemoryStore(),
  );

  await handler.webSocketMessage(phone, JSON.stringify({
    type: "refresh_request",
    version: 1,
    requestId: "8d573f92-b480-4cd7-84ad-8eb6ce239318",
  }));

  assert.equal(
    JSON.parse(phone.sent[0]).result,
    "desktop_unavailable",
  );
});

function createHandler(context, store) {
  return new RoomHandler(context, {}, {
    store,
    now: () => 123456,
    runtime: {
      WebSocketRequestResponsePair: class {
        constructor(request, response) {
          this.request = request;
          this.response = response;
        }
      },
    },
  });
}

function publishRequest(token, sequence) {
  return new Request(
    `https://relay.example/v1/rooms/${ROOM_ID}/snapshot`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        version: 1,
        roomId: ROOM_ID,
        sequence,
        nonce: NONCE,
        ciphertext: CIPHERTEXT,
      }),
    },
  );
}

class MemoryStore {
  state = null;

  getState() {
    return this.state;
  }

  publish(authHash, sequence, envelope, updatedAt) {
    const decision = publicationDecision(this.state, authHash, sequence);
    const previousSequence = this.state?.sequence ?? null;
    if (decision === "claim" || decision === "update") {
      this.state = { authHash, sequence, envelope, updatedAt };
    }
    return { decision, previousSequence };
  }
}

class FakeContext {
  constructor(sockets = []) {
    this.sockets = sockets;
  }

  setWebSocketAutoResponse(pair) {
    this.autoResponse = pair;
  }

  getWebSockets() {
    return this.sockets;
  }
}

class FakeSocket {
  attachment = {};
  sent = [];
  closed = null;

  serializeAttachment(value) {
    this.attachment = structuredClone(value);
  }

  deserializeAttachment() {
    return structuredClone(this.attachment);
  }

  send(frame) {
    this.sent.push(frame);
  }

  close(code, reason) {
    this.closed = { code, reason };
  }
}
