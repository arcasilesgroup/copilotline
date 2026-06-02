#!/usr/bin/env bash
# One-shot shell bootstrap for the VHS demo tapes (docs/demo-statusline.tape and
# docs/demo-cli.tape).
#
# Why this exists: VHS drives an interactive bash through a PTY and types
# keystrokes faster than the shell consumes a command's output. Splitting the
# demo setup across many `Type ... Enter` lines lets the next command's keys
# interleave with the previous command's still-streaming output and silently
# corrupt the line. When that corrupts the payload assignment, the visible
# `copilotline render` receives empty stdin, falls back to the model "Copilot",
# and reads the REAL host Copilot account -- a PII leak. Collapsing the entire
# setup into ONE short typed line that `eval`s this script's output removes that
# whole class of races: there is no multi-line typing to interleave.
#
# This script (run non-interactively, off screen) does ALL of the heavy setup --
# builds the anonymized offline harness, creates the throwaway git repo, and
# wires settings.json via `copilotline install` -- against the isolated env it
# also assembles. It then WRITES the shell statements the *visible* session must
# inherit (cd + the isolated env exports + PAYLOAD) to <demoRoot>/env.sh, and
# prints a SETUPDONE=<payload-length> sentinel to stdout. The tape then drives
# only two short, quote-free, non-wrapping typed lines (so nothing can be
# corrupted in the PTY):
#
#   REPO=$PWD; DEMO=/tmp/copilotline-demo-...; bash $REPO/docs/fixtures/seed-demo-shell.sh $REPO $DEMO
#   source $DEMO/env.sh           # after Wait gates on the SETUPDONE sentinel
#
# Everything stays public-safe, offline, and PII-free: see seed-demo-harness.mjs
# for the fabricated `octocat` account, offline credits cache, and payload.
#
# Usage: bash docs/fixtures/seed-demo-shell.sh <repoRoot> <demoRoot>
set -euo pipefail

REPO="${1:?usage: seed-demo-shell.sh <repoRoot> <demoRoot>}"
DEMO="${2:?usage: seed-demo-shell.sh <repoRoot> <demoRoot>}"

# Fresh demo root.
rm -r "$DEMO" 2>/dev/null || true
mkdir -p "$DEMO"

# Build the entire anonymized, offline harness (cli.js copy, copilotline/gh/
# copilot shims, fabricated octocat config + offline credits cache, payload).
node "$REPO/docs/fixtures/seed-demo-harness.mjs" "$REPO" "$DEMO" >/dev/null

# Throwaway git repo named 'copilotline' on branch 'main' so the directory +
# branch segment renders as 'copilotline (main)'.
git -C "$DEMO/work/copilotline" init -q -b main
git -C "$DEMO/work/copilotline" -c user.email=demo@example.com -c user.name=demo \
    commit -q --allow-empty -m init

# The isolated env: the shim/stubs win on PATH while coreutils stay available;
# COPILOT_HOME + cache dir + a nonexistent VS Code state DB keep everything
# offline, deterministic, and PII-free. Capture the pristine PATH first so env.sh
# prepends $DEMO/bin exactly once (no doubled entries on re-source).
BASE_PATH="$PATH"
export PATH="$DEMO/bin:$PATH" COPILOT_HOME="$DEMO/copilot" \
       COPILOTLINE_CACHE_DIR="$DEMO/cache" COPILOTLINE_VSCODE_STATE_DB="$DEMO/nope"

# Wire settings.json (non-interactive via the shim's --no-account) so the
# installed credits segment resolves and doctor's Configuration section is green.
copilotline install >/dev/null

# Read the public-safe payload now, so a corrupt-render fallback is impossible.
PAYLOAD="$(cat "$DEMO/payload.json")"

# PII guard: the payload must be the fabricated demo payload, never a real one.
case "$PAYLOAD" in
  *gpt-5.5*) : ;;
  *) echo "FAIL: demo payload missing" >&2 ; exit 1 ;;
esac

# Write the statements the visible session must inherit to env.sh. Single-quote-
# escape every value so the later `source` is injection-safe and exact.
q() { printf "'%s'" "${1//\'/\'\\\'\'}"; }
{
  printf 'cd %s\n' "$(q "$DEMO/work/copilotline")"
  printf 'export PATH=%s COPILOT_HOME=%s COPILOTLINE_CACHE_DIR=%s COPILOTLINE_VSCODE_STATE_DB=%s\n' \
    "$(q "$DEMO/bin:$BASE_PATH")" "$(q "$DEMO/copilot")" "$(q "$DEMO/cache")" "$(q "$DEMO/nope")"
  printf 'PAYLOAD=%s\n' "$(q "$PAYLOAD")"
} > "$DEMO/env.sh"

# Sentinel for the tape's Wait: proves setup finished and the payload is present.
echo "SETUPDONE=${#PAYLOAD}"
