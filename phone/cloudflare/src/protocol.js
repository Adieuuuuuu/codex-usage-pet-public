export const PROTOCOL_VERSION = 1;
export const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;
export const MAX_PUBLISH_BODY_BYTES = 48 * 1024;
export const MAX_CIPHERTEXT_BYTES = 32 * 1024;
export const MAX_AUTH_FRAME_BYTES = 256;
export const MAX_CONTROL_FRAME_BYTES = 256;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export class RelayError extends Error {
  constructor(status, code) {
    super(code);
    this.name = "RelayError";
    this.status = status;
    this.code = code;
  }
}

export function isCanonicalBase64Url(value, minBytes, maxBytes = minBytes) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !BASE64URL_PATTERN.test(value) ||
    value.length % 4 === 1
  ) {
    return false;
  }

  const remainder = value.length % 4;
  const lastValue = BASE64URL_ALPHABET.indexOf(value.at(-1));
  if (
    lastValue < 0 ||
    (remainder === 2 && (lastValue & 0x0f) !== 0) ||
    (remainder === 3 && (lastValue & 0x03) !== 0)
  ) {
    return false;
  }

  const decodedBytes = Math.floor((value.length * 6) / 8);
  return decodedBytes >= minBytes && decodedBytes <= maxBytes;
}

export function isRoomId(value) {
  return isCanonicalBase64Url(value, 16);
}

export function parseBearer(request) {
  const authorization = request.headers.get("authorization");
  const match =
    typeof authorization === "string"
      ? /^Bearer ([A-Za-z0-9_-]+)$/i.exec(authorization)
      : null;

  if (!match || !isCanonicalBase64Url(match[1], 32)) {
    throw new RelayError(401, "unauthorized");
  }

  return match[1];
}

export function validateEnvelope(value, expectedRoomId) {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "version",
      "roomId",
      "sequence",
      "nonce",
      "ciphertext",
    ])
  ) {
    throw new RelayError(400, "invalid_envelope");
  }

  if (
    value.version !== PROTOCOL_VERSION ||
    value.roomId !== expectedRoomId ||
    !isRoomId(value.roomId) ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    value.sequence > MAX_SEQUENCE ||
    !isCanonicalBase64Url(value.nonce, 12) ||
    !isCanonicalBase64Url(value.ciphertext, 16, MAX_CIPHERTEXT_BYTES)
  ) {
    throw new RelayError(400, "invalid_envelope");
  }

  return {
    version: PROTOCOL_VERSION,
    roomId: value.roomId,
    sequence: value.sequence,
    nonce: value.nonce,
    ciphertext: value.ciphertext,
  };
}

export function validateAuthFrame(message) {
  if (
    typeof message !== "string" ||
    new TextEncoder().encode(message).byteLength > MAX_AUTH_FRAME_BYTES
  ) {
    throw new RelayError(400, "invalid_auth_frame");
  }

  let value;
  try {
    value = JSON.parse(message);
  } catch {
    throw new RelayError(400, "invalid_auth_frame");
  }

  if (!isPlainObject(value)) {
    throw new RelayError(400, "invalid_auth_frame");
  }
  const hasLegacyKeys = hasExactKeys(value, ["type", "version", "token"]);
  const hasRoleKeys = hasExactKeys(value, [
    "type",
    "version",
    "token",
    "role",
  ]);
  if (
    (!hasLegacyKeys && !hasRoleKeys) ||
    value.type !== "auth" ||
    value.version !== PROTOCOL_VERSION ||
    !isCanonicalBase64Url(value.token, 32) ||
    (hasRoleKeys && value.role !== "phone" && value.role !== "desktop")
  ) {
    throw new RelayError(400, "invalid_auth_frame");
  }

  return {
    token: value.token,
    role: hasRoleKeys ? value.role : "phone",
  };
}

export function validateRefreshRequestFrame(message) {
  if (
    typeof message !== "string" ||
    new TextEncoder().encode(message).byteLength > MAX_CONTROL_FRAME_BYTES
  ) {
    throw new RelayError(400, "invalid_refresh_request");
  }

  let value;
  try {
    value = JSON.parse(message);
  } catch {
    throw new RelayError(400, "invalid_refresh_request");
  }

  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ["type", "version", "requestId"]) ||
    value.type !== "refresh_request" ||
    value.version !== PROTOCOL_VERSION ||
    typeof value.requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(value.requestId)
  ) {
    throw new RelayError(400, "invalid_refresh_request");
  }

  return {
    type: "refresh_request",
    version: PROTOCOL_VERSION,
    requestId: value.requestId.toLowerCase(),
  };
}

export async function readBoundedJson(request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new RelayError(415, "unsupported_media_type");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(0|[1-9]\d*)$/.test(contentLength)) {
      throw new RelayError(400, "invalid_content_length");
    }
    if (Number(contentLength) > MAX_PUBLISH_BODY_BYTES) {
      throw new RelayError(413, "payload_too_large");
    }
  }

  if (request.body === null) {
    throw new RelayError(400, "invalid_json");
  }

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > MAX_PUBLISH_BODY_BYTES) {
      await reader.cancel();
      throw new RelayError(413, "payload_too_large");
    }
    chunks.push(value);
  }

  if (totalBytes === 0) {
    throw new RelayError(400, "invalid_json");
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new RelayError(400, "invalid_json");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new RelayError(400, "invalid_json");
  }
}

export async function hashAuthToken(token) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

export function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }

  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function snapshotFrame(envelopeJson) {
  return `{"type":"snapshot","envelope":${envelopeJson}}`;
}

export function refreshResultFrame(requestId, result) {
  return JSON.stringify({
    type: "refresh_result",
    version: PROTOCOL_VERSION,
    requestId,
    result,
  });
}

export function jsonResponse(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

export function errorResponse(error) {
  if (error instanceof RelayError) {
    return jsonResponse(error.status, { error: error.code });
  }
  return jsonResponse(500, { error: "internal_error" });
}

export function isAllowedTransport(url) {
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]"))
  );
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expectedKeys) {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index])
  );
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
