#!/usr/bin/env bash
# Regenerate docs/screenshot.png — a faithful, static, PII-free card of the
# copilotline statusline as it looks when installed in GitHub Copilot CLI.
#
# Method (robust + emoji-faithful):
#   1. Render the REAL `copilotline render` output in a fully isolated,
#      fabricated `octocat` environment (docs/fixtures/seed-demo-harness.mjs) —
#      no token, no network, no host account. This runs OUTSIDE VHS so it never
#      races/falls back to the real account.
#   2. VHS only `cat`s that static ANSI (its renderer draws the emoji/glyphs
#      faithfully — freeze renders them as tofu, so VHS is required).
#   3. ImageMagick trims to the ribbon, adds uniform padding, and rounds the
#      corners (transparent outside) → the clean card.
#
# Requires: node, git, vhs, ImageMagick (`magick`). Usage: bash docs/fixtures/make-screenshot.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DEMO="$(mktemp -d "${TMPDIR:-/tmp}/cl-screenshot.XXXXXX")"
trap 'rm -r "$DEMO" 2>/dev/null || true' EXIT

# 1. Build the bundle + the isolated, fabricated-octocat harness, then render.
( cd "$REPO" && bun run build >/dev/null 2>&1 )
node "$REPO/docs/fixtures/seed-demo-harness.mjs" "$REPO" "$DEMO" >/dev/null
git -C "$DEMO/work/copilotline" init -q -b main
git -C "$DEMO/work/copilotline" -c user.email=demo@example.com -c user.name=demo \
    commit -q --allow-empty -m init
cd "$DEMO/work/copilotline"
export PATH="$DEMO/bin:$PATH" COPILOT_HOME="$DEMO/copilot" \
       COPILOTLINE_CACHE_DIR="$DEMO/cache" COPILOTLINE_VSCODE_STATE_DB="$DEMO/nope"
RIBBON="$DEMO/ribbon.ansi"
cat "$DEMO/payload.json" | copilotline render > "$RIBBON"
# Strip the trailing newline and hide the cursor, so neither a blank line nor a
# cursor block is captured below the ribbon.
printf '%s\033[?25l' "$(cat "$RIBBON")" > "$RIBBON.tmp" && mv "$RIBBON.tmp" "$RIBBON"

# PII guard: the card must show the fabricated octocat account and nothing real.
grep -q "octocat" "$RIBBON" || { echo "FAIL: ribbon missing octocat (render fell back?)"; exit 1; }
if grep -qiE "soydachi|/Users/|/home/|chat" "$RIBBON"; then
  echo "FAIL: real account/path leaked into the ribbon"; exit 1
fi

# 2. VHS renders only the static ANSI (no harness, no render → no race).
TAPE="$DEMO/sc.tape"
cat > "$TAPE" <<EOF
Output "$DEMO/sc.gif"
Set Shell "bash"
Set FontSize 18
Set Width 1800
Set Height 120
Set Padding 10
Set Theme "Catppuccin Mocha"
Hide
Type "export PS1=''" Enter
Type "export PROMPT_COMMAND='cat $RIBBON'" Enter
Type "clear" Enter Sleep 400ms
Show
Sleep 1000ms
EOF
vhs "$TAPE" >/dev/null 2>&1

# 3. Trim to the ribbon, pad uniformly, round the corners.
FRAME="$DEMO/frame.png"
magick "$DEMO/sc.gif" -coalesce -delete 0--2 "$FRAME"
BG="$(magick "$FRAME" -format '%[pixel:p{5,5}]' info:)"
magick "$FRAME" -trim +repage -bordercolor "$BG" -border 34 "$DEMO/card.png"
W="$(magick "$DEMO/card.png" -format "%w" info:)"
H="$(magick "$DEMO/card.png" -format "%h" info:)"
magick "$DEMO/card.png" -alpha set -background none \
  \( -size "${W}x${H}" xc:none -fill white \
     -draw "roundrectangle 0,0,$((W-1)),$((H-1)),16,16" \) \
  -compose DstIn -composite "$REPO/docs/screenshot.png"

echo "wrote docs/screenshot.png ($(magick identify -format '%wx%h' "$REPO/docs/screenshot.png"))"
