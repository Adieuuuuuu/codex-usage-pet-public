# Public sharing release record

## Goal

Provide a safe public repository that a person can understand and an
implementation Agent can use without access to the owner's machine, accounts,
endpoints, pairing material, or private deployment history.

## Delivered

- Human-facing English and Chinese READMEs with motivation, platform status,
  first run, daily use, honest limits, and a documentation index.
- A complete Agent replication guide that starts with device, network,
  permission, relay, signing, and installation questions.
- A root public `AGENTS.md`, platform matrix, development story, deployment
  guide, visual guide, and fail-closed export manifest.
- Desktop, Android, and ciphertext-relay source with independent build systems.
- A licensed default v2 pet, cleared public screenshots, and a newly synthesized
  public-domain notification sound.

## Safety boundary

- No key, token, pairing bundle, production endpoint, account identifier,
  device identifier, private log, real task title, prompt body, or response body
  is included.
- Private verification history and raw device evidence remain only in the
  private monorepo.
- Windows + Android is implemented. macOS and iPhone content is a porting plan,
  not a claim of completed support.
- Source and documentation use MIT. Asset-specific provenance and licenses are
  recorded in `ASSET-LICENSES.md`.
- Repository creation and source push were explicitly authorized for this
  release. Cloud deployment, signing, binary release publication, and physical
  device installation remain separate actions.

## Completion checks

- [x] Public tree created from a fail-closed allowlist with fresh Git history.
- [x] Human and Agent documentation updated for the published state.
- [x] Private paths, endpoints, secrets, generated output, and raw evidence
  excluded by automated audit.
- [x] Code and asset licenses recorded.
- [x] Desktop, Android, and relay checks rerun from the public tree.
- [x] Public repository visibility and remote commit read back after push.
