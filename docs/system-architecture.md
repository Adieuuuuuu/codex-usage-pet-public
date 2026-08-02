# Codex Usage Pet system architecture

## Product boundary

Codex Usage Pet is one product with three deployable components and one shared
versioned protocol:

```text
Codex local state
      |
      v
Windows Usage Pet (repository root)
  read-only monitor -> approved projection -> AES-256-GCM
      |
      v
Cloudflare relay (phone/cloudflare)
  authentication + ciphertext persistence/broadcast only
      |
      v
Android companion (phone/app)
  protected pairing -> decrypt/validate/replay guard -> system notification
```

The components are not one executable codebase. Electron/TypeScript, Worker
JavaScript, and Android/Java remain independent because their platform
responsibilities differ. They belong in one repository because protocol,
privacy, task semantics, and end-to-end acceptance must change atomically.

## Ownership

- Desktop: the only Codex reader; task interpretation; privacy projection;
  pairing generation; encryption; publish and heartbeat.
- Relay: bounded authentication, newest-ciphertext persistence, and WebSocket
  broadcast; no plaintext schema or decryption key.
- Android: protected pairing storage; connection lifecycle; decryption and
  replay protection; last-good snapshot; alert deduplication; notification UI.

## OpenCodex quota compatibility

When the desktop is routed through OpenCodex, the monitor reads the fresh local
`codex-quota-cache.json` main-account weekly window. Its `weeklyPercent` value
is treated as used percentage and converted to remaining percentage for the
display. The desktop force-refreshes that quota through OpenCodex's official
CLI on startup, Windows resume, and every four hours while running. The command
uses OpenCodex's own management authentication and does not expose credentials
to Usage Pet. A valid cache older than six hours remains visible as the last
trusted percentage with a stale label while refresh is pending. The rollout
`token_count.rate_limits` value remains a fallback only for native Codex and
can never replace an OpenCodex quota with a fabricated 100% remaining value.

## Compatibility contract

Protocol changes require all of the following:

1. desktop `tests/phone-sync-*.test.ts`;
2. Android `phone/app/.../SyncProtocolTest.java`, including the desktop-produced
   ciphertext fixture;
3. relay tests under `phone/cloudflare/test`;
4. documentation updates in both root `docs/` and `phone/docs/`.

## Runtime identities

Repository naming is intentionally separate from installed runtime identity.
The initial consolidation preserves:

- Electron `appId`: `com.adie.usagepet`;
- Electron product name and existing user data directory: `Usage Pet`;
- Android `applicationId`: `com.adie.codexonphone`;
- pairing scheme: `codexphone://`;
- protocol version: `1`;
- deployed Cloudflare endpoint and existing encrypted pairing state.

Changing any of these is a later migration task with explicit rollback and
device validation, not part of moving source files.

## Verification

Run `scripts/check-all.ps1` from a PowerShell process whose Java and Android SDK
environment is configured. It executes the desktop check, Android unit/lint
gates, and relay test/dry-run gate without packaging, deploying, reinstalling,
or changing system configuration.
