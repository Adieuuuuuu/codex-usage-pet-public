# Why Codex Usage Pet exists

## The problem

The project started from a practical remote-development routine. Front-end work
still needed the real computer: browser previews, local tools, terminals, and
visual inspection did not fit comfortably into a phone-only workflow. Remote
control made the computer reachable, but it also created a new tax: after
sending work to Codex, there was no dependable, glanceable signal for when a
task was still running, waiting for input, completed, or failed.

Keeping a remote-control session open was distracting. Reopening it every few
minutes was worse. The desired experience was simple: leave the computer doing
the work, put the phone away, and return only when a timely notification said
attention was useful.

At the same time, the built-in desktop pet did not always reflect the active
task state in the way the user expected. The user wanted a pet that visibly
“worked,” plus the same practical information already needed during the day:
remaining usage, reset date, active tasks, and completed tasks waiting to be
read.

## The first response: make the desktop state trustworthy

The project did not begin with phone sync. It first built a small Windows
Electron companion around read-only local Codex data.

The desktop work established several rules:

- Codex data stays read-only; the app does not patch the official client.
- State comes from observed task/session sources, never from decorative fake
  activity.
- Usage data may show unavailable rather than carry an expired number forward.
- The renderer receives typed, allowlisted data from the main process instead
  of direct filesystem or database access.
- Pet animation follows task semantics such as `running`, `waiting`, `review`,
  and `failed`.
- A standard Hatch Pet package can change the artwork without changing task
  interpretation.

The desktop UI then grew around the real workflow: a compact pet and usage
capsule, a bounded task panel, direct thread opening where supported, consistent
resizing, and a tray lifecycle that stays out of the way.

## The second response: send only what the phone needs

The phone was not allowed to become another Codex data reader. That would have
duplicated platform-specific parsing and widened the privacy boundary.

Instead, the desktop remains the single source of truth:

1. read and interpret local Codex state;
2. reduce it to the fields visible in the phone UI;
3. add sequence and capture time;
4. encrypt with AES-256-GCM before leaving the computer;
5. send the ciphertext to a private relay.

The Cloudflare Worker and Durable Object authenticate a room, retain the latest
encrypted envelope, and broadcast ciphertext. They do not receive the content
key or understand prompt/response content. The Android client protects pairing
material, decrypts locally, rejects tampering and replay, and updates the
system notification.

This division let the three components use the tools appropriate to their jobs:
Electron/TypeScript for the desktop, Worker JavaScript for the relay, and native
Android/Java `RemoteViews` for the notification.

## Designing for attention, not noise

The notification is both status surface and background-service disclosure.
Those roles needed different interruption rules.

- Normal state refresh and heartbeat: silent, update in place.
- Newly actionable transitions: at most one short sound/vibration event.
- Ongoing status: one stable notification identity.
- Attention alert: a separate short-lived identity, so a service restart cannot
  accidentally turn the persistent status into a heads-up alert.
- Viewed review task: removed after the desktop reports it as read.

The phone view deliberately mirrors the desktop content hierarchy, while
accepting that Android/HyperOS owns the outer notification header, expansion
state, padding, and height. Emulator screenshots helped catch deterministic
layout and animation defects, but HyperOS-specific rendering remained a
physical-device gate.

## What the work produced

The repository now contains one product with three independently built
components:

- a Windows Usage Pet that reads real Codex state locally and read-only;
- a ciphertext-only Cloudflare relay;
- a native Android companion that turns the approved state into system
  notifications.

Recorded local verification covers desktop type checking/tests/builds, Android
unit tests/lint/build inspection, relay tests and deployment dry runs, protocol
fixtures, and notification rendering evidence. The production relay connection
and encrypted desktop-to-Xiaomi path have also been exercised.

That is not the same as universal platform support. Windows + Android is the
implemented reference combination. macOS and iPhone are documented migration
routes, not finished products. HyperOS presentation, exactly-once alerts,
desktop-read removal, reboot recovery, and representative battery behavior
must be rechecked for each released build and device.

## Lessons worth reusing

1. Start with a trustworthy local state model; remote delivery only amplifies
   whatever the desktop believes.
2. Keep one reader and project the smallest phone snapshot.
3. Encrypt before transport and design the relay so it cannot decrypt.
4. Treat notification channels, IDs, background lifecycle, and vendor battery
   policy as product behavior, not packaging details.
5. Separate emulator evidence from physical-device acceptance.
6. Separate “source built,” “deployed,” “installed,” and “accepted in daily
   use.”
7. Preserve privacy and runtime identities during structural repository work;
   rename products and migrate installed data only with a rollback plan.

The most reusable result is not a screenshot or one APK. It is the boundary:
local read-only interpretation on the computer, a minimal encrypted protocol,
an untrusted relay, and platform-native attention on the phone.
