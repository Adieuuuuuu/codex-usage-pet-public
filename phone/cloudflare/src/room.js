import {
  RelayError,
  constantTimeEqual,
  errorResponse,
  hashAuthToken,
  isAllowedTransport,
  isRoomId,
  jsonResponse,
  parseBearer,
  readBoundedJson,
  refreshResultFrame,
  snapshotFrame,
  validateAuthFrame,
  validateEnvelope,
  validateRefreshRequestFrame,
} from "./protocol.js";
import { SqliteRoomStore } from "./store.js";
import { matchRelayPath } from "./worker.js";

const MAX_AUTHENTICATED_SOCKETS = 4;
const MAX_PENDING_SOCKETS = 4;
const REFRESH_COOLDOWN_MS = 5_000;

export class RoomHandler {
  constructor(ctx, env, options = {}) {
    this.ctx = ctx;
    this.env = env;
    this.runtime = options.runtime ?? globalThis;
    this.store = options.store ?? new SqliteRoomStore(ctx.storage);
    this.now = options.now ?? Date.now;

    const AutoResponsePair = this.runtime.WebSocketRequestResponsePair;
    if (
      typeof this.ctx.setWebSocketAutoResponse === "function" &&
      typeof AutoResponsePair === "function"
    ) {
      this.ctx.setWebSocketAutoResponse(
        new AutoResponsePair("ping", "pong"),
      );
    }
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      if (!isAllowedTransport(url)) {
        throw new RelayError(400, "https_required");
      }

      const route = matchRelayPath(url.pathname);
      if (route === null || !isRoomId(route.roomId)) {
        return jsonResponse(404, { error: "not_found" });
      }

      if (route.operation === "snapshot") {
        if (request.method !== "PUT") {
          return methodNotAllowed("PUT");
        }
        return await this.publish(request, route.roomId);
      }

      if (request.method !== "GET") {
        return methodNotAllowed("GET");
      }
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return jsonResponse(
          426,
          { error: "websocket_upgrade_required" },
          { upgrade: "websocket" },
        );
      }
      return this.openSocket();
    } catch (error) {
      return errorResponse(error);
    }
  }

  async publish(request, roomId) {
    const token = parseBearer(request);
    const body = await readBoundedJson(request);
    const envelope = validateEnvelope(body, roomId);
    const authHash = await hashAuthToken(token);
    const envelopeJson = JSON.stringify(envelope);

    const result = this.store.publish(
      authHash,
      envelope.sequence,
      envelopeJson,
      this.now(),
    );

    if (result.decision === "unauthorized") {
      throw new RelayError(401, "unauthorized");
    }
    if (result.decision === "stale") {
      throw new RelayError(409, "stale_sequence");
    }

    this.broadcast(snapshotFrame(envelopeJson), "phone");
    return jsonResponse(result.decision === "claim" ? 201 : 200, {
      ok: true,
      sequence: envelope.sequence,
    });
  }

  openSocket() {
    if (this.store.getState() === null) {
      return jsonResponse(404, { error: "room_not_ready" });
    }

    const sockets = this.ctx.getWebSockets();
    const authenticatedCount = sockets.filter(
      (socket) => getAttachment(socket).authenticated === true,
    ).length;
    if (authenticatedCount >= MAX_AUTHENTICATED_SOCKETS) {
      return jsonResponse(429, { error: "socket_limit_reached" });
    }

    const pendingSockets = sockets
      .filter((socket) => getAttachment(socket).authenticated !== true)
      .sort(
        (left, right) =>
          (getAttachment(left).connectedAt ?? 0) -
          (getAttachment(right).connectedAt ?? 0),
      );
    while (pendingSockets.length >= MAX_PENDING_SOCKETS) {
      pendingSockets.shift().close(1008, "superseded");
    }

    const pair = new this.runtime.WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ["room"]);
    server.serializeAttachment({
      authenticated: false,
      authenticating: false,
      connectedAt: this.now(),
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, message) {
    const attachment = getAttachment(socket);
    if (attachment.authenticated === true) {
      this.handleAuthenticatedMessage(socket, message, attachment);
      return;
    }
    if (attachment.authenticating === true) {
      socket.close(1008, "authentication already in progress");
      return;
    }
    if (typeof message !== "string") {
      socket.close(1003, "text authentication required");
      return;
    }

    socket.serializeAttachment({
      ...attachment,
      authenticating: true,
    });

    try {
      const auth = validateAuthFrame(message);
      const authHash = await hashAuthToken(auth.token);
      const state = this.store.getState();

      if (state === null || !constantTimeEqual(state.authHash, authHash)) {
        socket.close(1008, "authentication failed");
        return;
      }

      socket.serializeAttachment({
        authenticated: true,
        authenticating: false,
        role: auth.role,
        connectedAt: attachment.connectedAt ?? this.now(),
      });
      if (auth.role === "phone") {
        socket.send(snapshotFrame(state.envelope));
      } else {
        socket.send('{"type":"ready","version":1,"role":"desktop"}');
      }
    } catch {
      socket.close(1008, "authentication failed");
    }
  }

  handleAuthenticatedMessage(socket, message, attachment) {
    if (attachment.role !== "phone" || typeof message !== "string") {
      socket.close(1008, "unexpected frame");
      return;
    }

    let request;
    try {
      request = validateRefreshRequestFrame(message);
    } catch {
      socket.close(1008, "invalid refresh request");
      return;
    }

    const now = this.now();
    if (
      Number.isFinite(attachment.lastRefreshAt) &&
      now - attachment.lastRefreshAt < REFRESH_COOLDOWN_MS
    ) {
      socket.send(refreshResultFrame(request.requestId, "throttled"));
      return;
    }

    socket.serializeAttachment({
      ...attachment,
      lastRefreshAt: now,
    });
    const forwarded = this.broadcast(
      JSON.stringify(request),
      "desktop",
    );
    socket.send(refreshResultFrame(
      request.requestId,
      forwarded > 0 ? "forwarded" : "desktop_unavailable",
    ));
  }

  webSocketError(socket) {
    socket.close(1011, "socket error");
  }

  broadcast(frame, role = null) {
    let delivered = 0;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = getAttachment(socket);
      if (
        attachment.authenticated !== true ||
        (role !== null && socketRole(attachment) !== role)
      ) {
        continue;
      }
      try {
        socket.send(frame);
        delivered += 1;
      } catch {
        socket.close(1011, "delivery failed");
      }
    }
    return delivered;
  }
}

function socketRole(attachment) {
  return attachment.role === "desktop" ? "desktop" : "phone";
}

function getAttachment(socket) {
  try {
    return socket.deserializeAttachment() ?? {};
  } catch {
    return {};
  }
}

function methodNotAllowed(allowedMethod) {
  return jsonResponse(
    405,
    { error: "method_not_allowed" },
    { allow: allowedMethod },
  );
}
