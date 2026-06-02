# Regenerating the README demos

The two README demo GIFs are generated from the **real `copilotline` CLI
output** with [charmbracelet VHS](https://github.com/charmbracelet/vhs), so they
can never silently drift from shipped behavior:

- `docs/demo-statusline.gif` — `copilotline install` followed by the full
  statusline ribbon (the real `dist/cli.js render` against an offline,
  public-safe usage-cache fixture).
- `docs/demo-cli.gif` — `copilotline install` followed by a `copilotline doctor`
  report that is green for Environment, Configuration, and Account (the real
  `dist/cli.js doctor`) in a fully isolated, anonymized environment.

The committed GIFs are the source of truth between regenerations. Regeneration
is a manual maintainer step; CI does not render the demos (VHS needs a TTY plus
`ffmpeg`).

## What appears on screen

Each GIF shows the freshly-installed experience end to end. After the `Show`,
the only text typed on screen is the clean two-step, installed-experience
sequence:

- `docs/demo-statusline.gif`:
  - `copilotline install` — writes the statusLine entry into the isolated demo
    `settings.json` and prints the success line.
  - `echo "$PAYLOAD" | copilotline render` — emits the full statusline ribbon
    (`$PAYLOAD` is the public-safe status payload, loaded off screen).
- `docs/demo-cli.gif`:
  - `copilotline install` — same install step.
  - `copilotline doctor` — prints the diagnostics report.

All of the demo plumbing is hidden in a `Hide` … `Show` block at the top of each
tape and built by the committed helper `docs/fixtures/seed-demo-harness.mjs`.

## The anonymized, offline, PII-free harness

`docs/fixtures/seed-demo-harness.mjs` builds a throwaway demo root under
`/tmp/copilotline-demo-*` so the demo paths are identical on every machine (no
`$HOME`, no per-user temp hash). It writes:

- **`<demo>/cli.js`** — a copy of the built `dist/cli.js`. The tapes run the CLI
  through this copy, so the `statusLine.command` that `copilotline install`
  records in `settings.json` (derived from `import.meta.url`) is the anonymized
  `/tmp/.../cli.js` path, never the real repository path. `copilotline doctor`
  then reports that command as wired and the configured executable as found.
- **`<demo>/bin/copilotline`** — a shim on `PATH` so
  `isCommandAvailable("copilotline")` is green and the typed command reads
  exactly like the installed binary. For the `install` subcommand the shim
  appends `--no-account`, so install runs **non-interactively** — VHS is a real
  TTY, and without that flag `copilotline install` would open the interactive
  account wizard and the GIF would hang on the prompt.
- **`<demo>/bin/gh`** — a stub that exits non-zero, so `accountFromGitHubCli`
  returns null. No host GitHub account can leak into the demo and there is no
  slow `gh auth status` spawn.
- **`<demo>/bin/copilot`** — the public-safe version stub from
  `docs/fixtures/copilot-shim.sh`, so doctor's `copilot command available` line
  is deterministic and no host Copilot version leaks into the GIF.
- **`<demo>/copilot/config.json`** — a fabricated `lastLoggedInUser` of the
  well-known demo login **`octocat`** on `github.com`, so account detection
  resolves a public-safe login with no PII. This is what turns the doctor
  Account section and the ribbon credits segment green without a real account.
- **`<demo>/cache/github.com-octocat.usage-cache.json`** — an offline credits
  snapshot keyed to `octocat`, mirroring `docs/fixtures/usage-cache.json` and
  stamped with a fresh `fetchedAt` (within TTL). The credits ribbon and the
  doctor billing-unit line render from this fixture with **no network and no
  token**. All values are fabricated and public-safe.
- **`<demo>/payload.json`** — the public-safe status payload (`gpt-5.5` /
  `xhigh`, ~47% context, cwd in a throwaway `copilotline` git repo on branch
  `main`, and a `started_at` ~2h27m ago so the timer segment is deterministic).

The tapes prepend `<demo>/bin` to `PATH` (so the shim and stubs win while
coreutils stay available) and export an isolated `COPILOT_HOME`,
`COPILOTLINE_CACHE_DIR`, and a nonexistent `COPILOTLINE_VSCODE_STATE_DB` so VS
Code account detection is skipped too. Nothing touches the network, a GitHub
token, or a real account.

### Why doctor is green (and what stays an honest WARN)

After `copilotline install`, `copilotline doctor` reports **12 pass, 1 warn, 0
fail**:

- **Environment** — `copilotline`, `copilot`, and `git` on `PATH`, plus Node:
  all green via the shim and stubs.
- **Configuration** — settings file found, `statusLine.command` wired to the
  anonymized `/tmp/.../cli.js`, and `footer.showCustom` enabled: all green,
  because `copilotline install` wrote them this run.
- **Account** — `octocat` detected, quota mode `auto`, AI-credits billing: all
  green from the fabricated config + offline cache.
- The **single honest WARN** is the quota-token check
  (`No quota token available for octocat`). Validating a token requires a live
  GitHub API call, so the demo never fabricates one — that one check stays an
  honest warn rather than faking a credential.

## Install the tooling

```bash
# macOS
brew install vhs ffmpeg

# Linux: see https://github.com/charmbracelet/vhs#installation
```

`vhs` also needs `ttyd` on the `PATH`; `brew install vhs` pulls it in.
ImageMagick 7 (`magick`) is used to verify the canvas fits the content.

## Regenerate

Run from the repository root. Build the bundle first so the tapes drive the
current `dist/cli.js`:

```bash
bun run build
vhs docs/demo-statusline.tape
vhs docs/demo-cli.tape
```

Each tape writes its GIF to `docs/demo-*.gif` (the `Output` path is resolved
relative to the directory you invoke `vhs` from — i.e. the repo root — not the
tape's own directory). The new GIFs replace the committed ones in place; their
filenames are stable so the README `raw.githubusercontent.com` image URLs keep
working.

### Pixel-perfect canvas

Both tapes are sized so the GIF canvas fits the content exactly — no larger and
no smaller — with a small uniform padding (`Set Padding 24`). To re-converge
after an output change, render the tape, extract the final held frame, and trim:

```bash
vhs docs/demo-<name>.tape
magick "docs/demo-<name>.gif" -coalesce -delete 0--2 /tmp/lastframe.png
# robust against the GIF palette's edge dithering:
magick /tmp/lastframe.png -bordercolor "srgb(28,28,44)" -border 1 -fuzz 8% \
  -trim -format "%wx%h+%X+%Y\n" info:
```

Set `Set Width = contentW + 2*Padding` and
`Set Height = contentH + 2*Padding` (add a few px of width safety so the longest
line — the ribbon, or doctor's synthetic-render preview — is not wrapped, and a
few px of height so the vertical border matches). VHS adds a small fixed
vertical margin on top of `Set Padding`, so the trimmed border is uniform per
axis (horizontal ≈ Padding, vertical ≈ Padding + a few px) with nothing clipped.

## How the tapes stay PII-free

Both tapes use **public-safe sample values only** and never touch the network, a
GitHub token, or a real account. Everything is built by
`docs/fixtures/seed-demo-harness.mjs` described above; the fabricated account is
the public demo login `octocat`, the credits come from
`docs/fixtures/usage-cache.json`, and all paths are fixed `/tmp/copilotline-demo-*`
temp paths.

**Rule:** never paste real tokens, raw Copilot captures, usernames, or private
repository paths into a `.tape` script, a fixture, or a rendered GIF. Use
anonymous, fixed temp paths and the public-safe `octocat` login.

## When to regenerate

Regenerate the GIFs whenever the **visible output changes**:

- the statusline ribbon changes (a segment is added/removed/reformatted) →
  regenerate `docs/demo-statusline.gif`.
- the `copilotline install` success line or the `copilotline doctor` report
  changes (a section, line, or label) → regenerate the affected GIF.

There is no need to regenerate for changes that do not alter rendered output.
