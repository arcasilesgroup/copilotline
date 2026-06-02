#!/usr/bin/env bash
# One-shot shell bootstrap for the install-wizard VHS demo
# (docs/demo-install.tape). Parallels seed-demo-shell.sh, but seeds THREE
# fabricated Copilot accounts so the visible `copilotline install` shows the
# real first-run "Choose quota account" picker with multiple options.
#
# Why this exists: VHS drives an interactive bash through a PTY and types
# keystrokes faster than the shell consumes a command's output, so doing the
# multi-step setup inside the tape intermittently corrupts a line. This script
# (run non-interactively, off screen) does ALL the heavy setup against an
# isolated env, then WRITES the shell statements the *visible* session must
# inherit (cd + the isolated env exports) to <demoRoot>/env.sh and prints a
# SETUPDONE sentinel. The tape then sources env.sh and types only the single
# visible `copilotline install` line plus the picker selection.
#
# Everything stays public-safe, offline, and PII-free: see
# seed-install-harness.mjs for the fabricated octocat/monalisa/hubot accounts.
# The per-login tokens are the demo convention `demo-<login>`, which the
# docs/fixtures/github-user-mock.mjs preload (invoked by the copilotline shim)
# verifies offline so the picker shows "token ok". No real token, no network.
#
# Usage: bash docs/fixtures/seed-install-shell.sh <repoRoot> <demoRoot>
set -euo pipefail

REPO="${1:?usage: seed-install-shell.sh <repoRoot> <demoRoot>}"
DEMO="${2:?usage: seed-install-shell.sh <repoRoot> <demoRoot>}"

# Fresh demo root.
rm -r "$DEMO" 2>/dev/null || true
mkdir -p "$DEMO"

# Build the entire anonymized, offline harness (cli.js copy, copilotline/gh
# shims, fabricated octocat config + VS Code state DB with monalisa/hubot).
node "$REPO/docs/fixtures/seed-install-harness.mjs" "$REPO" "$DEMO" >/dev/null

# The isolated env: the shim/stubs win on PATH while coreutils stay available;
# COPILOT_HOME + the VS Code state DB + the config dir keep everything offline,
# deterministic, and PII-free. The per-login tokens make each account verify
# "token ok" through the offline /user mock the shim preloads. Capture the
# pristine PATH first so env.sh prepends $DEMO/bin exactly once on re-source.
BASE_PATH="$PATH"

# Sanity: detection must list exactly the three fabricated accounts (octocat,
# monalisa, hubot), all with token ok, and no host account. If seeding is
# incomplete this fails loud so the demo can never leak a real account.
ACCOUNTS_JSON="$(
  PATH="$DEMO/bin:$BASE_PATH" \
  COPILOT_HOME="$DEMO/copilot" \
  COPILOTLINE_VSCODE_STATE_DB="$DEMO/vscode/state.vscdb" \
  COPILOTLINE_CONFIG_DIR="$DEMO/config" \
  COPILOTLINE_GITHUB_TOKEN_OCTOCAT="demo-octocat" \
  COPILOTLINE_GITHUB_TOKEN_MONALISA="demo-monalisa" \
  COPILOTLINE_GITHUB_TOKEN_HUBOT="demo-hubot" \
  copilotline account --json
)"
case "$ACCOUNTS_JSON" in
  *octocat*monalisa*hubot* | *octocat*hubot*monalisa*) : ;;
  *) echo "FAIL: install demo did not detect octocat+monalisa+hubot" >&2 ; exit 1 ;;
esac
case "$ACCOUNTS_JSON" in
  *'"available": false'*) echo "FAIL: a fabricated account is not token-ok offline" >&2 ; exit 1 ;;
  *) : ;;
esac

# Write the statements the visible session must inherit to env.sh. Single-quote-
# escape every value so the later `source` is injection-safe and exact.
q() { printf "'%s'" "${1//\'/\'\\\'\'}"; }
{
  printf 'cd %s\n' "$(q "$DEMO/work")"
  printf 'export PATH=%s COPILOT_HOME=%s COPILOTLINE_VSCODE_STATE_DB=%s COPILOTLINE_CONFIG_DIR=%s\n' \
    "$(q "$DEMO/bin:$BASE_PATH")" "$(q "$DEMO/copilot")" "$(q "$DEMO/vscode/state.vscdb")" "$(q "$DEMO/config")"
  printf 'export COPILOTLINE_GITHUB_TOKEN_OCTOCAT=%s COPILOTLINE_GITHUB_TOKEN_MONALISA=%s COPILOTLINE_GITHUB_TOKEN_HUBOT=%s\n' \
    "$(q "demo-octocat")" "$(q "demo-monalisa")" "$(q "demo-hubot")"
} > "$DEMO/env.sh"

# Sentinel for the tape's Wait: proves setup finished and the three accounts
# were detected.
echo "SETUPDONE=3"
