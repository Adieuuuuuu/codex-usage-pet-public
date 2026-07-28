import {
  RelayError,
  errorResponse,
  isAllowedTransport,
  isRoomId,
  jsonResponse,
} from "./protocol.js";

const ROOM_PATH_PATTERN = /^\/v1\/rooms\/([^/]+)\/(snapshot|events)$/u;

export async function handleWorkerRequest(request, env) {
  try {
    const url = new URL(request.url);
    if (!isAllowedTransport(url)) {
      throw new RelayError(400, "https_required");
    }

    if (url.pathname === "/health") {
      if (request.method !== "GET") {
        return methodNotAllowed("GET");
      }
      return jsonResponse(200, { ok: true, version: 1 });
    }

    const route = matchRelayPath(url.pathname);
    if (route === null) {
      return jsonResponse(404, { error: "not_found" });
    }
    if (!isRoomId(route.roomId)) {
      throw new RelayError(400, "invalid_room_id");
    }

    if (route.operation === "snapshot") {
      if (request.method !== "PUT") {
        return methodNotAllowed("PUT");
      }
    } else {
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
    }

    const namespace = env?.CODEX_PHONE_ROOMS;
    if (namespace === undefined || typeof namespace.getByName !== "function") {
      return jsonResponse(500, { error: "relay_not_configured" });
    }

    return await namespace.getByName(route.roomId).fetch(request);
  } catch (error) {
    return errorResponse(error);
  }
}

export function matchRelayPath(pathname) {
  const match = ROOM_PATH_PATTERN.exec(pathname);
  if (match === null) {
    return null;
  }
  return {
    roomId: match[1],
    operation: match[2],
  };
}

function methodNotAllowed(allowedMethod) {
  return jsonResponse(
    405,
    { error: "method_not_allowed" },
    { allow: allowedMethod },
  );
}
