# Codex Usage Pet on Phone

This directory is the phone and private-relay component of the Codex Usage Pet
monorepo. The Windows desktop publisher lives at the repository root.

Private Android companion for receiving live Usage Pet/Codex task and usage
state in the system notification shade.

## Current implementation

- Usage Pet remains the only reader of local Codex files.
- The desktop sends only the approved usage and task display fields.
- Every snapshot is encrypted with AES-256-GCM before leaving the computer.
- A Cloudflare Worker plus SQLite Durable Object stores and broadcasts only the
  latest ciphertext.
- Android keeps one reconnecting `specialUse` foreground service and updates
  notification ID `2208` in place.
- New `waiting`, `review`, or `failed` transitions request one system sound and
  vibration; ordinary updates and five-minute heartbeats are silent.
- Pairing and the last verified snapshot are protected by Android Keystore.
- The app restores after device reboot and marks the desktop state stale after
  ten minutes without a fresh encrypted snapshot.

Cloudflare production deployment and the Xiaomi cryptographic connection are
confirmed. HyperOS presentation, one-shot completion alerting, viewed-task
removal, reboot recovery, and battery behavior remain physical-device gates.

## Installable APK

`app/build/outputs/apk/debug/app-debug.apk`

This is a private local debug build. It is not published to an app store.

## Android build

```powershell
# Set these only when they are not already configured. Replace the placeholders
# with the JDK 17 and Android SDK locations on your own computer.
$env:JAVA_HOME='<your JDK 17 installation>'
$env:ANDROID_HOME='<your Android SDK installation>'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
.\gradlew.bat --no-daemon testDebugUnitTest lintDebug assembleDebug
```

On macOS or Linux, export the equivalent `JAVA_HOME`, `ANDROID_HOME`, and
`ANDROID_SDK_ROOT` values for your shell, then run `./gradlew` instead of
`gradlew.bat`. Do not copy another contributor's absolute SDK paths into source
or documentation.

## Relay checks

```powershell
cd cloudflare
npm.cmd install
npm.cmd run check
```

`npm run check` runs the dependency-free relay tests and a real Wrangler
deployment dry-run. Production deployment requires the user's Cloudflare
browser authorization.

## Pairing flow after deployment

1. Start the updated Usage Pet.
2. Open its context menu and choose `连接手机`.
3. Usage Pet creates a protected pairing, publishes the current encrypted
   snapshot, and copies a pairing code for five minutes.
4. Open `Codex Usage Pet on Phone`, paste the code, and tap `连接`.
5. On Xiaomi, enable notifications, autostart, and unrestricted battery use for
   this app, then run `docs/xiaomi-gate.md`.

The expanded notification's `Codex 任务` heading hides or restores task rows.
Tasks are visible by default. Phase-0 fake controls and sample-data entry
points are not packaged in either debug or release variants; deterministic
visual and contract fixtures remain under tests and public documentation.

## Platform boundary

Android and HyperOS own the outer notification header, collapsed/expanded
choice, padding, and maximum height. The accepted compact capsule is complete in
the collapsed slot; task details remain in the expanded slot because Android
offers no public API that forces an ordinary custom notification to stay
expanded.
