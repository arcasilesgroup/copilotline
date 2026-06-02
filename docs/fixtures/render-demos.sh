#!/usr/bin/env bash
# Regenerate the two README demo GIFs (docs/demo-statusline.gif and
# docs/demo-cli.gif) from the real `copilotline` CLI output.
#
# Why a wrapper instead of bare `vhs docs/demo-*.tape`: VHS drives an interactive
# bash through a PTY and types keystrokes faster than the shell consumes a
# command's output. Doing the multi-step demo setup *inside* the tape (many
# `Type ... Enter` lines, or one long line) intermittently corrupts the typed
# line; when that corrupts the payload assignment, `copilotline render` receives
# empty stdin, falls back to the model "Copilot", and reads the REAL host Copilot
# account -- a PII leak. This wrapper does ALL setup OUTSIDE VHS (deterministic
# shell, no PTY race), exports the demo root as $CL_DEMO, and the tape then types
# only ONE short fixed line (`source $CL_DEMO/env.sh`) plus the single visible
# command. VHS inherits the parent environment, so $CL_DEMO reaches the tape.
#
# Each demo gets its own isolated root so the two renders never collide.
# Everything is public-safe, offline, and PII-free: seed-demo-shell.sh assembles
# the fabricated `octocat` account, the offline credits cache, and the payload.
#
# Requires: node, git, vhs, ImageMagick (`magick`). Run from the repo root after
# the bundle exists (this script builds it):
#   bash docs/fixtures/render-demos.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"

# Build the bundle so the tapes drive the current dist/cli.js.
bun run build >/dev/null

render_one() {
  local tape="$1" demo="$2"
  # Build the entire anonymized, offline harness OUTSIDE VHS and write env.sh.
  CL_DEMO="$demo" bash "$REPO/docs/fixtures/seed-demo-shell.sh" "$REPO" "$demo" >/dev/null
  # Render the tape; it reads $CL_DEMO (inherited) and sources $CL_DEMO/env.sh.
  CL_DEMO="$demo" vhs "$tape"
  # Teardown the isolated root (it lives only under /tmp).
  rm -r "$demo" 2>/dev/null || true
}

render_one "docs/demo-statusline.tape" "/tmp/copilotline-demo-statusline"
render_one "docs/demo-cli.tape" "/tmp/copilotline-demo-cli"

echo "wrote docs/demo-statusline.gif and docs/demo-cli.gif"
