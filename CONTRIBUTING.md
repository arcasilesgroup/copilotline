# Contributing to copilotline

Thanks for thinking about contributing. This is a small, opinionated project:
simple, well-tested, and safe by default.

## Ground rules

- **Small modules.** One cohesive concept per file.
- **Tests first.** Every behavior change should land with a test that fails
  without the change.
- **Pure where possible.** Side effects such as filesystem access, child
  processes, and network calls stay isolated behind small functions.
- **No silent sensitive data.** Do not log tokens, raw Copilot payloads, local
  settings files, or full cache contents.
- **No dependencies without a reason.** Every dependency is future maintenance
  and security surface.

## Local setup

You need [Bun](https://bun.com) and Node.js 18 or newer.

```bash
git clone https://github.com/arcasilesgroup/copilotline
cd copilotline
bun install
bun test
bun run lint
```

## Building

```bash
# Bundled JS for npm
bun run build

# Self-contained binary for the current platform
bun run build:binary
```

## Testing locally

Pipe a fixture into the CLI:

```bash
echo '{"model":{"display_name":"gpt-5.5"},"context_window":{"current_context_used_percentage":8},"cwd":"."}' \
  | bun src/cli.ts render
```

Or link the package globally and let Copilot CLI drive it:

```bash
bun link
copilotline install
copilotline doctor
copilotline uninstall
```

## Pull request checklist

Before opening a PR:

- [ ] `bun test` passes locally
- [ ] `bun run lint` is clean
- [ ] `bun run build` succeeds
- [ ] `bun audit` has no actionable production findings
- [ ] Relevant docs are updated
- [ ] No token, raw payload, local settings, or private path is committed

## Reporting bugs

Use the bug template in `.github/ISSUE_TEMPLATE/bug_report.md`.

Please include:

- OS and architecture
- Node and Bun versions
- GitHub Copilot CLI version
- Terminal and shell
- Minimal stdin JSON, with sensitive data removed
- Expected output and actual output, ANSI stripped if possible

## Reporting security issues

Do not open a public issue. See [SECURITY.md](./SECURITY.md).

## Code of conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). Be kind.
