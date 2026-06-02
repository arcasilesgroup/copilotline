# copilotline install-wizard demo (charmbracelet VHS)
#
# Shows the real first-run experience: `copilotline install` wires the
# statusline into settings.json and then runs the interactive account picker
# ("Choose quota account"). Everything runs against a public-safe, offline,
# fully anonymized harness that seeds THREE fabricated Copilot accounts
# (octocat / monalisa / hubot) -- no network, no real GitHub token, no real
# account. PII-free by construction.
#
# IMPORTANT: regenerate via the wrapper, NOT bare `vhs`:
#
#   bash docs/fixtures/render-demos.sh
#
# The wrapper does ALL setup OUTSIDE VHS (deterministic shell, no PTY race) and
# exports $CL_DEMO -- the isolated /tmp demo root that docs/fixtures/seed-
# install-shell.sh built (a copy of the built dist/cli.js so settings.json
# records the anonymized /tmp path; a `copilotline` shim that runs the bundle
# under the docs/fixtures/github-user-mock.mjs preload and does NOT pass
# --no-account, so `install` shows the picker and the fabricated per-login
# tokens verify "token ok" offline; a `gh` stub so no host account leaks; the
# fabricated octocat Copilot config + a VS Code state.vscdb with monalisa/hubot;
# and $CL_DEMO/env.sh with cd + the isolated env exports). Here the tape types
# only ONE short fixed line off screen (`source $CL_DEMO/env.sh`, which VHS
# inherits from the wrapper) plus the single visible `copilotline install` line
# and the picker selection, so there is nothing fragile to corrupt.
#
# The canvas is rendered generously into raw-install.gif; the wrapper runs vhs
# with its CWD set to $CL_DEMO (so this relative path lands in the isolated /tmp
# root), then trims it pixel-tight with a uniform border (the `magick -trim`
# convergence loop) and writes the final docs/demo-install.gif. VHS does not
# expand env vars in Output, hence the fixed relative path + the wrapper's CWD.

Output "raw-install.gif"

Require node

Set Shell "bash"
Set FontSize 18
Set Width 1100
Set Height 720
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 18ms

# --- Hidden setup: pull the off-VHS demo state into the visible shell ---
# $CL_DEMO is exported by docs/fixtures/render-demos.sh and inherited by VHS;
# env.sh sets cd + the isolated env so install runs against the fabricated
# octocat/monalisa/hubot accounts.
Hide
Type "source $CL_DEMO/env.sh" Enter
Sleep 600ms
Type "clear" Enter
Sleep 300ms
Show

# --- Visible: the real first-run install + account picker ---
Type "copilotline install"
Sleep 500ms
Enter
# Wait for the installed line + the account box + "Choose quota account" list.
Sleep 2500ms
# Pick a specific account (monalisa) so the demo shows a real selection, not
# just "keep current".
Type "3"
Sleep 600ms
Enter
Sleep 1500ms
# Hold on the final confirmation frame.
Sleep 5s

# --- Hidden teardown (the wrapper removes $CL_DEMO after rendering) ---
Hide
Type "cd $CL_DEMO 2>/dev/null; clear" Enter
Show
