# copilotline doctor demo (charmbracelet VHS)
#
# Shows the installed experience: `copilotline doctor` running the REAL
# copilotline binary to print the diagnostics report as green as honestly
# possible. Everything runs against a public-safe, offline, fully anonymized
# harness -- no network, no GitHub token, no real account. PII-free by
# construction.
#
# IMPORTANT: regenerate via the wrapper, NOT bare `vhs`:
#
#   bash docs/fixtures/render-demos.sh
#
# The wrapper does ALL setup OUTSIDE VHS (deterministic shell, no PTY race) and
# exports $CL_DEMO -- the isolated /tmp demo root that docs/fixtures/seed-demo-
# shell.sh built (a copy of the built dist/cli.js so settings.json records the
# anonymized /tmp path; a `copilotline` shim whose `install` runs non-
# interactively via --no-account; a `gh` stub so no host account leaks; a
# public-safe `copilot` version stub; the fabricated `octocat` account + offline
# credits cache; and $CL_DEMO/env.sh with cd + isolated env exports + $PAYLOAD).
# The wrapper also runs `copilotline install` off screen so doctor's
# Configuration section is green. This off-VHS setup is deliberate: VHS types
# keystrokes into a PTY faster than the shell consumes output, so typing the
# multi-step setup inside the tape intermittently corrupts a line. Here the tape
# types only ONE short fixed line off screen (`source $CL_DEMO/env.sh`, which VHS
# inherits from the wrapper) plus the single visible doctor line.
#
# After install the report is green for Environment (copilotline/copilot/git on
# PATH, Node), Configuration (settings written, statusLine.command wired to the
# anonymized /tmp path, footer.showCustom enabled), and Account (octocat
# detected, mode auto, AI-credits billing). The single honest WARN is the quota
# token check: validating a token needs the network, so the demo never fabricates
# one -- that check stays an honest warn rather than faking credentials.
#
# Output is written to docs/demo-cli.gif (path is relative to the CWD where vhs
# is invoked, i.e. the repo root).

Output docs/demo-cli.gif

Require node
Require git

Set Shell "bash"
Set FontSize 18
Set Width 1844
Set Height 612
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 12ms

# --- Hidden setup: pull the off-VHS demo state into the visible shell ---
# $CL_DEMO is exported by docs/fixtures/render-demos.sh and inherited by VHS;
# env.sh sets cd + the isolated env so doctor runs against the octocat fixture.
Hide
Type "source $CL_DEMO/env.sh" Enter
Sleep 600ms
Type "clear" Enter
Sleep 300ms
Show

# --- Visible: the clean installed-experience diagnostics ---
Type "copilotline doctor"
Sleep 500ms
Enter
Sleep 5s

# --- Hidden teardown (the wrapper removes $CL_DEMO after rendering) ---
Hide
Type "cd $CL_DEMO 2>/dev/null; clear" Enter
Show
