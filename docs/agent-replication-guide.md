# Agent replication guide

This is the operational entry point for an implementation Agent. The human
should be able to give you the repository URL and say “help me build this for
my devices.” Do not start by copying commands blindly. First identify the
platform route, permissions, and deployment choice.

## 1. Ask before acting

Ask the user these questions in one compact message:

1. What computer OS, version, and CPU architecture do you use: Windows or
   macOS, x64 or ARM64?
2. What phone OS, version, and device model do you use: Android or iPhone?
3. Is Codex installed, signed in, and actively used on that computer? Can you
   run one harmless test task while we verify read-only status detection?
4. Do you want the existing Cloudflare relay, your own HTTPS/WebSocket server,
   or only a local desktop pet with no phone sync?
5. Are you willing and able to authorize the selected cloud account, install a
   locally built desktop app, and sideload a phone build? For iPhone, do you
   have access to macOS, Xcode, and an Apple Developer team suitable for the
   intended distribution method?
6. Does either device require a proxy or VPN to reach package registries,
   Cloudflare, or the selected server? Do not assume that a proxy is required;
   test direct connectivity first.
7. On the phone, may the app request notifications and background operation?
   On Android vendors such as Xiaomi, may the user enable autostart and
   unrestricted battery use?
8. Does the user want the licensed bundled `zhima-3` example pet or an
   existing custom Hatch Pet package? Validate any replacement package and
   confirm its intended private or public use before redistribution.

Summarize the answers, name the selected route from
[`platform-porting-guide.md`](platform-porting-guide.md), and state which steps
need explicit approval. If a required answer is unavailable, continue with
read-only inspection and local tests; do not silently deploy, sign, install, or
change system settings.

## 2. Non-negotiable product contract

Preserve these responsibilities even when porting:

```text
desktop reader
  read Codex locally and read-only
  -> reduce to approved display fields
  -> encrypt on the computer
  -> publish ciphertext

relay
  authenticate a room
  -> retain/broadcast only bounded routing metadata and ciphertext
  -> never receive the content key

phone
  protect pairing material
  -> receive and decrypt
  -> reject tampering/replay
  -> render a system-owned notification
```

Never transmit prompt bodies, response bodies, tool inputs or outputs, Codex
credentials, account cookies, local paths, raw rollout files, or complete
databases. Never put deployment credentials, endpoints, room IDs, pairing
codes, device tokens, or encryption keys in source, documentation, logs, issue
reports, or commits.

The current protocol contract is documented in
[`../phone/docs/protocol.md`](../phone/docs/protocol.md). If the payload,
encryption, authentication, task identity, or alert semantics change, update
and test the desktop publisher, relay, and phone receiver together.

## 3. Inspect before building

1. Read the repository's root `AGENTS.md`. In a public snapshot, it should be
   the portable template from `docs/public-AGENTS.md`; do not depend on the
   owner's private project rules.
2. Read [`system-architecture.md`](system-architecture.md), the protocol,
   and the relevant platform route.
3. Run a secret scan that covers tracked and untracked files. Review each hit;
   do not print secret values.
4. Inspect current Git status and preserve unrelated work.
5. Confirm the source tree does not depend on machine-specific absolute paths.
6. Record the baseline checks before changing code.

The repository root is the Windows desktop implementation. `phone/app` is the
Android implementation, and `phone/cloudflare` is the ciphertext relay.

## 4. Build the implemented route: Windows + Android

### Desktop

Requirements: Windows 10/11 x64, current Codex Desktop, Git, and Node.js 24 or
later.

```powershell
git clone https://github.com/Adieuuuuuu/codex-usage-pet-public.git
cd codex-usage-pet-public
npm.cmd ci
npm.cmd run check
npm.cmd run start
```

With a real Codex task running, verify:

- the pet and task list reflect real state rather than sample data;
- usage and reset date either match Codex or honestly show unavailable;
- opening a task goes to the intended Codex thread or safely wakes Codex;
- closing the visible window leaves the tray process only when the user chose
  that behavior;
- no Codex file or database is modified.

Package only after those checks:

```powershell
npm.cmd run dist:win
```

