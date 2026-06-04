# copilotline marketing notes

## One-liner

Cross-platform statusline companion for GitHub Copilot CLI.

## Short description

copilotline adds a compact, readable statusline to GitHub Copilot CLI with
model, reasoning effort, context usage, Git state, session duration, and
best-effort Copilot usage and quota visibility (token-based AI credits, tokens,
or legacy premium requests).

## Highlights

- Designed for GitHub Copilot CLI `statusLine.command`
- Works from npm, Node, Bun, or self-contained release binaries
- Shows branch, dirty state, and linked worktree marker
- Reads GitHub Copilot usage/quota metadata (credits, tokens, or premium requests) without caching tokens
- Includes diagnostics through `copilotline doctor`
- Open-source with CI, CodeQL, secret scanning, audit, and npm provenance

## Safety copy

copilotline is a third-party companion. It is not an official GitHub product.
GitHub token values are read only to call GitHub's quota endpoint and are never
logged, cached, or emitted.
