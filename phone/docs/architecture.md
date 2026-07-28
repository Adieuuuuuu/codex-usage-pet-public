# Codex Usage Pet on Phone architecture

## Phase-1 live chain

```text
Codex local files (read-only)
          |
          v
Usage Pet CodexMonitor -> privacy projection -> AES-256-GCM envelope
          |                                      |
          +---------- HTTPS publish ------------>|
                                                 v
                                    Cloudflare Durable Object
                                    ciphertext + routing only
                                                 |
                                    hibernating WebSocket
                                                 |
                                                 v
                                  Android sync foreground service
                                                 |
                                  verify/decrypt/replay guard
                                                 |
                                                 v
                                    notification ID 2208
```

Usage Pet owns local interpretation so Android and the relay do not duplicate or
weaken the already-tested Codex semantics.

The pairing bundle contains a relay endpoint, a random room ID, and a random
master secret. HKDF-SHA-256 derives independent authentication and encryption
keys. The authentication material can be presented to the relay; the encryption
key remains only on the two paired endpoints. Snapshot envelopes use a fresh
96-bit nonce and bind protocol version, room ID, and sequence as authenticated
additional data.

The Durable Object is one private room. It validates authentication and bounded
message shape, persists only the newest encrypted envelope, and broadcasts it
to authenticated phone sockets. WebSocket hibernation avoids keeping active
compute running while the room is idle.

Usage Pet publishes immediately when normalized content changes and republishes
the unchanged snapshot every five minutes as a low-frequency freshness
heartbeat. Android schedules one ten-minute freshness deadline from the
desktop's capture timestamp. Missing the deadline preserves the last verified
notification, marks the desktop state stale in the app, and replaces the
possibly half-open socket. If the replacement socket receives only the same
expired relay envelope, a bounded five-minute watchdog repeats recovery until a
fresh envelope restores the normal ten-minute deadline.

Android uses one foreground synchronization service because ordinary background
network work is deferred by Doze and cannot meet the live-delivery requirement.
The existing ongoing Codex notification is the service notification, so the
implementation does not add a second persistent notification. Xiaomi autostart
and unrestricted-battery settings remain a real-device gate.

## Phase-1 ownership

- Usage Pet: live Codex reading, privacy projection, pairing generation,
  encryption, publish, and Windows connection status.
- Cloudflare: authenticated ciphertext relay and latest-envelope persistence.
- Android: protected pairing storage, connection lifecycle, decrypt/validate,
  local last-good snapshot, alert deduplication, and notification rendering.

## Failure behavior

- Relay unavailable: retain the last verified snapshot, mark stale, and retry
  with exponential backoff.
- Missing two expected five-minute desktop heartbeats: retain the last verified
  notification, cancel the possibly half-open phone socket, and establish a new
  authenticated connection.
- An expired baseline replay on the replacement socket remains silent and
  schedules another bounded five-minute recovery check.
- Android default-network replacement or loss: discard the socket bound to the
  previous Wi-Fi, mobile-data, or VPN route and reconnect on the current route.
- The first valid envelope on each new socket establishes its baseline without
  producing an attention alert. Only a later live transition on that same
  connection may alert.
- Wrong key or tampering: reject without changing the notification.
- Old sequence: ignore without alerting.
- Desktop offline: no invented state; the phone keeps the last snapshot with an
  honest stale marker in the app.
- Unpaired: no network service starts; the Activity exposes only the real
  pairing surface and never falls back to fake state.

Release builds accept HTTPS/WSS relay origins only. The debug manifest permits
cleartext loopback traffic solely for Wrangler/emulator verification.

## Historical Phase-0 components

This section records the visual prototype architecture. Its controls and
`FakeCodexState` implementation were removed from packaged source after the
live encrypted chain became the production path.

`MainActivity`

- requested notification permission;
- exposed local test controls;
- invoked deterministic fake-state transitions.

`FakeCodexState` (removed)

- owned the fixed Usage Pet sample tasks;
- persisted only phase-0 flags in `SharedPreferences`;
- supported reset, complete-one-task, remove-viewed-review-task, and task-panel
  visibility.

`NotificationPublisher`

- created the original local notification channel;
- rendered framework `RemoteViews` from the fake state;
- posted all states using one stable notification ID;
- draws density-aware ring and status bitmaps from the Usage Pet tokens.

`NotificationActionReceiver`

- handled an explicit tap on the existing task-panel heading;
- toggled the local hidden flag and republished the same notification.

## Rendering strategy

The notification uses Android framework APIs only:

- `Notification.Builder`
- `Notification.DecoratedCustomViewStyle`
- `RemoteViews`

The normal and heads-up slots use a dedicated `48dp` compact usage capsule so
Android SystemUI does not crop its lower half. The expanded slot keeps the full
source-derived `72dp` usage capsule and three-task panel.

Android provides no public API that forces an ordinary custom notification to
open in its expanded state. The compact view therefore fixes clipping but does
not make the task panel visible without expansion.

Android SystemUI owns the outer app header, padding, expansion affordance, and
available height. The app can reproduce only the custom content inside that
container. The real-device gate decides whether the result is acceptable.
