# Platform matrix and porting guide

## Status legend

- **Implemented:** source exists in this repository and has passed its recorded
  local checks.
- **Reusable:** an existing component may be retained, but the full combination
  still needs end-to-end verification.
- **Blueprint:** a proposed migration grounded in platform constraints; no
  claim that the port exists.

## Matrix

| Computer publisher | Android phone | iPhone |
| --- | --- | --- |
| **Windows** | **Implemented.** Electron desktop reader + Cloudflare relay + native Android notification client. Xiaomi/HyperOS still has explicit physical-device gates. | **Blueprint.** Reuse the Windows reader and encrypted protocol. Add a native iOS app and APNs-assisted delivery; do not copy the permanent Android foreground-service design. |
| **macOS** | **Blueprint with reusable phone side.** Port the desktop reader, local data adapters, packaging, startup, Keychain storage, and deep-link behavior. Retain relay/Android only after fixtures pass. | **Blueprint.** Requires both the macOS publisher port and native iOS/APNs client, plus Apple signing and real-device background tests. |

OpenAI's [Codex app announcement](https://openai.com/index/introducing-the-codex-app/)
records availability on macOS and Windows. It does not promise identical
on-disk schemas, process names, pet directories, or URL handling, so every
desktop adapter must be discovered against the installed version.

## Shared protocol work

All four combinations should preserve one versioned, platform-neutral snapshot:

- protocol version, sequence, and capture time;
- desktop connection/staleness status;
- remaining usage and reset time when available;
- a bounded task list with stable ID, title, status, display age, and update
  time.

Keep encryption and authentication test vectors independent of UI code. A port
must consume a fixture produced by the desktop implementation and reject wrong
keys, modified ciphertext, expired pairing, and replayed sequence numbers.

## Windows publisher: implemented baseline

The current Electron main process reads the local Codex sources, reduces them
to an approved snapshot, protects pairing material with Electron
`safeStorage`, and publishes ciphertext. The renderer is not allowed to read
Codex files or hold master secrets.

When adapting to another Windows architecture or Codex version:

1. discover the current Codex data roots and process/deep-link behavior
   read-only;
2. add fixtures for every observed schema variant;
3. keep stale and unavailable states honest;
4. verify installer architecture and code signing separately;
5. rerun real Codex, restart, multi-monitor, DPI, and login-start tests.

## macOS publisher: blueprint

Electron can package applications for macOS, and its `safeStorage` API uses
macOS Keychain; see Electron's
[`safeStorage` documentation](https://www.electronjs.org/docs/latest/api/safe-storage).
This makes reuse plausible, not automatic.

Porting sequence:

1. Add a platform adapter for Codex data discovery. Do not translate Windows
   paths mechanically. Inspect the installed macOS app, session history, process
   lifecycle, and supported deep links without modifying them.
2. Audit Electron window behavior: transparent/frameless positioning, tray/menu
   APIs, multi-display coordinates, Retina scaling, click-through regions, and
   login items.
3. Keep secrets in Keychain through `safeStorage`; test first access, locked
   Keychain, migration, corruption, and unpair.
4. Add macOS packaging metadata, icons, hardened runtime/entitlements as needed,
   signing, and notarization. The
   [Electron Mac App Store guide](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide/)
   explains that App Store sandboxing is a separate distribution target with
   additional constraints.
5. Validate on both Apple silicon and Intel only if both are claimed.
6. Run the Android or iOS end-to-end gate with a real Codex task before marking
   the publisher usable.

Do not claim macOS support until local state interpretation, protected pairing,
packaging/signing, startup, and real-device synchronization pass.

## Android client: implemented baseline

The current native client uses protected pairing, authenticated decryption,
replay checks, a reconnecting foreground service, one stable ongoing status
notification, and a separate short-lived attention notification.

Android 13 and newer require runtime notification authorization for ordinary
app notifications; see Android's
[notification permission guide](https://developer.android.com/develop/ui/compose/notifications/notification-permission).
Foreground services must remain user-visible through a notification; see
[Android foreground services](https://developer.android.com/develop/background-work/services/fgs).

For a non-Xiaomi Android device:

1. build and install the same Android client;
2. grant notifications;
3. inspect the vendor's autostart/background/battery controls rather than
   reusing HyperOS wording;
4. verify collapsed and expanded notification layouts in the real SystemUI;
5. test exactly-once attention, network loss, process recreation, reboot, and a
   representative battery interval.

Vendor behavior is a device gate, not a code assumption.

## iPhone client: blueprint

iOS notifications use the UserNotifications framework. Apple's
[User Notifications overview](https://developer.apple.com/documentation/usernotifications/)
states that remote notifications are delivered through APNs. Apple's
[background update guide](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)
also states that silent background delivery is low priority, may be throttled,
and is not guaranteed.

Therefore the Android design must not be copied directly:

1. Build a native Swift/SwiftUI companion with Keychain-protected pairing,
   protocol validation, replay defense, last-good snapshot, and explicit stale
   state.
2. Register notification permission and APNs capability through an authorized
   Apple Developer team. Choose development, ad hoc/TestFlight, or App Store
   distribution with the user before creating identifiers or profiles.
3. Extend the relay/provider side to send an APNs wake or encrypted update.
   Prefer a minimal wake signal followed by an authenticated ciphertext fetch
   when privacy requirements disallow notification content at the provider.
4. Never depend on a permanent background WebSocket. Reconcile on foreground
   launch and on delivered background notification; display staleness when iOS
   delays delivery.
5. Keep the APNs signing key on the authorized provider, not in the app or
   repository. Keep the end-to-end content key only on paired endpoints.
6. Test foreground, background, force-quit, reboot, Focus modes, notification
   grouping, network change, revoked permission, and token rotation on a
   physical iPhone.

Apple's [remote notification server guide](https://developer.apple.com/documentation/usernotifications/setting-up-a-remote-notification-server)
describes the provider → APNs → device path. This is a material relay and
operations change, not a UI-only port.

## Relay choices

### Cloudflare: implemented baseline

The Worker and Durable Object authenticate a private room, retain the latest
ciphertext, and broadcast over WebSocket. Cloudflare's
[Durable Object WebSocket guide](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
documents the platform capability. Account authorization, production
deployment, and device reachability remain environment-specific gates.

### Self-hosted server: compatible target, not supplied deployment

A self-hosted implementation may use any stack that provides:

- HTTPS/WSS with a valid certificate;
- the same authentication derivation and protocol version;
- bounded request/body sizes and rate limits;
- atomic newest-envelope persistence per room;
- reconnecting subscriber delivery;
- expiry and deletion behavior;
- ciphertext-only logs, backups, metrics, and administrator views.

Do not expose a home server directly without authentication and TLS. Decide who
patches the OS/runtime, rotates certificates, monitors availability, backs up
only necessary ciphertext, and handles abuse. The Agent must add contract tests
that run unchanged against Cloudflare and the self-hosted adapter.

## Definition of done for any new cell

A platform combination is complete only when:

1. all components build on the target toolchain;
2. cross-language encryption fixtures pass;
3. pairing material is OS-protected and redacted everywhere else;
4. real Codex state reaches a physical phone;
5. ordinary refresh is silent and an intended attention transition alerts once;
6. desktop-read tasks disappear consistently on the phone;
7. stale, reconnect, reboot, and permission-revocation behavior is honest;
8. visual evidence passes on the target OS/device;
9. packaging/signing/install are separately recorded;
10. remaining store, account, network, and long-duration battery gates are named.
