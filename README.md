# copilotline

[![npm version](https://img.shields.io/npm/v/@arcasilesgroup/copilotline.svg)](https://www.npmjs.com/package/@arcasilesgroup/copilotline)
[![CI](https://github.com/arcasilesgroup/copilotline/actions/workflows/ci.yml/badge.svg)](https://github.com/arcasilesgroup/copilotline/actions/workflows/ci.yml)
[![CodeQL](https://github.com/arcasilesgroup/copilotline/actions/workflows/codeql.yml/badge.svg)](https://github.com/arcasilesgroup/copilotline/actions/workflows/codeql.yml)
[![Security](https://github.com/arcasilesgroup/copilotline/actions/workflows/security.yml/badge.svg)](https://github.com/arcasilesgroup/copilotline/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A statusline companion for **GitHub Copilot CLI**: it reads the Copilot status
JSON on stdin and prints a compact, color status line on stdout, so the host
`copilot` binary shows your model, context usage, Git state, session time, and
Copilot quota right in its footer.

![copilotline statusline demo](https://raw.githubusercontent.com/arcasilesgroup/copilotline/main/docs/demo-statusline.gif)

The ribbon renders model and reasoning effort, context usage with color
thresholds, the current directory and Git branch/dirty/worktree markers,
session duration, and a best-effort Copilot usage/quota segment:

```text
gpt-5.5 · xhigh │ ✍️  47% │ copilotline (main) │ ⏱ 2h27m │ 💸 octocat credits ●○○○○○○○ 13% 195/1.5k ⟳ Jul 1 00:00 UTC
```

## See it in 60 seconds

No GitHub Copilot CLI, no `gh` login, no install — just pipe a sample payload
through `copilotline` and watch it render. `COPILOTLINE_USAGE=0` skips the quota
lookup so the trial needs nothing but Node 18+:

```bash
echo '{"model":{"display_name":"gpt-5.5","reasoning":{"effort":"xhigh"}},"context_window":{"current_context_used_percentage":47},"cwd":"."}' \
  | COPILOTLINE_USAGE=0 npx @arcasilesgroup/copilotline render
```

If you have a local clone built (`bun run build`), drive the built binary
instead:

```bash
echo '{"model":{"display_name":"gpt-5.5","reasoning":{"effort":"xhigh"}},"context_window":{"current_context_used_percentage":47},"cwd":"."}' \
  | COPILOTLINE_USAGE=0 node dist/cli.js render
```

You should see a single status line — exactly what Copilot CLI pipes into
`copilotline` on every prompt once it is wired up.

## Install

### npm (global)

```bash
npm install -g @arcasilesgroup/copilotline
copilotline install
```

### npx (zero install)

Run any command without installing it globally:

```bash
npx @arcasilesgroup/copilotline doctor
```

### macOS or Linux release binary

```bash
curl -fsSL https://raw.githubusercontent.com/arcasilesgroup/copilotline/main/scripts/install.sh | bash
```

The installer downloads the matching release asset, verifies its `.sha256`
sidecar, installs it to `~/.local/bin` by default, and runs `copilotline
install`. Make sure `~/.local/bin` is on your `PATH` (add `export
PATH="$HOME/.local/bin:$PATH"` to your shell profile if it is not).

Useful installer environment variables:

```bash
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

## Prerequisites

- **GitHub Copilot CLI** — `copilotline` is a companion for the `copilot`
  binary's `statusLine.command` hook, so install GitHub Copilot CLI first. The
  60-second trial above works without it, but the live statusline needs Copilot
  CLI as the host.
- **Node.js ≥ 18** — required by the npm package and the `npx` path
  (`engines.node >= 18`).
- **`gh auth login`** — only needed for the Copilot **quota** segment. Without
  an authenticated GitHub account the rest of the statusline still renders;
  only the `💸` usage segment is hidden.
- **`~/.local/bin` on `PATH`** — only relevant to the curl-pipe installer, which
  installs there by default.

## Configure GitHub Copilot CLI

Run:

```bash
copilotline install
```

It writes the absolute executable path to `~/.copilot/settings.json` (or
`$COPILOT_HOME/settings.json`):

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

`install` and `uninstall` edit `settings.json` **surgically** — they preserve
JSONC comments and trailing commas. If the file cannot be edited in place,
`copilotline` writes a `.bak` backup, prints a warning, and then rewrites the
file.

To remove the integration:

```bash
copilotline uninstall
```

## Commands

```text
copilotline render                 Read Copilot status JSON from stdin and emit a status line
copilotline render --json          Emit normalized JSON instead of text
copilotline refresh                Fetch and cache Copilot usage from GitHub
copilotline refresh --json         Emit cached usage as JSON after refresh
copilotline account                Configure the Copilot account interactively
copilotline account --json         Emit account detection details as JSON
copilotline account --auto         Follow the active Copilot account
copilotline account --set <login>  Pin quota lookup to a GitHub login
copilotline install                Wire copilotline into ~/.copilot/settings.json
copilotline uninstall              Remove statusLine from ~/.copilot/settings.json
copilotline doctor                 Run read-only diagnostics
copilotline doctor --json          Emit structured diagnostic JSON
copilotline --help                 Show help
copilotline --version              Show version
```

When stdin is piped from Copilot CLI, bare `copilotline` behaves like
`copilotline render`. When you run `copilotline` directly in a terminal, it
shows help.

> `copilotline accounts` and `copilotline use auto|<login>` remain as legacy
> aliases of `account`; prefer the canonical `account` command above.

![copilotline doctor demo](https://raw.githubusercontent.com/arcasilesgroup/copilotline/main/docs/demo-cli.gif)

## Usage and quota

`copilotline` can show Copilot usage. As of 2026-06-01 GitHub bills Copilot by
**token-based AI credits** rather than premium requests, so the segment adapts to
whatever the account is metered in:

```text
💸 octocat credits ●○○○○○○○ 13% 195/1.5k ⟳ Jul 1 00:00 UTC
```

The displayed unit is derived from the data GitHub returns: `credits` or `tokens`
for token-billed accounts, or the legacy `premium` request count for accounts
still on the request model. When GitHub reports usage but no allowance, the
segment shows a used-only reading (for example `420 used`) rather than inventing a
denominator.

Usage is fetched from GitHub's internal Copilot user endpoint:
`GET https://api.github.com/copilot_internal/user`.

The renderer keys on the response *shape*, not on fixed field names: a
credit/token snapshot wins over the legacy `quota_snapshots.premium_models` /
`premium_interactions` request counts, and unknown snapshot keys are still
parsed. Because this endpoint is internal and GitHub has not documented the
token-era field names, the quota segment is best-effort and degrades to the last
cached value (then to nothing) rather than showing a wrong number. Run
`copilotline doctor` to see which billing unit the cached response used.

Set the displayed unit with the `usage.units` config key (`credit` | `token` |
`usd`, default `credit`) or the `COPILOTLINE_USAGE_UNITS` environment variable;
`usage.units: usd` shows GitHub-reported cost when available (never an estimate),
and `usage.showCost: true` appends a secondary `≈ $x.xx` clause.

### Multi-account behavior

On machines with multiple GitHub accounts, `copilotline` follows the active
Copilot account instead of blindly using the active `gh` account. It detects the
selected account from:

1. Copilot status payload account fields, when present
2. `~/.copilot/config.json`
3. VS Code global Copilot account metadata
4. GitHub CLI, only when no Copilot-specific account is detected

Quota is strict per account. If Copilot is using `work-account` but only
`personal-account` is authenticated in `gh`, `copilotline` hides the quota
segment and reports the mismatch in `copilotline doctor` / `copilotline
account`. It does not show another account's usage as a fallback.

Inspect account detection:

```bash
copilotline account
copilotline account --json
```

Use the default system-synced mode:

```bash
copilotline account --auto
```

Pin to a specific login only when you intentionally want to override system
detection:

```bash
copilotline account --set work-account
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

Choose the displayed usage unit (`credit` | `token` | `usd`, default `credit`):

```bash
COPILOTLINE_USAGE_UNITS=usd copilotline render
```

The same setting lives in the config file under `usage.units`; `usage.showCost:
true` appends a secondary `≈ $x.xx` clause when GitHub reports a dollar cost. The
environment variable overrides the config file.

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
- Account detection reads Copilot/VS Code account metadata only. It does not
  read VS Code secret storage values.
- The usage cache stores quota metadata only — never tokens or raw Copilot CLI
  payloads.
- Release binaries are accompanied by `.sha256` files and the installer
  verifies them before installing.
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

Run `copilotline install` again. It writes the absolute path, so Copilot CLI
does not depend on your shell `PATH`.

### Usage quota is missing

Run:

```bash
copilotline refresh
```

If that fails, authenticate with GitHub CLI:

```bash
gh auth login
```

If you have multiple accounts, run `copilotline account` first. The token must
belong to the selected Copilot login. You can also set
`COPILOTLINE_GITHUB_TOKEN_<NORMALIZED_LOGIN>` for that account.

### Wrong GitHub account is shown

Run:

```bash
copilotline account
copilotline account --auto
```

`--auto` follows the active Copilot account from Copilot CLI/VS Code. If you pin
a manual account with `copilotline account --set <login>`, `doctor` warns when
it differs from the system Copilot account.

### Emoji spacing looks different across terminals

The context segment uses the hand emoji `✍️`. Terminal.app, Ghostty, iTerm2, and
font choices can render emoji width differently. The statusline keeps spacing
minimal, but final alignment depends on the terminal font stack.

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

The README demo GIFs are generated with [charmbracelet VHS](https://github.com/charmbracelet/vhs)
from the real CLI output. See [docs/DEMOS.md](docs/DEMOS.md) to regenerate them.

## Release

1. Update `package.json`, `src/version.ts`, and `CHANGELOG.md`.
2. Open a pull request and wait for CI/security checks.
3. Create a GitHub release tagged as `vX.Y.Z`.
4. The release workflow publishes npm with provenance and uploads binaries plus
   SHA256 sidecars.

## License

MIT
