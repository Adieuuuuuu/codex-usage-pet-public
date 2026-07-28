# Permissions, network, and deployment

This guide describes environment decisions. It does not authorize an Agent to
change accounts, system settings, secrets, or production services.

## Permission inventory

### Windows desktop

The current app needs ordinary per-user filesystem access to its own data and
read-only access to Codex's local state and pet package directories. It should
not require administrator rights, a Windows service, accessibility, screen
capture, or write access to Codex databases.

Optional actions require a user choice:

- start at login;
- install the NSIS build;
- allow Windows Firewall/network access if prompted;
- trust an unsigned local build.

Pairing secrets are protected with Electron `safeStorage`. On Windows this uses
DPAPI; on macOS it uses Keychain, according to Electron's
[`safeStorage` documentation](https://www.electronjs.org/docs/latest/api/safe-storage).

### Android

The current Android package is designed around:

- Internet;
- network-state observation for reconnecting after the active network changes;
- notification/vibration capability;
- foreground service;
- boot restoration.

Android 13+ asks for notification permission at runtime. The current product
does not need accessibility, display-over-other-apps, location, contacts,
storage, Google account, or Xiaomi account access.

For Xiaomi/HyperOS, the user may need to enable autostart and unrestricted
battery use to obtain the intended reconnect/reboot behavior. These settings
increase background availability and may increase battery use; ask the user
and measure a representative day.

### iPhone blueprint

An iOS port needs notification authorization, APNs registration, Keychain, and
the signing capabilities chosen for development/TestFlight/App Store
distribution. Background notifications are not guaranteed and may be
throttled, per Apple's
[background update documentation](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app).
Do not present background freshness as continuous.

## Connectivity decision

Test in this order:

1. package registry and source host;
2. relay health URL over HTTPS;
3. WebSocket upgrade over WSS;
4. desktop publish;
5. phone receive on Wi-Fi;
6. phone receive on mobile data;
7. network loss and reconnect.

A proxy or VPN is not an architectural requirement. It is an environment
workaround only when direct connectivity fails. Before configuring one:

- identify whether the tool needs HTTP, HTTPS CONNECT, or SOCKS;
- scope it to the current command/process where possible;
- do not persist a system-wide proxy without explicit permission;
- test both desktop and phone paths—one working side does not prove the other;
- avoid logging proxy URLs that contain credentials.

The phone does not need to share the computer's proxy. It only needs a route to
the selected relay. Split-tunnel and per-app VPN rules are common causes of a
desktop publisher working while the phone remains offline.

## Cloudflare route

The checked-in relay uses a Worker and Durable Object. The implementation should
be reviewed and dry-run locally before any account authorization:

```powershell
cd phone\cloudflare
npm.cmd ci
npm.cmd run check
```

Deployment workflow:

1. show the user what account action and resources will be created or changed;
2. obtain explicit authorization;
3. use Wrangler's browser/OAuth flow without exposing tokens to chat or logs;
4. deploy;
5. read back a non-secret health/version response;
6. test a newly generated pairing;
7. verify the relay stores and logs only ciphertext plus bounded routing data;
8. document rollback and deletion separately.

Cloudflare's
[Durable Object WebSocket documentation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
explains long-lived connections and hibernation. Product-specific
authentication, limits, expiry, and ciphertext-only rules still belong to this
repository.

## Self-hosted route

Self-hosting is reasonable when the user needs a particular region, provider,
network route, or operational control. It is not automatically more private:
the server administrator, logs, backups, TLS termination, and monitoring all
become part of the threat model.

Required server contract:

- public HTTPS/WSS with a valid certificate;
- room authentication compatible with the desktop and phone clients;
- no content key and no server-side plaintext;
- bounded body/message sizes, rate limits, and connection limits;
- atomic latest-ciphertext storage with expiry;
- WebSocket subscriber fan-out and reconnect behavior;
- health/version endpoint that reveals no room or account data;
- logs and metrics that never contain secrets, pairing URLs, or ciphertext
  bodies;
- documented patching, certificate renewal, backup, deletion, and rollback.

Add a transport interface and run the same contract suite against Cloudflare and
the self-hosted service. Do not hard-code one production endpoint into source.

## Pairing rules

- Generate room identity and master secret with a cryptographically secure RNG.
- Derive authentication and encryption keys for separate purposes.
- Protect pairing at rest with the platform credential store.
- Make exported pairing short-lived and clear it from the clipboard when safe.
- Show the relay host and room fingerprint before the phone accepts.
- Never ask the user to paste pairing material into an issue or chat.
- Rotation creates a new room/secret and must prevent in-flight old requests
  from replacing new state.
- Unpair locally first and report remote cleanup as a separate action.

## Release gates

| Action | Evidence |
| --- | --- |
| Build | repeatable command and tests |
| Package | artifact name, architecture, signature status, SHA-256 |
| Deploy | authorized account, version read-back, health result |
| Install | target device/OS, permission result, app version |
| Pair | endpoint/fingerprint confirmed without exposing secrets |
| Live use | real update latency, exactly-once alert, task removal |
| Lifecycle | offline/reconnect, process recreation, reboot |
| Device acceptance | layout, notification settings, battery interval |

Do not collapse these into “works.”
