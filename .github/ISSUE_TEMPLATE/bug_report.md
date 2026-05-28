---
name: Bug report
about: Something is wrong with copilotline
title: "[bug] "
labels: bug
assignees: ""
---

## Summary

<!-- One-sentence description of what is broken. -->

## Reproduction

Minimal stdin JSON that reproduces the issue:

```json
{
  "model": { "display_name": "gpt-5.5" },
  "cwd": "/some/path"
}
```

Command used:

```bash
echo '<the JSON above>' | copilotline render
```

## Expected output

<!-- Paste the line you expected, ANSI stripped if possible. -->

## Actual output

<!-- Paste what you got, ANSI stripped if possible. -->

## Environment

- copilotline version: <!-- `copilotline --version` -->
- GitHub Copilot CLI version: <!-- `copilot --version` -->
- OS and architecture: <!-- macOS 15 arm64, Ubuntu 24.04 x64, Windows 11 x64 -->
- Node.js version: <!-- `node --version` -->
- Bun version: <!-- `bun --version`, if applicable -->
- Terminal / shell: <!-- Terminal.app + zsh, Windows Terminal + PowerShell -->

## Additional context

<!-- Anything else that helps us reproduce or understand the issue. -->
