# Codex Usage Pet Mobile requirements

## Complete task access and Mobile naming

- The user-visible application name is `Codex Usage Pet Mobile`. Preserve the
  existing application ID, pairing URI, secure stores, notification IDs,
  channels, and signing identity.
- The expanded notification may keep three full task rows because Android and
  HyperOS bound custom notification height. When more tasks exist, its count
  must expose an explicit path to the application.
- The application must render every task present in the verified snapshot in
  snapshot order, with the existing title, workspace, age, and honest
  `running` / `waiting` / `review` / `failed` state. It must not invent
  per-task percentage progress.
- Saving a verified snapshot must notify an already visible Activity through
  non-sensitive local state, without exposing pairing material or plaintext.
- The launcher icon must be an original project asset. Keep the existing
  monochrome notification icon for SystemUI and do not use OpenAI or ChatGPT
  marks as this application's own branding.

## Phase 1: live encrypted synchronization

### Goal

Replace phase-0 fake transitions with the live snapshot already produced by
Usage Pet. A Codex state change on the Windows computer must reach the paired
Xiaomi phone within a few seconds and update the existing notification.

### Live data contract

Only these fields may leave the computer:

- protocol version and monotonically increasing sequence;
- snapshot capture time;
- weekly usage availability, remaining percentage, and reset timestamp;
- task ID, display title, workspace display name, status, and update time.

Prompt bodies, assistant responses, tool inputs or outputs, account data,
Codex authentication data, cookies, local paths, and raw rollout records are
forbidden.

### Required behavior

1. Usage Pet publishes only when the normalized live snapshot changes, plus a
   bounded connection heartbeat.
2. A random pairing bundle creates one private room and separate derived
   encryption and relay-authentication keys.
3. The desktop encrypts every snapshot with AES-256-GCM before transmission.
4. Cloudflare stores and broadcasts only the encrypted envelope and bounded
   routing metadata.
5. Android stores pairing material using Android Keystore-protected encryption,
   maintains a reconnecting background connection, rejects replayed or
   out-of-order envelopes, and restores the last verified snapshot after
   process restart.
6. Ordinary snapshot changes, service startup, process restoration, reconnect,
   heartbeat, and stale-state updates silently update ongoing notification ID
   `2208`. This status notification never supplies a heads-up view and never
   makes sound or vibrates.
7. A task newly entering `waiting`, `review`, or `failed` updates ongoing ID
   `2208` silently and posts one separate, short-lived heads-up notification.
   Reconnect and initial history replay never post that alert.
8. When Usage Pet removes a read `review` task, Android removes the same stable
   task on the next snapshot.
9. Disconnects use bounded exponential backoff and expose an honest offline or
   stale state without discarding the last verified snapshot. Replacing the
   Android default network or missing two expected five-minute desktop
   heartbeats must discard a possibly half-open socket and reconnect. An
   expired replayed baseline must keep a bounded recovery watchdog active.
10. Unpairing removes local pairing material and stops network synchronization;
    it never modifies Codex data or the Cloudflare account.
11. The packaged Activity exposes only real pairing, synchronization,
    disconnect, and notification-permission behavior. Phase-0 fake state,
    prototype notification buttons, and simulated transitions do not ship.
12. Activity content applies framework system-bar and display-cutout insets on
    all four edges so it does not render behind status, camera-cutout, or
    navigation chrome.

### Security and privacy gates

- TLS is required in addition to payload encryption.
- Pairing secrets and derived keys never enter source control or logs.
- The relay authenticates a room before accepting a publish or subscription.
- Ciphertext size, task count, title lengths, timestamps, and message rate are
  bounded before storage or rendering.
- Codex local files remain read-only.
- The implementation must include tamper, wrong-key, replay, malformed JSON,
  oversized payload, and reconnect tests.

### Acceptance

- A real running Codex task appears on the phone within five seconds on a
  healthy connection.
- A real completion produces exactly one system sound and vibration.
- A real completion also produces one heads-up notification that expires
  automatically while ongoing status ID `2208` remains visible.
- Launching, restoring, or reconnecting the background service without a real
  attention transition never produces a heads-up notification, even though
  the ongoing foreground-service notification remains in the shade.
