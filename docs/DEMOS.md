# Regenerating the README demos

The two README demo GIFs are generated from the **real `copilotline` CLI
output** with [charmbracelet VHS](https://github.com/charmbracelet/vhs), so they
can never silently drift from shipped behavior:

- `docs/demo-statusline.gif` — the full statusline ribbon (the real
  `dist/cli.js render` against an offline, public-safe usage-cache fixture).
- `docs/demo-cli.gif` — a `copilotline doctor` reveal (the real
  `dist/cli.js doctor`) in a fully isolated, anonymized environment.

The committed GIFs are the source of truth between regenerations. Regeneration
is a manual maintainer step; CI does not render the demos (VHS needs a TTY plus
`ffmpeg`).

## What appears on screen

The tapes deliberately hide all of the demo plumbing so the GIFs read like the
installed experience, not the fixture wiring. Every tape moves the offline
fixture seeding, the throwaway git repo, the curated `PATH`, the `copilot` stub,
the anonymous temp dirs, **and a `copilotline` shell function** into a `Hide` …
`Show` block at the top. The `copilotline` function maps the clean command onto
the real `node dist/cli.js …` invocation with the demo-only env vars
(`COPILOTLINE_ACCOUNT=0`, `COPILOTLINE_CACHE_DIR`, etc.) hidden off screen.

After the `Show`, the only text typed on screen is the clean command:

- `docs/demo-statusline.gif` → `echo "$PAYLOAD" | copilotline render`
  (`$PAYLOAD` is the public-safe status payload, loaded off screen).
- `docs/demo-cli.gif` → `copilotline doctor`.

Because `copilotline` is a **shell function** (not a file on `PATH`), the
`doctor` subprocess never sees it on `PATH`, so the report honestly shows the
freshly-installed "copilotline command not found on PATH" line while the typed
command still reads exactly like the installed experience.

## Install the tooling

```bash
# macOS
brew install vhs ffmpeg

# Linux: see https://github.com/charmbracelet/vhs#installation
```

`vhs` also needs `ttyd` on the `PATH`; `brew install vhs` pulls it in.

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

## How the tapes stay PII-free

Both tapes use **public-safe sample values only** and never touch the network,
a GitHub token, or a real account:

- `docs/demo-statusline.tape` seeds a fabricated usage-cache fixture
  (`docs/fixtures/usage-cache.json`, stamped with a fresh timestamp by
  `docs/fixtures/seed-demo-cache.mjs`) into a temporary cache dir. The hidden
  `copilotline` function renders with `COPILOTLINE_ACCOUNT=0` and a
  `COPILOTLINE_CACHE_DIR` pointed at the seeded cache, so the credits segment
  shows offline with no network and no token. The directory/branch segment comes
  from a throwaway `git` repo created under a fixed temp path.
- `docs/demo-cli.tape` runs `doctor` through the hidden `copilotline` function
  with `COPILOTLINE_ACCOUNT=0`, `COPILOTLINE_USAGE=0`, an anonymous temporary
  `COPILOT_HOME`/cache dir, and a curated `PATH` that supplies a public-safe
  `copilot` stub (`docs/fixtures/copilot-shim.sh`). No real username, token,
  account, or machine-specific path appears in the output.

**Rule:** never paste real tokens, raw Copilot captures, usernames, or private
repository paths into a `.tape` script, a fixture, or a rendered GIF. Use
anonymous, fixed temp paths (the tapes use `/tmp/copilotline-demo-*`).

## When to regenerate

Regenerate the GIFs whenever the **visible output changes**:

- the statusline ribbon changes (a segment is added/removed/reformatted) →
  regenerate `docs/demo-statusline.gif`.
- the `copilotline doctor` report changes (a section, line, or label) →
  regenerate `docs/demo-cli.gif`.

There is no need to regenerate for changes that do not alter rendered output.
