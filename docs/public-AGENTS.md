# Codex Usage Pet public Agent rules

Use this file as the root `AGENTS.md` in a public snapshot of Codex Usage Pet.
It contains only portable rules. Do not add local absolute paths, account
details, deployed endpoints, device identifiers, pairing material, or private
verification evidence.

## First response: collect the route

Before changing code, ask the user for:

1. computer OS, version, and architecture;
2. phone OS, version, and device model;
3. the Codex installation/data source to be read locally and whether one
   harmless real task can be used for read-only verification;
4. relay choice: Cloudflare, compatible self-hosted HTTPS/WSS, or desktop-only;
5. direct network, proxy, VPN, DNS, and regional constraints on both devices;
6. permission choices: cloud authorization, desktop installation/startup,
   Android sideloading and notification/background settings, or Apple
   signing/APNs capabilities;
7. available Hatch Pet assets and whether their intended use allows private or
   public redistribution.

Summarize the selected route and external approval gates before implementation.
Do not guess missing system or authorization details.

## Required reading order

1. This file.
2. `docs/agent-replication-guide.md`.
3. `docs/platform-porting-guide.md`.
4. `docs/permissions-network-and-deployment.md`.
5. `docs/visual-reference-guide.md`.
6. `docs/system-architecture.md` and `phone/docs/protocol.md` when changing the
   cross-device contract.

The public snapshot does not include private deployment records, raw device
screenshots, pairing state, or the owner's internal verification archive.

## Honest platform boundary

- Windows desktop + Android phone is the implemented reference route.
- macOS desktop and iPhone are porting blueprints until their source,
  packaging/signing, and physical-device gates pass.
- Reusing a protocol or client does not prove a new platform combination.
- Keep “implemented,” “locally verified,” “deployed,” “installed,” and
  “physical-device accepted” as separate claims.

## Product and privacy contract

- The desktop publisher is the only Codex state reader.
- Codex files, databases, sessions, configuration, and logs remain read-only.
- Reduce state to the approved phone display fields before transmission.
- Encrypt on the computer; the relay must not receive the content key.
- The phone protects pairing material, authenticates/decrypts snapshots,
  rejects tampering/replay, and displays honest stale state.
- Never transmit prompt bodies, response bodies, tool inputs/outputs, Codex
  credentials, cookies, raw rollout files, complete databases, or local paths.
- Never commit or log secrets, room IDs, pairing URLs, device/APNs tokens,
  production endpoints, account identifiers, or unredacted private screenshots.

Protocol, task semantics, privacy projection, pairing, authentication, or alert
changes require coordinated desktop, relay, and phone tests.

## Authorization boundaries

Explicitly ask before:

- logging into or deploying to a cloud account;
- creating or changing production resources;
- modifying secrets, environment files, CI/CD, DNS, certificates, or signing
  configuration;
- installing a desktop app or APK, registering Apple identifiers/profiles, or
  submitting to an app store;
- enabling login startup, autostart, unrestricted battery use, a persistent
  proxy/VPN, firewall changes, or other system settings;
- publishing source, packages, screenshots, or release notes.

Read-only inspection, local dependency installation inside the repository,
tests, builds, and deployment dry runs are allowed when scoped to the user's
request and environment.

## Implementation order

1. Audit Git status, source layout, secrets, assets, and existing tests.
2. Verify the desktop reader with one real Codex transition and honest
   unavailable/stale behavior.
3. Verify the encrypted protocol and relay locally.
4. Stop for authorization before any relay deployment.
5. Build and inspect the phone client; stop for authorization before install.
6. Pair through a short-lived protected flow without exposing pairing material.
7. Run the selected physical-device gate for alerts, task removal, reconnect,
   reboot, layout, and battery behavior.
8. Report every layer and remaining external gate separately.

For detailed commands and platform branches, follow
`docs/agent-replication-guide.md`.

## Visual and asset rules

- Preserve the desktop content hierarchy and task semantics.
- Treat OS-owned notification chrome as a platform constraint.
- Use synthetic task/project names in public screenshots and fixtures.
- Private verification evidence is not a public design asset.
- Validate Hatch Pet manifests and sprite sheets before rendering.
- Do not redistribute pet artwork, icons, audio, or screenshots until their
  license or permission is confirmed.

This public snapshot uses the MIT License for source and documentation.
Bundled artwork, screenshots, audio, wrapper files, and dependencies keep the
separate terms recorded in `ASSET-LICENSES.md`. Do not import or redistribute
new assets until their provenance and intended use are confirmed.

## Verification

At minimum, report:

| Layer | Evidence |
| --- | --- |
| Desktop | type check/tests/build, real state, read-only behavior, UI lifecycle |
| Protocol | cross-language fixtures, wrong-key/tamper/replay rejection |
| Relay | tests, dry run, authorized deployment read-back if performed |
| Phone | unit/lint/build, permissions/signature, install result if performed |
| End to end | latency, silence/alert routing, viewed-task removal, stale/reconnect |
| Device | real SystemUI layout, reboot/process recovery, battery interval |

An emulator or local mock never replaces the target physical-device gate.