- Opening a completed review task from Usage Pet into Codex removes it from the
  phone within five seconds.
- Usage percentage and reset date match the same Usage Pet snapshot.
- Expanded and compact layouts keep the literal `%` mark separate from the
  dynamic reset month and day; both date fields are bound to the live
  `resetsAt` value.
- Every visible running-task ring rotates continuously while SystemUI is
  displaying it. Non-running task icons remain static, and animation must not
  be implemented by periodically reposting the notification.
- The chain reconnects after phone network loss, default-network or VPN route
  replacement, multi-hour phone idle, Usage Pet restart, and phone process
  restart without requiring an app restart or producing duplicate alerts.
- Cloudflare and Xiaomi device verification are external gates; local mocks do
  not replace them.

## Historical Phase-0 visual baseline

The controls and fixed sample values below document the prototype that
established the notification geometry. They were removed from shipping source
after the encrypted live chain was accepted and must not be restored as an app
fallback.

## Goal

Build an installable Android prototype that tests whether a Xiaomi 15 Ultra can
show the accepted Usage Pet usage summary and three Codex task rows directly in
the notification shade without requiring the user to expand the notification.

This phase answered whether HyperOS could preserve the required notification
presentation. It remains as the visual regression baseline for Phase 1.

## Source of truth

Visual and behavioral reference:

- repository-root `src/renderer/styles.css`
- repository-root `src/renderer/index.html`
- repository-root `src/renderer/task-panel-layout.ts`
- the user-provided Usage Pet screenshot

Fake data:

- usage: `22%`
- reset date: `8月2日`, `星期日`
- summary: `运行 2`, `完成 1`
- running task: `整理本周学习笔记` / `示例工作区 · 刚刚`
- waiting task: `检查演示应用状态` / `示例工作区 · 刚刚`
- review task: `确认发布前检查清单` / `公共示例 · 2 分钟前`

## Required behavior

1. The app requests Android notification permission when required.
2. Posting the prototype creates one ongoing system notification with a stable
   ID.
3. The app supplies a complete `48dp` compact version of the Usage Pet usage
   capsule for Android's collapsed and heads-up slots, avoiding the previous
   lower-half clipping. The expanded slot retains the original `72dp` usage
   capsule and task panel.
4. Tapping the existing task-panel heading toggles task visibility and updates
   the same notification. The hidden state is persisted locally.
5. Ordinary updates do not make sound or vibrate.
6. The historical prototype simulated a newly completed task to validate one
   sound/vibration alert.
7. The historical prototype simulated "viewed on desktop" to validate removal
   of only the matching review task.
8. The historical prototype could restore and clear its fixed visual state.

## Visual invariants

- Use the accepted Usage Pet light surfaces and typography hierarchy.
- Expanded usage capsule height: `72dp`.
- Collapsed usage capsule height: `48dp`, with the same three-column hierarchy
  scaled proportionally because Android 12+ caps custom collapsed content at
  `48dp`.
- Usage ring: `54dp`, `3dp` track and value.
- Usage dividers: `1dp × 34dp`.
- Task panel radius: `22dp`.
- Task row height: `52dp`, gap: `7dp`, radius: `16dp`.
- Three fake task rows remain at the original row height.
- Do not shrink the expanded Usage Pet design merely to fit an Android
  custom-notification limit. The compact capsule is the only explicit
  exception and exists solely to prevent clipping in the system-owned
  collapsed slot.
- No pet artwork appears in the phone notification.

## Phase-0 finding and accepted boundary

Android does not expose a public API that forces an ordinary custom
notification to stay expanded. The user accepted the source-derived compact
capsule plus manually expanded task panel and authorized Phase 1 on that basis.

The Xiaomi gate now checks that the accepted compact capsule is complete, the
expanded task panel is not clipped, live updates stay on notification ID
`2208`, alert transitions occur once, and the background connection survives
normal HyperOS lifecycle conditions.

## Historical phase-0 out of scope

- direct Android access to Codex local files;
- Firebase Cloud Messaging, Xiaomi Push, or VPN transport;
- accounts or production distribution;
- Play Store release.
