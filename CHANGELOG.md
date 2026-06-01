# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Strict multi-account quota sync with the active Copilot account.
- `copilotline accounts` / `copilotline accounts --json` for account diagnostics.
- `copilotline use auto|<login>` for account mode configuration.
- Per-host/login quota cache metadata so one account's usage is never reused for another.

### Changed

- Quota refresh now verifies tokens against the selected Copilot login and refuses wrong-account tokens instead of falling back silently.
- Quota labels include the login when account metadata is available.
- `install`/`uninstall` now edit `~/.copilot/settings.json` surgically, preserving JSONC comments and trailing commas; previous versions stripped every comment. If the file cannot be edited in place, a `.bak` is written and a warning is printed before a full rewrite.
- The quota reset time is rendered in UTC (with a `UTC` label) instead of the machine's local timezone, so output is deterministic across hosts.

### Removed

- **Breaking:** the `render --capture <path>` flag and its raw-payload write path. Use the documented stdin payload for schema discovery instead.

### Fixed

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
