# copilotline

[![npm version](https://img.shields.io/npm/v/@arcasilesgroup/copilotline.svg)](https://www.npmjs.com/package/@arcasilesgroup/copilotline)
[![CI](https://github.com/arcasilesgroup/copilotline/actions/workflows/ci.yml/badge.svg)](https://github.com/arcasilesgroup/copilotline/actions/workflows/ci.yml)
[![CodeQL](https://github.com/arcasilesgroup/copilotline/actions/workflows/codeql.yml/badge.svg)](https://github.com/arcasilesgroup/copilotline/actions/workflows/codeql.yml)
[![Security](https://github.com/arcasilesgroup/copilotline/actions/workflows/security.yml/badge.svg)](https://github.com/arcasilesgroup/copilotline/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Cross-platform statusline companion for GitHub Copilot CLI.

`copilotline` is a third-party tool that plugs into GitHub Copilot CLI's
`statusLine.command` setting. It renders a compact statusline with model,
reasoning effort, context usage, Git state, session duration, and best-effort
premium quota usage.

![copilotline statusline demo](https://raw.githubusercontent.com/arcasilesgroup/copilotline/main/docs/demo-statusline.gif)

## Features

- Copilot CLI statusline renderer for `statusLine.command`
- Direct CLI help when you run `copilotline` in a terminal
- Model and reasoning effort, for example `gpt-5.5 · xhigh`
- Context usage with color thresholds
- Current directory, Git branch, dirty marker, and linked worktree marker
- Session duration
- Best-effort Copilot premium quota display synced to the active Copilot account
- Read-only diagnostics through `copilotline doctor`
- npm package plus self-contained release binaries for macOS, Linux, and Windows

Example output:

```text
gpt-5.5 · xhigh │ ✍️  47% │ copilotline (⎇:main*) │ ⏱ 2h27m │ 💸 copilot-user premium ●●●○○○○○ 48% 143/300 ⟳ Jun 1 02:00
```

## Install

### npm

```bash
npm install -g @arcasilesgroup/copilotline
copilotline install
```

### macOS or Linux release binary

```bash
curl -fsSL https://raw.githubusercontent.com/arcasilesgroup/copilotline/main/scripts/install.sh | bash
```

The installer downloads the matching release asset, verifies its `.sha256`
sidecar, installs it to `~/.local/bin` by default, and runs
`copilotline install`.

Useful installer environment variables:

```bash
COPILOTLINE_VERSION=v0.1.0 bash scripts/install.sh
COPILOTLINE_PREFIX=/usr/local/bin bash scripts/install.sh
COPILOTLINE_NO_WIRE=1 bash scripts/install.sh
```

### Windows

Use npm on Windows:

```powershell
npm install -g @arcasilesgroup/copilotline
copilotline install
```

Release builds also publish `copilotline-windows-x64.exe` for manual installs.

## Configure GitHub Copilot CLI

Run:

```bash
copilotline install
```

It writes the absolute executable path to `~/.copilot/settings.json` or
`$COPILOT_HOME/settings.json`:

```jsonc
{
  "statusLine": {
    "type": "command",
    "command": "/absolute/path/to/copilotline",
    "padding": 1
  },
  "footer": {
    "showCustom": true
  }
}
```

`footer.showCustom` is required by current GitHub Copilot CLI versions for the
custom statusline to be visible.

To remove the integration:

```bash
copilotline uninstall
```

Install and uninstall accept JSONC input settings, but rewrite the settings file
as formatted JSON.

## Commands

```text
copilotline render                      Read Copilot status JSON from stdin and emit a status line
copilotline render --json               Emit normalized JSON instead of text
copilotline render --capture <path>     Save the raw stdin payload for schema discovery
copilotline refresh                     Fetch and cache Copilot usage from GitHub
copilotline refresh --json              Emit cached usage as JSON after refresh
copilotline accounts                    Show detected Copilot/GitHub accounts
copilotline accounts --json             Emit account detection details as JSON
copilotline use auto                    Follow the active Copilot account
copilotline use <login>                 Pin quota lookup to a GitHub login
copilotline install                     Wire copilotline into ~/.copilot/settings.json
copilotline uninstall                   Remove statusLine from ~/.copilot/settings.json
copilotline doctor                      Run read-only diagnostics
copilotline doctor --json               Emit structured diagnostic JSON
copilotline --help                      Show help
copilotline --version                   Show version
```

When stdin is piped from Copilot CLI, bare `copilotline` behaves like
`copilotline render`. When you run `copilotline` directly in a terminal, it shows
help.

![copilotline doctor demo](https://raw.githubusercontent.com/arcasilesgroup/copilotline/main/docs/demo-cli.gif)

## Premium usage and quota

`copilotline` can show Copilot premium usage:

```text
💸 copilot-user premium ●●●○○○○○ 48% 143/300 ⟳ Jun 1 02:00
```

Usage is fetched from GitHub's internal Copilot user endpoint:
`GET https://api.github.com/copilot_internal/user`.

The renderer prefers the newer `quota_snapshots.premium_models` data, which is
aligned with the token-based premium model, and falls back to
`premium_interactions` when GitHub returns the older shape. Because this endpoint
is internal, the quota segment is best-effort and may disappear if GitHub changes
the response.

### Multi-account behavior

On machines with multiple GitHub accounts, `copilotline` follows the active
Copilot account instead of blindly using the active `gh` account. It detects the
selected account from:

1. Copilot status payload account fields, when present
2. `~/.copilot/config.json`
3. VS Code global Copilot account metadata
4. GitHub CLI, only when no Copilot-specific account is detected

Quota is strict per account. If Copilot is using `work-account` but only
`personal-account` is authenticated in `gh`, `copilotline` hides the quota segment and
reports the mismatch in `copilotline doctor` / `copilotline accounts`. It does
not show another account's premium usage as a fallback.

Inspect account detection:

```bash
copilotline accounts
copilotline accounts --json
```

Use the default system-synced mode:

```bash
copilotline use auto
```

Pin to a specific login only when you intentionally want to override system
detection:

```bash
copilotline use work-account
```

If the selected Copilot account is not authenticated in GitHub CLI, add it:

```bash
gh auth login
```

`copilotline` uses `gh auth token --user <login>` so it can read a token for the
selected login without changing your active `gh` account.

Tokens are resolved in this order:

1. `COPILOTLINE_GITHUB_TOKEN_<NORMALIZED_LOGIN>`
2. `COPILOTLINE_GITHUB_TOKEN`, verified to match the selected login
3. `COPILOT_GITHUB_TOKEN`, verified to match the selected login
4. `GH_TOKEN` / `GITHUB_TOKEN`, verified to match the selected login
5. `gh auth token --hostname <host> --user <login>`

The statusline render path reads the local cache and starts a quiet background
refresh when the cache is missing or stale. To populate the cache manually:

```bash
copilotline refresh
```

Disable usage fetching:

```bash
COPILOTLINE_USAGE=0 copilotline render
```

Override the cache directory:

```bash
COPILOTLINE_CACHE_DIR=/tmp/copilotline-cache copilotline refresh
```

Default cache locations:

| OS | Path |
| --- | --- |
| macOS | `~/Library/Caches/copilotline/<host>-<login>.usage-cache.json` |
| Linux | `${XDG_CACHE_HOME:-~/.cache}/copilotline/<host>-<login>.usage-cache.json` |
| Windows | `%LOCALAPPDATA%\copilotline\<host>-<login>.usage-cache.json` |

The cache stores quota metadata only. It never stores GitHub tokens or raw
Copilot CLI payloads.

## Privacy and security

- `copilotline` is not an official GitHub product.
- GitHub tokens are read only to call the Copilot quota endpoint.
- Tokens are never logged, printed, or cached.
- Account detection reads Copilot/VS Code account metadata only. It does not read
  VS Code secret storage values.
- `render --capture <path>` writes the raw JSON payload received from Copilot
  CLI. Treat captured files as potentially sensitive and do not share them
  without review.
- Release binaries are accompanied by `.sha256` files and the installer verifies
  them before installing.
- CI runs tests, typecheck, bundle smoke tests, CodeQL, dependency audit, OSV,
  and gitleaks secret scanning.

See [SECURITY.md](SECURITY.md) for the support policy and threat model.

## Troubleshooting

### Nothing shows in Copilot CLI

Run:

```bash
copilotline doctor
```

Check that `statusLine.command` points to the executable you expect and that
`footer.showCustom` is `true`.

### `copilotline` works in the terminal but not in Copilot CLI

Run `copilotline install` again. It writes the absolute path, so Copilot CLI does
not depend on your shell `PATH`.

### Premium quota is missing

Run:

```bash
copilotline refresh
```

If that fails, authenticate with GitHub CLI:

```bash
gh auth login
```

If you have multiple accounts, run `copilotline accounts` first. The token must
belong to the selected Copilot login. You can also set
`COPILOTLINE_GITHUB_TOKEN_<NORMALIZED_LOGIN>` for that account.

### Wrong GitHub account is shown

Run:

```bash
copilotline accounts
copilotline use auto
```

`auto` follows the active Copilot account from Copilot CLI/VS Code. If you pin a
manual account with `copilotline use <login>`, `doctor` warns when it differs
from the system Copilot account.

### Emoji spacing looks different across terminals

The context segment uses the hand emoji `✍️`. Terminal.app, Ghostty, iTerm2, and
font choices can render emoji width differently. The statusline keeps spacing
minimal, but final alignment depends on the terminal font stack.

### JSONC comments disappeared from settings

`copilotline install` and `copilotline uninstall` can read JSONC settings, but
they currently write plain formatted JSON.

## Development

```bash
bun install
bun test
bun run lint
bun run build
bun run audit
```

Local smoke test:

```bash
echo '{"model":{"display_name":"gpt-5.5","reasoning":{"effort":"xhigh"}},"context_window":{"current_context_used_percentage":8},"cwd":"."}' \
  | COPILOTLINE_USAGE=0 node dist/cli.js render
```

Render README demo GIFs:

```bash
cd docs/remotion
npm install
npm run render:gif:all
```

## Release

1. Update `package.json`, `src/version.ts`, and `CHANGELOG.md`.
2. Open a pull request and wait for CI/security checks.
3. Create a GitHub release tagged as `vX.Y.Z`.
4. The release workflow publishes npm with provenance and uploads binaries plus
   SHA256 sidecars.

## License

MIT
