# Security policy

## Supported versions

copilotline follows semantic versioning. Security fixes land on the latest
release line only. Older releases are not maintained once a newer compatible
release is available.

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

## Reporting a vulnerability

**Please do not file a public GitHub issue for security problems.**

Use one of the following private channels:

1. GitHub's private vulnerability reporting:
   <https://github.com/arcasilesgroup/copilotline/security/advisories/new>
2. Email `security@arcasilesgroup.com` with subject `copilotline: <short summary>`.

Please include:

- A description of the issue and impact
- Steps to reproduce, ideally with a minimal payload
- Affected version(s) and platform(s)
- Whether you would like to be credited in the advisory

We will acknowledge receipt within **3 working days**, share an initial
assessment within **7 days**, and aim to ship a fix within **30 days** for high
or critical issues.

## Threat model

copilotline is a non-privileged CLI. It is invoked by GitHub Copilot CLI with a
JSON document on stdin and emits ANSI-formatted text on stdout.

Its side effects are:

- Reading and writing `~/.copilot/settings.json` during `install` and `uninstall`
- Reading active account metadata from `~/.copilot/config.json` and VS Code
  global state during account detection
- Reading GitHub tokens from login-scoped `COPILOTLINE_GITHUB_TOKEN_*`,
  `COPILOTLINE_GITHUB_TOKEN`, `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`,
  `GITHUB_TOKEN`, or `gh auth token --user <login>` during `refresh`
- Calling `https://api.github.com/copilot_internal/user` for best-effort quota metadata
- Writing per-account quota cache JSON under the OS cache directory with
  owner-only permissions where supported
- Spawning `git`, `gh`, `sqlite3`, and `copilot` with fixed argv arrays
- Optionally writing a raw stdin capture when the user passes `render --capture`

Security priorities:

1. **Token exposure.** GitHub tokens must never be logged, written to the cache,
   captured, emitted to stdout/stderr, or sent anywhere except GitHub's API.
2. **Raw payload exposure.** `render --capture` is opt-in and may contain local
   project paths or Copilot session metadata. Do not share captures publicly
   without reviewing them first.
3. **Cross-account leakage.** Quota caches are keyed by host/login and tokens are
   verified against the selected Copilot login before quota refresh. `copilotline`
   must not silently show quota for a different GitHub account.
4. **Argument and command injection.** External commands are invoked with fixed
   argv arrays through `spawn` / `spawnSync`, not shell interpolation.
5. **Untrusted JSON.** Unknown stdin and API fields are ignored unless they
   match the tolerant parser shapes. Text reflected to the terminal strips
   control characters.
6. **Denial of service.** Stdin is capped, network calls time out, and refreshes
   are debounced so a statusline render cannot spam the API.
7. **Cache data.** The cache contains only quota metadata, account login/host,
   timestamps, and reset
   dates. It never contains GitHub tokens or raw Copilot stdin payloads.

## Out of scope

- Bugs in GitHub Copilot CLI itself
- Changes to GitHub's internal quota endpoint shape
- Vulnerabilities only reachable by an attacker who already has shell access as
  the same local user
- Hostile user-authored `~/.copilot/settings.json` content
- Secret extraction from VS Code or Copilot CLI credential stores. copilotline
  reads account metadata and uses documented env vars or `gh auth token`.

## Hardening tips for users

- Prefer `gh auth login` over long-lived shell tokens when possible.
- Do not commit captures produced by `copilotline render --capture`.
- Keep Node.js current and use npm packages published with provenance.
