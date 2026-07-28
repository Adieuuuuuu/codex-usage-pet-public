# Codex phone private relay

This directory contains the Phase-1 Cloudflare Worker and SQLite-backed Durable
Object. It is deliberately a ciphertext relay: it never receives the pairing
master secret or encryption key, and it never decrypts a snapshot.

## Implementation plan

1. Route only the three protocol-v1 operations and reject non-TLS production
   requests.
2. Validate room IDs, bearer tokens, envelopes, body sizes, and monotonically
   increasing sequences before persistence.
3. Persist one latest encrypted envelope and a SHA-256 authentication verifier
   in each SQLite Durable Object.
4. Authenticate each hibernating WebSocket from its first client frame, then
   send the latest snapshot and broadcast subsequent snapshots.
5. Cover protocol validation, routing, authentication, replay rejection, and
   socket delivery with dependency-free Node unit tests.

Cloudflare authorization and deployment are intentionally not part of local
implementation. No account ID, route, token, secret, or deployed endpoint
belongs in this directory.

## Relay contract

- `GET /health`
- `PUT /v1/rooms/<roomId>/snapshot`
- `GET /v1/rooms/<roomId>/events` with `Upgrade: websocket`

The publisher sends its 32-byte base64url authentication key as a bearer token.
Because protocol v1 has no room-registration operation, the first valid publish
to a random 128-bit room ID claims that room. SQLite persists only
`SHA-256(authKey)`, the latest sequence, the normalized encrypted envelope, and
the relay update time. Later publishers must match the verifier and use a
strictly greater sequence.

The first phone WebSocket frame is:

```json
{"type":"auth","version":1,"token":"<32-byte base64url auth key>"}
```

After authentication, every relay frame is:

```json
{"type":"snapshot","envelope":{"version":1,"roomId":"...","sequence":1,"nonce":"...","ciphertext":"..."}}
```

The WebSocket is accepted with the Durable Object hibernation API. Authentication
state, but never the token or verifier, is stored in the socket attachment so it
survives hibernation. The room keeps at most four authenticated sockets and four
pending handshakes.

## Bounds and rejection behavior

- room ID: canonical unpadded base64url encoding of exactly 16 bytes;
- bearer token: canonical unpadded base64url encoding of exactly 32 bytes;
- nonce: canonical unpadded base64url encoding of exactly 12 bytes;
- ciphertext: 16 bytes through 32 KiB;
- publish request: at most 48 KiB and `application/json`;
- authentication frame: at most 256 UTF-8 bytes;
- sequence: integer from 1 through JavaScript's maximum safe integer;
- envelopes and authentication frames reject unknown fields;
- equal or lower sequences return `409 stale_sequence`;
- production HTTP requests are rejected; loopback HTTP remains available to
  Wrangler local development.

The relay source contains no logging calls, plaintext schema, decryption
operation, encryption key, pairing bundle, account identifier, or secret.

## Local verification

The unit suite uses only Node's built-in test runner:

```powershell
npm.cmd test
```

Current local result: 18 tests passed. They cover validation, bounded reads,
TLS routing, room claiming, authentication failure, replay rejection,
first-frame WebSocket authentication, and authenticated-only broadcast.

`npm run check` additionally performs a Wrangler dry-run. The current local
result is 18/18 tests passed and Wrangler 4.114.0 successfully bundled the
Worker with the `CODEX_PHONE_ROOMS` Durable Object binding. No production
deployment is claimed until Cloudflare browser authorization completes.

The implementation follows Cloudflare's current
[SQLite Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
and
[WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
APIs.
