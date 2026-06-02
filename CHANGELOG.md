# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A static statusline screenshot (`docs/screenshot.png`) used as the README hero — a faithful, rounded dark card of the real `copilotline render` ribbon, generated PII-free from the offline `octocat` fixture by `docs/fixtures/make-screenshot.sh`.
- `docs/fixtures/render-demos.sh` + `docs/fixtures/seed-demo-shell.sh`: the demo GIFs now build their entire harness OFF screen (deterministic, non-PTY) and pass the isolated demo root to VHS via `$CL_DEMO`, so the tapes type only one short fixed line plus the visible command. This removes a VHS keystroke-vs-output race that could corrupt the payload assignment and make `render` fall back to the model "Copilot" and the real host Copilot account — a PII leak into the GIF.

### Changed

- README rewritten newcomer-first around the static hero: the hero screenshot sits under the title with a one-line what + why, a "What it shows" section explains each statusline segment, the two demo GIFs are grouped in a "Demo" section, and "Install" is plain-text steps (npm + `copilotline install`, with a note that the first `copilotline install` runs the interactive "Choose quota account" picker). Folded in factual corrections to match the shipped `v0.2.x` CLI: the canonical `account` command (`--auto` / `--set <login>` / `--json`) replaces the `accounts` / `use` alias-as-primary presentation; the JSONC text describes the v0.2.0 surgical edit (comments preserved, `.bak` fallback); the removed `render --capture` flag and the stale `v0.1.0` installer example are gone; and the GitHub Copilot CLI prerequisite, Node ≥18, the `gh auth` quota prerequisite, the `~/.local/bin` PATH note, and an `npx` path are documented.
- Demo pipeline migrated from Remotion to [charmbracelet VHS](https://github.com/charmbracelet/vhs). The README demo GIFs are now generated from the **real CLI output** by `.tape` scripts (`docs/demo-statusline.tape`, `docs/demo-cli.tape`) driving `node dist/cli.js`, with public-safe offline fixtures under `docs/fixtures/` and a regeneration guide at `docs/DEMOS.md`. GIF filenames are unchanged (`docs/demo-statusline.gif`, `docs/demo-cli.gif`).
- The demo GIFs no longer show a synthetic `copilotline install` step: install runs off screen as part of setup, so each GIF shows only the relevant command — `echo "$PAYLOAD" | copilotline render` (statusline) and `copilotline doctor` (diagnostics). The canvases were re-tightened to fit (`1352x128` and `1844x612`).

### Removed

- The README "See it in 60 seconds" raw-JSON `echo … | copilotline render` trial, which newcomers found to be confusing noise. The hero screenshot plus the "What it shows" section convey the same thing without a pasteable JSON blob.
- The `docs/remotion/` project (React + webpack + `@remotion/*`) and its lockfile, eliminating a heavyweight demo toolchain and its recurring transitive-CVE maintenance surface. Replaced by VHS `.tape` scripts (see above).

### Fixed

- **Security/privacy:** `copilotline render` no longer reads or renders the host's Copilot account or quota when stdin is empty or not valid JSON. Previously, empty/garbage stdin collapsed to `{}` and the render path still detected the real Copilot account (reading `~/.copilot/config.json`, VS Code state, and spawning `gh`/`sqlite3`), then rendered that login and its cached quota — a PII leak triggered by piping nothing. Empty/invalid stdin now prints a neutral `copilotline` placeholder (exit 0) with zero host-derived data and performs no account detection or quota read. Invalid JSON additionally emits a single `copilotline: ignoring invalid status JSON on stdin` diagnostic to stderr. `render --json` on empty/invalid stdin now emits a neutral envelope whose `data` field is `null` instead of the host account/quota object. A valid status payload renders the full ribbon exactly as before.

> Note: the npm-page README only refreshes on the next publish; the GitHub-rendered README and the raw-served GIFs update on merge to `main`.

## [0.2.1] - 2026-06-02

### Fixed

- `package.json` `bin` path no longer carries a leading `./` (`dist/cli.js`), which npm silently normalized and warned about on every publish. First release published through the OIDC trusted-publishing pipeline.

## [0.2.0] - 2026-06-01

### Added

- Strict multi-account quota sync with the active Copilot account.
- `copilotline accounts` / `copilotline accounts --json` for account diagnostics.
- `copilotline use auto|<login>` for account mode configuration.
- Per-host/login quota cache metadata so one account's usage is never reused for another.
- Token-based billing support: the quota parser recognizes GitHub AI-credit and token snapshots (by shape, not fixed field names) and the statusline shows `credits`/`tokens`, or a `used`-only reading when no allowance is reported.
- `usage.units` config key (`credit` | `token` | `usd`, default `credit`) and `COPILOTLINE_USAGE_UNITS` environment override, plus `usage.showCost` for a secondary `≈ $x.xx` clause.
- `copilotline doctor` reports which billing unit (credits/tokens/premium requests) the cached upstream response used, so a future GitHub shape change is observable.

### Changed

- **Breaking:** the quota segment now describes GitHub's token-based AI-credit billing (effective 2026-06-01) instead of premium requests. `QuotaSnapshot` gains a required `unit` discriminator (`request` | `credit` | `token`) plus `costUsd` / `creditAllowanceSource`, applied in place with no compatibility shim. The displayed default unit is credits; a cache entry written by an older build (no `unit`) deserializes as `request`, so it keeps rendering as honest legacy data. The cached usage JSON schema changed shape; a stale cache that cannot be read simply triggers a fresh refresh.

- Quota refresh now verifies tokens against the selected Copilot login and refuses wrong-account tokens instead of falling back silently.
- Quota labels include the login when account metadata is available.
- `install`/`uninstall` now edit `~/.copilot/settings.json` surgically, preserving JSONC comments and trailing commas; previous versions stripped every comment. If the file cannot be edited in place, a `.bak` is written and a warning is printed before a full rewrite.
- The quota reset time is rendered in UTC (with a `UTC` label) instead of the machine's local timezone, so output is deterministic across hosts.

### Removed

- **Breaking:** the `render --capture <path>` flag and its raw-payload write path. Use the documented stdin payload for schema discovery instead.

### Fixed

- The context-window percentage now uses Copilot CLI's `current_context_used_percentage` (the value that matches `/context`) instead of the known-buggy `used_percentage` field (github/copilot-cli#1957), and derives window capacity from `displayed_context_limit`/`context_window_size` rather than the cumulative `total_tokens` counter. Previously the statusline showed an inflated, wrong context percentage.
- Free Copilot accounts no longer render a misleading "100% — 0/0" premium bar: a `premium_interactions` snapshot the account holds no allowance for (`has_quota: false` with zero entitlement) is skipped so the statusline reflects a unit the account actually has.
- Quota renders identically from live data and from cache: a single shared parser treats `entitlement: -1` as unlimited and reads the `quota_remaining`/`quotaRemaining` aliases on both paths (previously the cached path showed a garbage bar where live showed ∞).
- The render path resolves the Copilot account once and reads only the cache — no foreground `gh`/`sqlite3` subprocesses on render — and `getGitInfo` issues a single `git` spawn per in-repo render.
- A malformed `config.json` falls back to defaults instead of crashing the render.
- Flag parsing rejects a flag-shaped value, so `--login --host …` no longer swallows `--host` as the login.

### Security

- Token-bearing API requests are restricted to an allowlist (github.com and GHEC `*.ghe.com` tenancy hosts), failing closed to `api.github.com`. A payload-supplied `host` can no longer redirect the GitHub token to an attacker-controlled host.

## [0.1.0] - 2026-05-27

### Added

- Initial `copilotline` CLI with `render`, `install`, `uninstall`, `doctor`, and `refresh`.
- GitHub Copilot CLI `statusLine.command` integration.
- Statusline segments for model, reasoning effort, context %, directory, Git branch, dirty flag, linked worktree marker, session duration, agent, and premium usage.
- Local premium usage cache sourced from GitHub Copilot quota metadata.
- JSON output and raw payload capture for schema discovery.
- Tests for rendering, CLI behavior, settings mutation, diagnostics, Git parsing, and quota parsing.
