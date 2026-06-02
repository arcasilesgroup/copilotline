# copilotline statusline demo (charmbracelet VHS)
#
# Shows the freshly-installed experience end to end: first `copilotline install`
# (writes the statusLine entry into the isolated demo settings.json), then
# `echo "$PAYLOAD" | copilotline render` driving the REAL copilotline binary to
# emit the full statusline ribbon. Everything runs against a public-safe,
# offline, fully anonymized harness -- no network, no GitHub token, no real
# account. PII-free by construction.
#
# All of the demo plumbing lives in the Hidden block below and is built by the
# committed helper docs/fixtures/seed-demo-harness.mjs (an anonymized demo root
# under /tmp, a copy of the built dist/cli.js at $DEMO/cli.js so the path written
# into settings.json is the anonymized /tmp path, a `copilotline` shim on PATH
# whose `install` runs non-interactively via --no-account, a `gh` stub so no host
# account leaks, the fabricated `octocat` account + offline credits cache, and
# the public-safe payload). After Show, the only text typed on screen is the
# clean, installed-experience sequence:
#
#   copilotline install
#   echo "$PAYLOAD" | copilotline render
#
# Run from the repository root, after `bun run build`:
#   vhs docs/demo-statusline.tape
#
# Output is written to docs/demo-statusline.gif (path is relative to the CWD
# where vhs is invoked, i.e. the repo root).

Output docs/demo-statusline.gif

Require node
Require git

Set Shell "bash"
Set FontSize 18
Set Width 1352
Set Height 144
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 12ms

# --- Hidden setup: build a deterministic, offline, PII-free environment ---
Hide

# Capture the repo root (vhs starts the shell in the invocation CWD).
Type "REPO=$PWD" Enter

# Fixed temp base so the demo path is identical on every machine (no $HOME,
# no per-user temp hash). Anonymous by construction.
Type "DEMO=/tmp/copilotline-demo-statusline" Enter
Type "rm -r $DEMO 2>/dev/null; mkdir -p $DEMO" Enter

# Build the entire anonymized, offline harness via the committed helper.
Type "node $REPO/docs/fixtures/seed-demo-harness.mjs $REPO $DEMO" Enter

# A throwaway git repo named 'copilotline' on branch 'main' so the directory +
# branch segment renders as 'copilotline (main)' deterministically.
Type "git -C $DEMO/work/copilotline init -q -b main" Enter
Type "git -C $DEMO/work/copilotline -c user.email=demo@example.com -c user.name=demo commit -q --allow-empty -m init" Enter

# Enter the throwaway repo so the directory/branch segment renders deterministically.
Type "cd $DEMO/work/copilotline" Enter

# Load the public-safe payload into $PAYLOAD so the visible line is clean.
Type "PAYLOAD=$(cat $DEMO/payload.json)" Enter

# Prepend $DEMO/bin (copilotline shim + gh/copilot stubs) so the shim wins on
# PATH while coreutils stay available. Isolated COPILOT_HOME + cache dir + a
# nonexistent VS Code state DB keep the ribbon offline, deterministic, PII-free.
Type "export PATH=$DEMO/bin:$PATH COPILOT_HOME=$DEMO/copilot COPILOTLINE_CACHE_DIR=$DEMO/cache COPILOTLINE_VSCODE_STATE_DB=$DEMO/nope" Enter

Type "clear" Enter
Show

# --- Visible: install, then the clean installed-experience render ---
Type "copilotline install"
Sleep 500ms
Enter
Sleep 1500ms

Type `echo "$PAYLOAD" | copilotline render`
Sleep 500ms
Enter
Sleep 5s

# --- Hidden teardown ---
Hide
Type "cd $REPO && rm -r $DEMO" Enter
Show
