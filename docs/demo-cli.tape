# copilotline doctor demo (charmbracelet VHS)
#
# Shows the freshly-installed experience end to end: first `copilotline install`
# (writes the statusLine entry into the isolated demo settings.json), then
# `copilotline doctor` running the REAL copilotline binary to print the
# diagnostics report as green as honestly possible. Everything runs against a
# public-safe, offline, fully anonymized harness -- no network, no GitHub token,
# no real account. PII-free by construction.
#
# All of the demo plumbing lives in the Hidden block below and is built by the
# committed helper docs/fixtures/seed-demo-harness.mjs (an anonymized demo root
# under /tmp, a copy of the built dist/cli.js at $DEMO/cli.js so the path written
# into settings.json is the anonymized /tmp path, a `copilotline` shim on PATH
# whose `install` runs non-interactively via --no-account, a `gh` stub so no host
# account leaks, a public-safe `copilot` version stub, the fabricated `octocat`
# account + offline credits cache). After Show, the only text typed on screen is
# the clean, installed-experience sequence:
#
#   copilotline install
#   copilotline doctor
#
# After install the report is green for Environment (copilotline/copilot/git on
# PATH, Node), Configuration (settings written, statusLine.command wired to the
# anonymized /tmp path, footer.showCustom enabled), and Account (octocat
# detected, mode auto, AI-credits billing). The single honest WARN is the quota
# token check: validating a token needs the network, so the demo never fabricates
# one -- that check stays an honest warn rather than faking credentials.
#
# Run from the repository root, after `bun run build`:
#   vhs docs/demo-cli.tape
#
# Output is written to docs/demo-cli.gif (path is relative to the CWD where vhs
# is invoked, i.e. the repo root).

Output docs/demo-cli.gif

Require node
Require git

Set Shell "bash"
Set FontSize 18
Set Width 1844
Set Height 650
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 12ms

# --- Hidden setup: deterministic, isolated, PII-free environment ---
Hide

Type "REPO=$PWD" Enter
Type "DEMO=/tmp/copilotline-demo-cli" Enter
Type "rm -r $DEMO 2>/dev/null; mkdir -p $DEMO" Enter

# Build the entire anonymized, offline harness via the committed helper.
Type "node $REPO/docs/fixtures/seed-demo-harness.mjs $REPO $DEMO" Enter

# A throwaway git repo named 'copilotline' on branch 'main' so the directory +
# branch segment in the synthetic render preview is deterministic.
Type "git -C $DEMO/work/copilotline init -q -b main" Enter
Type "git -C $DEMO/work/copilotline -c user.email=demo@example.com -c user.name=demo commit -q --allow-empty -m init" Enter

# Run doctor from the throwaway repo so its cwd is a neutral, anonymized path.
Type "cd $DEMO/work/copilotline" Enter

# Prepend $DEMO/bin (copilotline shim + gh/copilot stubs) so the shim wins on
# PATH while coreutils stay available. Isolated COPILOT_HOME + cache dir + a
# nonexistent VS Code state DB keep doctor offline, deterministic, and PII-free.
Type "export PATH=$DEMO/bin:$PATH COPILOT_HOME=$DEMO/copilot COPILOTLINE_CACHE_DIR=$DEMO/cache COPILOTLINE_VSCODE_STATE_DB=$DEMO/nope" Enter

Type "clear" Enter
Show

# --- Visible: install, then the clean installed-experience diagnostics ---
Type "copilotline install"
Sleep 500ms
Enter
Sleep 1500ms

Type "copilotline doctor"
Sleep 500ms
Enter
Sleep 5s

# --- Hidden teardown ---
Hide
Type "cd $REPO && rm -r $DEMO" Enter
Show
