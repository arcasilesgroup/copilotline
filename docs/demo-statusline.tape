# copilotline statusline demo (charmbracelet VHS)
#
# Renders the full statusline ribbon by driving the REAL copilotline binary
# against a public-safe, offline fixture cache. No network, no GitHub token, no
# real account -- PII-free by construction.
#
# All of the demo plumbing (offline fixture cache, the public-safe payload, the
# throwaway git repo, and a `copilotline` shell function that maps the clean
# command onto `node dist/cli.js` with the demo-only env) lives in the Hidden
# block below. After Show, the only text typed on screen is the clean,
# installed-experience command:
#
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
Set Width 1500
Set Height 220
Set Padding 18
Set Theme "Catppuccin Mocha"
Set TypingSpeed 12ms

# --- Hidden setup: build a deterministic, offline, PII-free environment ---
Hide

# Capture the repo root (vhs starts the shell in the invocation CWD).
Type "REPO=$PWD" Enter

# Fixed temp base so the demo path is identical on every machine (no $HOME,
# no per-user temp hash). Anonymous by construction.
Type "DEMO=/tmp/copilotline-demo-statusline" Enter
Type "rm -rf $DEMO && mkdir -p $DEMO/cache $DEMO/work/copilotline" Enter

# A throwaway git repo named 'copilotline' on branch 'main' so the directory +
# branch segment renders as 'copilotline (main)' deterministically.
Type "git -C $DEMO/work/copilotline init -q -b main" Enter
Type "git -C $DEMO/work/copilotline -c user.email=demo@example.com -c user.name=demo commit -q --allow-empty -m init" Enter

# Seed the offline usage cache (fresh fetchedAt, within TTL) and a public-safe
# status payload (mirrors the README sample) via the committed helper. No
# account fields, so detection stays disabled and the offline cache is used.
Type "node $REPO/docs/fixtures/seed-demo-cache.mjs $REPO $DEMO" Enter

# Load the public-safe payload into $PAYLOAD so the visible line is a clean,
# single-quote-free one-liner. The payload carries a fresh started_at (~2h27m
# ago) so the timer segment re-renders deterministically every run.
Type "PAYLOAD=$(cat $DEMO/payload.json)" Enter

# Define `copilotline` as a shell function that drives the REAL dist/cli.js
# against the offline fixture cache, with the demo-only env hidden off screen.
# A function (not a file on PATH) means `copilotline render` reads exactly like
# the installed command while staying fully offline: COPILOTLINE_ACCOUNT=0
# disables detection, COPILOTLINE_CACHE_DIR points at the seeded offline cache.
Type `copilotline() { COPILOTLINE_ACCOUNT=0 COPILOTLINE_CACHE_DIR=$DEMO/cache node $REPO/dist/cli.js "$@"; }` Enter

Type "clear" Enter
Show

# --- Visible: the clean, installed-experience render ---
Type `echo "$PAYLOAD" | copilotline render`
Sleep 700ms
Enter
Sleep 3500ms

# --- Hidden teardown ---
Hide
Type "rm -rf $DEMO" Enter
Show
