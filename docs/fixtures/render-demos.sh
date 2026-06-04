#!/usr/bin/env bash
# Regenerate the three README demo GIFs (docs/demo-statusline.gif,
# docs/demo-cli.gif, and docs/demo-install.gif) from the real `copilotline`
# CLI output.
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

render_install() {
  local demo="/tmp/copilotline-demo-install"
  # Seed THREE fabricated accounts (octocat/monalisa/hubot) OUTSIDE VHS.
  CL_DEMO="$demo" bash "$REPO/docs/fixtures/seed-install-shell.sh" "$REPO" "$demo" >/dev/null
  # Render with vhs's CWD set to the isolated root so the tape's relative
  # `Output "raw-install.gif"` lands under /tmp (the tape path is absolute so it
  # resolves regardless of CWD). The tape sources $CL_DEMO/env.sh (absolute).
  ( cd "$demo" && CL_DEMO="$demo" vhs "$REPO/docs/demo-install.tape" )

  # Pixel-tight canvas. The final (held) animation frame carries the maximum
  # content (the full picker + the selection confirmation), so its trim
  # bounding box bounds every other frame. Derive ONE crop geometry from that
  # frame and apply it uniformly to ALL frames so the animation stays aligned;
  # then re-pad with a uniform ~24px border. Trimming each frame independently
  # would yield per-frame sizes and a jittering canvas, so we crop to a single
  # shared box instead.
  local raw="$demo/raw-install.gif"
  local bg frame box geom border=24
  frame="$demo/final-frame.png"
  magick "$raw" -coalesce -delete 0--2 "$frame"
  bg="$(magick "$frame" -format '%[pixel:p{2,2}]' info:)"

  # Trim box of the final frame: WxH+X+Y of the content region.
  box="$(magick "$frame" -bordercolor "$bg" -border 1 -format '%@' info:)"
  # %@ is WxH+X+Y; the +1 border shifted X/Y by 1, so it cancels with the
  # added border — use the box as-is against the bordered image for the crop.
  geom="$box"

  # Build the final tight, animated GIF: crop every frame to the shared box,
  # then add a uniform border on a matching background.
  magick "$raw" -coalesce \
    -bordercolor "$bg" -border 1 \
    -crop "$geom" +repage \
    -bordercolor "$bg" -border "$border" +repage \
    -layers OptimizePlus \
    "$REPO/docs/demo-install.gif"

  rm -r "$demo" 2>/dev/null || true
}

render_one "docs/demo-statusline.tape" "/tmp/copilotline-demo-statusline"
render_one "docs/demo-cli.tape" "/tmp/copilotline-demo-cli"
render_install

echo "wrote docs/demo-statusline.gif, docs/demo-cli.gif, and docs/demo-install.gif"
