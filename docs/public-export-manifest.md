# Public export manifest

## Purpose

The private monorepo contains complete source plus machine-specific development
history. A public mirror must be a fresh, sanitized snapshot, not a push or
history rewrite of this repository.

[`scripts/public-export-files.json`](../scripts/public-export-files.json) is the
fail-closed file manifest. Files matching `include` are public candidates.
Everything below `docs/`, `scripts/`, or `phone/` that is not explicitly
included stays private. A new top-level tracked file fails the audit until it
is classified.

When materializing the public tree, also copy
`docs/public-AGENTS.md` to root `AGENTS.md`. The manifest records that generated
public-root copy under `publicOutputOnly`; never copy the private root
`AGENTS.md`. Keep the documentation copy because the READMEs link to it.

The manifest deliberately includes:

- the desktop `src/`, `tests/`, `hooks/`, package metadata, licensed
  default pet/icon, public-domain notification sound, build script, and
  repository-wide check script;
- the native Android app, Gradle wrapper/configuration, unit tests, and
  resources;
- the Cloudflare relay source, tests, Wrangler configuration, and package
  metadata;
- the focused architecture, protocol, replication, porting, deployment,
  Xiaomi-gate, public Agent rules, and public-facing narrative documents;
- root, Android, and relay ignore rules that keep local properties, environment
  files, caches, and generated output out of the public history.

It deliberately excludes:

- root and phone `AGENTS.md` files containing private-workspace operating rules;
- execution plans, verification logs, migration history, local design QA,
  deployment notes, and all `phone/docs/evidence/`;
- CDP capture, local installation, Codex-storage probing, and one-off
  diagnostic scripts;
- environment files, credentials, generated output, caches, APKs, installers,
  archives, and private relay state;
- private pet source photographs and generation intermediates; only the
  licensed distributable v2 package is present.

## Audit

From the private repository:

```powershell
node scripts/audit-public-release.mjs --tracked
```

This audits only tracked files selected by the public manifest. During
pre-commit preparation, include non-ignored untracked candidates:

```powershell
node scripts/audit-public-release.mjs --working-tree
```

After creating a separate export directory, audit every file in that directory.
This mode also rejects files not present in the public manifest:

```powershell
node scripts/audit-public-release.mjs --directory <public-export-directory>
```

For a private-repository risk inventory, `--all-tracked` scans all tracked
files and is expected to fail while private evidence remains in this repository.
The script reports only rule IDs, relative paths, and line numbers; it never
prints matched content.

The audit rejects environment/key files, generated directories, private-key
headers, common token literals, pairing URIs, personal absolute paths, real
`workers.dev` endpoints, and account-like email addresses. Deterministic test
fixtures under test directories may use fictional Windows paths and
`example.workers.dev`.

Binary files are counted but not content-decoded. Their origin and
redistribution rights remain a manual gate.

## Asset provenance resolution

The owner authorized public distribution of the completed `zhima-3` v2
package created from owner-supplied reference material. The public tree records
its CC BY 4.0 attribution locally, includes only `pet.json` and the validated
atlas, and excludes the private source photograph and generation intermediates.
The derived application icon shares that asset license.

The private Clawd reference sound is not present. The public snapshot replaces
it with a new two-tone synthesized MP3 and records CC0 terms. The current public
runtime screenshots were supplied by the project owner for publication and are
not covered by the MIT source license. The Gradle wrapper remains under
Gradle's upstream Apache-2.0 terms. See
[`ASSET-LICENSES.md`](../ASSET-LICENSES.md).

## Publication gates

For this snapshot the following gates were completed:

- public documentation no longer depends on private workspace rules, evidence,
  or machine-specific SDK paths;
- source/documentation use MIT and every shipped binary asset has a recorded
  provenance boundary;
- the mirror has fresh Git history and no private repository objects;
- desktop, Android, relay, Git diff, dependency audit, and directory audit were
  run from the actual public tree;
- remote creation and push were separately authorized.

Future additions must repeat the same audit. Binary content is not decoded by
the scanner, so new images, sounds, archives, wrappers, and executable artifacts
always require a separate provenance review.
