# copilotline statusline demo (charmbracelet VHS)
#
# Shows the installed experience: `echo "$PAYLOAD" | copilotline render` driving
# the REAL copilotline binary to emit the full statusline ribbon. Everything runs
# against a public-safe, offline, fully anonymized harness -- no network, no
# GitHub token, no real account. PII-free by construction.
#
# IMPORTANT: regenerate via the wrapper, NOT bare `vhs`:
#
#   bash docs/fixtures/render-demos.sh
#
# The wrapper does ALL setup OUTSIDE VHS (deterministic shell, no PTY race) and
# exports $CL_DEMO -- the isolated /tmp demo root that docs/fixtures/seed-demo-
# shell.sh built (a copy of the built dist/cli.js so settings.json records the
# anonymized /tmp path; a `copilotline` shim whose `install` runs non-
# interactively via --no-account; a `gh` stub so no host account leaks; the
# fabricated `octocat` account + offline credits cache; the public-safe payload;
# and $CL_DEMO/env.sh with cd + isolated env exports + $PAYLOAD). The wrapper
# also runs `copilotline install` off screen so the installed credits segment
# resolves. This off-VHS setup is deliberate: VHS types keystrokes into a PTY
# faster than the shell consumes output, so typing the multi-step setup inside
# the tape intermittently corrupts a line -- and a corrupted payload assignment
# makes `render` fall back to the model "Copilot" and the REAL host account (a
# PII leak). Here the tape types only ONE short fixed line off screen
# (`source $CL_DEMO/env.sh`, which VHS inherits from the wrapper) plus the single
# visible render line, so there is nothing fragile to corrupt.
#
# Output is written to docs/demo-statusline.gif (path is relative to the CWD
# where vhs is invoked, i.e. the repo root).

Output docs/demo-statusline.gif

Require node
Require git

Set Shell "bash"
Set FontSize 18
Set Width 1352
Set Height 128
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 12ms

# --- Hidden setup: pull the off-VHS demo state into the visible shell ---
# $CL_DEMO is exported by docs/fixtures/render-demos.sh and inherited by VHS;
# env.sh sets cd + the isolated env + the public-safe $PAYLOAD.
Hide
Type "source $CL_DEMO/env.sh" Enter
Sleep 600ms
Type "clear" Enter
Sleep 300ms
Show

# --- Visible: the clean installed-experience render ---
Type `echo "$PAYLOAD" | copilotline render`
Sleep 500ms
Enter
Sleep 5s

# --- Hidden teardown (the wrapper removes $CL_DEMO after rendering) ---
Hide
Type "cd $CL_DEMO 2>/dev/null; clear" Enter
Show
