# Security policy

## Scope

Codex Usage Pet reads local Codex state, protects pairing material, encrypts
phone snapshots on the desktop, and uses a ciphertext-only relay. Security
reports should consider the complete desktop -> relay -> phone chain.

Do not attach prompts, responses, Codex databases, credentials, pairing bundles,
production endpoints, room identifiers, device tokens, private logs, or
unredacted screenshots to a public issue.

## Baseline checks

For the published source snapshot:

- desktop production dependency audit: 0 vulnerabilities with
  `npm audit --omit=dev`;
- relay dependency audit: 0 vulnerabilities;
- public export audit: no secret, endpoint, account, device, or personal-path
  finding in the tracked tree;
- Android pairing/decryption tests cover wrong keys, tampering, replay, and
  malformed input;
- the relay tests enforce authentication before sequence handling and store
  only bounded routing metadata plus ciphertext.

## Build-chain advisory

The locked desktop development tree currently receives 16 high-severity npm
advisories through the `electron-builder` packaging chain. They are not runtime
production dependencies, and npm's suggested automatic remedy is an
incompatible major-version downgrade. This snapshot therefore does not apply
`npm audit fix --force` merely to make the count disappear.

Treat packaging as a privileged build step:

- build only a reviewed commit in a clean environment;
- do not package untrusted Electron config, hooks, pet packages, icons, or
  archives;
- rerun the production audit and complete tests before each release;
- review upstream `electron-builder` advisories and update when a verified,
  compatible fix exists;
- sign public desktop and mobile releases with protected release keys.

The repository's locally built Windows artifacts and Android debug APK are
unsigned/development artifacts. They are verification outputs, not a signed
public release.

## Reporting

Use GitHub's security-reporting channel when available. If only a public issue
is available, report the affected version, component, and safe reproduction
outline without secret values or a weaponized exploit. Coordinate privately
before publishing sensitive details.
