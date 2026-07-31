# Xiaomi 15 Ultra gate

## Install and pair

1. Copy `app/build/outputs/apk/debug/app-debug.apk` to the phone and install it.
2. Open `Codex Usage Pet Mobile` and allow notifications.
3. In HyperOS app settings, enable autostart and set battery use to unrestricted.
4. In Usage Pet, choose `手机同步` → `生成/复制配对码`.
5. Open the pairing link on the phone, verify the room and relay address shown
   by the confirmation dialog, then confirm the connection.

No VPN, accessibility service, overlay, location, storage, Google account, or
Xiaomi account permission is required.

## Gate sequence

1. Start a real Codex task on the computer. Confirm the notification updates
   within 5 seconds under a normal network.
2. Pull down the notification shade and expand the fixed notification once.
   Capture a screenshot showing the full usage capsule and task rows.
3. With at least five mixed-state tasks, confirm the notification count shows
   five and `查看全部` while keeping the first three rows complete. Tap it and
   confirm the App lists all five in snapshot order and scrolls to the last row.
4. Let one real task complete. Confirm exactly one system sound and vibration.
5. Wait for an unchanged five-minute heartbeat. Confirm it causes no sound or
   vibration.
6. Open the completed review task from Usage Pet into desktop Codex. Confirm it
   disappears from the phone task list within 5 seconds.
7. Tap the `Codex 任务` heading to hide the rows, then restore them. Confirm the
   choice persists after closing and reopening the notification shade.
8. Lock and unlock the phone, reopen the app, and reboot the phone. Confirm the
   foreground notification returns and reconnects automatically.
9. Disconnect the phone network, then reconnect it. Confirm the app changes to
   offline and returns to connected without duplicate completion alerts.
10. Repeat with several unrelated notifications present.

## Evidence to return

- HyperOS version and Android version
- screenshot of the expanded live notification
- measured start/update and desktop-view removal latency
- whether the usage capsule lower edge and every visible task row are complete
- whether `查看全部` opened the App and every synced task was reachable in order
- whether completion produced exactly one sound and vibration
- whether the unchanged heartbeat stayed silent
- whether reconnect and reboot recovered automatically
- battery usage shown by HyperOS after a representative day

## Pass

The live desktop state reaches the phone within 5 seconds in normal conditions;
completion alerts exactly once; unchanged heartbeats remain silent; viewed
tasks disappear; every synced task remains reachable through the App's complete
list; and the connection survives shade reopen, lock, process recreation,
network loss, and reboot without duplicate alerts.

## Fail

Clipped accepted UI, repeated/missing completion alerts, loss of pairing,
failure to reconnect, silent stale data presented as connected, or material
battery drain fails the physical-device gate.
