# copilotline doctor demo (charmbracelet VHS)
#
# Renders `copilotline doctor` from the REAL copilotline binary in a fully
# isolated, deterministic, PII-free environment: account detection and live
# usage are disabled, COPILOT_HOME and the cache dir point at an anonymous temp
# tree, and a public-safe `copilot` stub supplies a fixed version banner. No
# network, no token, no real account, and no machine-specific paths appear.
#
# All of that plumbing lives in the Hidden block below, including a
# `copilotline` shell function that maps the clean command onto
# `node dist/cli.js` with the demo-only env. After Show, the only text typed on
# screen is the clean, installed-experience command:
#
#   copilotline doctor
#
# Because `copilotline` is a shell function (not a file on PATH), the doctor
# subprocess does NOT see it on PATH -- so the report honestly shows the
# freshly-installed "copilotline command not found on PATH" line while the
# typed command still reads exactly like the installed experience.
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
Set Width 1280
Set Height 760
Set Padding 18
Set Theme "Catppuccin Mocha"
Set TypingSpeed 12ms

# --- Hidden setup: deterministic, isolated, PII-free environment ---
Hide

Type "REPO=$PWD" Enter

# Fixed temp base -> identical anonymous paths on every machine.
Type "DEMO=/tmp/copilotline-demo-cli" Enter
Type "rm -rf $DEMO && mkdir -p $DEMO/bin $DEMO/home/.copilot $DEMO/cache $DEMO/work/copilotline" Enter

# Curated PATH: only node + git + a public-safe copilot stub. The real
# copilotline binary is deliberately absent so doctor shows the honest
# "freshly installed, not yet wired" view with no machine-specific command path.
Type "ln -sf $(command -v node) $DEMO/bin/node" Enter
Type "ln -sf $(command -v git) $DEMO/bin/git" Enter
Type "cp $REPO/docs/fixtures/copilot-shim.sh $DEMO/bin/copilot && chmod +x $DEMO/bin/copilot" Enter

# Enter the throwaway work dir so doctor reports from a neutral, anonymized cwd.
Type "cd $DEMO/work/copilotline" Enter

# Define `copilotline` as a shell function that drives the REAL dist/cli.js with
# the demo-only env hidden off screen: a curated PATH (node + git + copilot
# stub only, so `copilotline` itself is NOT on PATH), disabled account
# detection and live usage, and an anonymous COPILOT_HOME/cache dir. The
# function is invisible to the doctor subprocess, so the report stays the
# honest freshly-installed view.
Type `copilotline() { PATH=$DEMO/bin COPILOTLINE_ACCOUNT=0 COPILOTLINE_USAGE=0 COPILOT_HOME=$DEMO/home/.copilot COPILOTLINE_CACHE_DIR=$DEMO/cache node $REPO/dist/cli.js "$@"; }` Enter

Type "clear" Enter
Show

# --- Visible: the clean, installed-experience diagnostics ---
Type "copilotline doctor"
Sleep 700ms
Enter
Sleep 4500ms

# --- Hidden teardown ---
Hide
Type "cd $REPO && rm -rf $DEMO" Enter
Show