The current build emits an NSIS installer and a portable executable under
`release/`. Public distribution should use code signing; Electron's official
[distribution overview](https://www.electronjs.org/docs/latest/tutorial/distribution-overview)
explains packaging and signing as separate steps.

### Relay

```powershell
cd phone\cloudflare
npm.cmd ci
npm.cmd run check
```

`check` runs relay tests and a Wrangler deployment dry run. Stop here until the
user explicitly authorizes Cloudflare login and deployment. After deployment,
read back a non-secret health response and confirm the deployed version. Do not
copy credentials or production identifiers into the repository.

Cloudflare Durable Objects support coordinated WebSocket clients and durable
storage; the [official WebSocket guide](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
also explains hibernation. This repository's stricter contract is
ciphertext-only storage and broadcast.

### Android

Requirements: JDK 17, Android SDK/build tools matching the project, and either a
physical Android device or emulator.

```powershell
cd phone
.\gradlew.bat --no-daemon testDebugUnitTest lintDebug
```

Only build an APK when the user requests an installable artifact:

```powershell
.\gradlew.bat --no-daemon assembleDebug
```

Inspect the manifest and packaged permissions, verify the signature and hash,
then ask before installing. On Android 13+, notification display requires the
runtime `POST_NOTIFICATIONS` permission; see the
[Android notification permission documentation](https://developer.android.com/develop/ui/compose/notifications/notification-permission).
The live connection uses a foreground service and therefore must keep a
user-visible status notification, consistent with Android's
[foreground-service guidance](https://developer.android.com/develop/background-work/services/fgs).

### Pair and use

1. Start the desktop publisher and confirm its local data is correct.
2. Create a short-lived pairing bundle from the desktop UI.
3. On the phone, inspect the relay address and room shown by the confirmation
   screen before accepting.
4. Grant notifications. On Xiaomi/HyperOS, also enable autostart and
   unrestricted battery use if the user accepts that tradeoff.
5. Run the full physical-device gate in
   [`../phone/docs/xiaomi-gate.md`](../phone/docs/xiaomi-gate.md).

No accessibility, overlay, location, storage, Google account, or Xiaomi account
permission is part of the current implementation.

## 5. Other device combinations

Do not mark a port complete because it compiles. Follow
[`platform-porting-guide.md`](platform-porting-guide.md):

- **macOS + Android:** port and verify the desktop reader and packaging; reuse
  the Android client and relay only after protocol fixture tests pass.
- **Windows + iPhone:** keep the Windows reader, but build a native iOS client
  and an APNs-assisted wake/delivery path. A permanent background WebSocket
  cannot be treated as an Android-equivalent design.
- **macOS + iPhone:** do both migrations and test signing, Keychain, APNs, and
  real-device background behavior.

OpenAI currently documents Codex desktop availability on both macOS and Windows
in [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/).
That does **not** guarantee identical local storage layouts or deep-link
behavior. Discover and test the installed version read-only on each OS.

## 6. Pet assets and default behavior

The desktop product reads Hatch Pet packages; it is not a replacement Codex
client. A standard package contains `pet.json` and `spritesheet.webp`.

- The public repository includes the licensed `assets/pets/zhima-3` v2 package
  as a buildable default. A first-time user does not need a separate pet
  project.
- User-installed packages in the Codex pet directory are discovered first. A
  valid package with the same ID overrides the bundled fallback without source
  changes.
- If the user wants a custom pet, validate its manifest, path containment,
  `1536x1872` v1 or `1536x2288` v2 atlas, visual semantics, and license.
- Do not copy an installed Codex asset into a public build merely because it is
  readable on disk; redistribution still needs permission.
- Treat pet selection as presentation. Task interpretation, usage, encryption,
  and phone protocol remain independent of the selected artwork.

See [`visual-reference-guide.md`](visual-reference-guide.md) and the root
[`ASSET-LICENSES.md`](../ASSET-LICENSES.md) before changing or redistributing
visual material.

## 7. Common failure patterns

- **Sample data is mistaken for live data.** Prove one real Codex transition
  end to end and keep prototype controls out of release builds.
- **A Windows path is copied into a macOS port.** Discover each installed Codex
  version and add adapter fixtures; do not guess.
- **The relay works on the computer but not the phone.** Test HTTPS and WSS from
  both networks, then inspect DNS, per-app VPN, split tunnel, and vendor network
  controls before rotating pairing.
- **A proxy is treated as mandatory.** Try direct connectivity first and scope
  any workaround to the affected process.
- **The persistent status notification starts making noise.** Keep ordinary
  status/heartbeat updates on a silent ongoing identity and attention alerts on
  a separate short-lived identity.
- **An emulator screenshot is called a device pass.** SystemUI evidence is
  useful, but HyperOS/vendor behavior, reboot, alerts, and battery need the
  physical device.
- **An iPhone port holds an Android-style permanent WebSocket.** Design around
  APNs, reconciliation, and honest staleness instead.
- **Public screenshots leak work context.** Replace task titles, project names,
  endpoints, device identifiers, and notification metadata with synthetic
  values before publication.
- **One license is assumed to cover every asset.** Keep the MIT source license
  separate from the artwork, screenshot, sound, wrapper, and dependency terms
  recorded in `ASSET-LICENSES.md`.

## 8. Verification and handoff

Minimum local gate:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-all.ps1
```

Then report each layer separately:

| Layer | Required evidence |
| --- | --- |
| Desktop UI | real state, usage fallback, light/dark, resize, tray lifecycle |
| Desktop data | read-only access, stale-state behavior, no sensitive logs |
| Relay | tests, dry run, authorized deployment health, ciphertext-only review |
| Phone | unit/lint, package permissions/signature, install result |
| End to end | update latency, tamper/replay rejection, task removal, reconnect |
| Device | notification layout, exactly-once alerts, reboot, battery behavior |

Use “implemented,” “locally verified,” “deployed,” “installed,” and
“physical-device accepted” as distinct claims. List every external gate that
remains.
