# Codex phone sync protocol v1

## Pairing bundle

The desktop generates:

- `endpoint`: deployed HTTPS Worker origin;
- `roomId`: 16 random bytes, base64url without padding;
- `masterSecret`: 32 random bytes, base64url without padding;
- `version`: `1`.

The transport representation is a compact `codexphone://pair?...` URI. It is a
secret and must never be logged or committed.

HKDF-SHA-256 uses the raw room ID bytes as salt and derives:

- `authKey`, info `codex-phone-auth-v1`;
- `encryptionKey`, info `codex-phone-encryption-v1`.

## Snapshot plaintext

```json
{
  "version": 1,
  "sequence": 42,
  "capturedAt": 1785200000000,
  "usage": {
    "status": "available",
    "remainingPercent": 22,
    "resetsAt": 1785628800
  },
  "tasks": [
    {
      "id": "uuid",
      "title": "Task title",
      "workspaceName": "Workspace",
      "status": "running",
      "updatedAt": 1785200000000
    }
  ]
}
```

Allowed task statuses are `running`, `waiting`, `review`, and `failed`. At most
10 tasks are transported. IDs, titles, workspace names, timestamps, counts, and
percentages are length/range checked at both endpoints.

`capturedAt` and task `updatedAt` use Unix epoch milliseconds. Usage `resetsAt`
matches the existing Usage Pet contract and uses Unix epoch seconds. A new
sequence is published for every content change and for the five-minute
freshness heartbeat.

## Encrypted envelope

```json
{
  "version": 1,
  "roomId": "base64url",
  "sequence": 42,
  "nonce": "base64url",
  "ciphertext": "base64url"
}
```

AES-256-GCM additional authenticated data is the UTF-8 string:

`codex-phone-v1|<roomId>|<sequence>`

## Relay operations

- `PUT /v1/rooms/<roomId>/snapshot`: desktop publish; bearer authentication.
- `GET /v1/rooms/<roomId>/events`: phone WebSocket upgrade. The first client
  frame authenticates the socket; authenticated sockets receive the latest
  envelope and subsequent `snapshot` frames.
- `GET /health`: non-secret deployment health check.

The relay rejects non-TLS production endpoints, unknown versions, invalid room
IDs, oversized bodies, stale sequences, failed authentication, and unsupported
methods. It never decrypts a snapshot.
