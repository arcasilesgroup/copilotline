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
- Unlimited premium quota entries now keep reset and overage metadata and avoid misleading `0/0` counters by showing `included` when GitHub does not return a usable entitlement.
- Official AI credit billing now renders as a separate adjacent text-only monthly segment when GitHub billing usage data is available, and falls back to capability-only states such as `credits on` when it is not.

## [0.1.0] - 2026-05-27

### Added

- Initial `copilotline` CLI with `render`, `install`, `uninstall`, `doctor`, and `refresh`.
- GitHub Copilot CLI `statusLine.command` integration.
- Statusline segments for model, reasoning effort, context %, directory, Git branch, dirty flag, linked worktree marker, session duration, agent, and premium usage.
- Local premium usage cache sourced from GitHub Copilot quota metadata.
- JSON output and raw payload capture for schema discovery.
- Tests for rendering, CLI behavior, settings mutation, diagnostics, Git parsing, and quota parsing.
