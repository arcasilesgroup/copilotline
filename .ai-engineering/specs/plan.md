---
execution_route:
  version: 1
  spec: spec-003
  executor: build
  automation: assisted
  concern_count: 2
  estimated_files: 18
  reason: "Single cohesive docs + demo-tooling concern. File count is inflated by one mechanical bulk-deletion of docs/remotion/ (~11 files); the substantive concerns are just README accuracy/IA and the Remotion->VHS demo migration. No code (src/) changes, no cross-cutting DAG, no parallel waves — waved autopilot would add ceremony without benefit. Automation is 'assisted' because GIF rendering needs vhs+ffmpeg (absent in this env) and is a manual maintainer step per spec Non-Goal."
  safe_next_command: "/ai-build"
spec: spec-003
slug: readme-and-remotion-repair
title: README rewrite and demo-pipeline migration to VHS — execution plan
status: approved
pipeline: full
created: 2026-06-02
---

# Plan — spec-003 README rewrite + Remotion→VHS demo migration

## Environment facts (read-only exploration, 2026-06-02)

- `vhs` **0.11.0** + `ffmpeg` **8.1.1** + `ttyd`: **installed** (operator chose
  to install, 2026-06-02). → GIF rendering (T-8) is now **automatable by
  `/ai-build`** in this env. CI is still NOT extended to render (spec Non-Goal);
  the `.tape` scripts remain the source of truth for future regens.
- `dist/cli.js`: **present** → README smoke-test and `.tape` scripts can drive
  the real binary.
- Root `package.json` `render` script = `bun src/cli.ts render` — **unrelated**
  to `docs/remotion`. Deleting Remotion needs **no** root-package change.
- Only repo reference to `docs/remotion` outside the folder itself is
  `README.md:359` (the "Render README demo GIFs" dev block). The
  `ai-video-editing` skill mentions Remotion generically — out of scope, leave.
- Canonical CLI surface (`src/cli.ts` HELP) — the README command table MUST
  match exactly:
  `render` / `render --json` / `refresh` / `refresh --json` /
  `account` / `account --json` / `account --auto` / `account --set <login>` /
  `install` / `uninstall` / `doctor` / `doctor --json` / `--help` / `--version`.
  (No `render --capture`. No `accounts` / `use` in the canonical table — they
  are legacy aliases only.)

## Design (from spec-003 brainstorm; design already settled)

README information architecture was decided during `/ai-brainstorm` via
`/ai-design` and approved by the operator: **newcomer-first inverted pyramid**.
No re-interrogation. Section order:

1. Title + 1-line what + 1-line why
2. Demo GIF (statusline ribbon)
3. **See it in 60 seconds** — zero-prereq trial (piped `echo` smoke test)
4. Install (npm / curl-pipe / Windows / npx)
5. Prerequisites (GitHub Copilot CLI, Node ≥18, `gh auth` for quota)
6. Configure GitHub Copilot CLI
7. Command reference (matches `src/cli.ts` HELP)
8. Usage & quota
9. Privacy & security
10. Troubleshooting
11. Development (VHS demo regen link)
12. Release
13. License

Tone: technical-precise, terminal-native (no marketing fluff). Differentiator:
the no-setup piped-`echo` trial as the hero moment.

## Architecture

`ad-hoc` — documentation + demo tooling. No application architecture touched;
hexagonal `src/` boundary is untouched (spec Non-Goal).

## TDD note

No unit-testable code changes. The RED-equivalent for each concern is a
**verification gate** (command-parity grep, secret scan, dead-reference grep)
defined per task; the terminal verify task (T-9) is the GREEN.

---

## Phase 1 — Demo toolchain migration (Remotion → VHS)

### T-1 — Author `docs/demo-statusline.tape`
- Agent: build
- Files: `docs/demo-statusline.tape` (new)
- Principles applied: §10.2 YAGNI, §10.7 Clean Code
- Patch (deterministic): — (judgment: VHS `.tape` authoring)
- Detail: VHS tape that renders the **full statusline ribbon** by driving the
  real binary — `echo '<public-safe sample status JSON>' | COPILOTLINE_USAGE=0
  COPILOTLINE_CACHE_DIR=<committed fixture cache dir> node dist/cli.js render`.
  Sample values mirror README (`gpt-5.5 · xhigh`, ~47% context, `copilotline`
  cwd, `main`); the fixture cache supplies a **fabricated** credits snapshot so
  the quota segment renders with **no network and no token**. Output →
  `../demo-statusline.gif` (stable filename, D-003-02). Set theme/width/height
  to keep the ribbon on one line.
- Gate: tape references only `node dist/cli.js`, `COPILOTLINE_USAGE=0`, and a
  committed fixture; no real token/login/path strings (`gitleaks` clean).

### T-2 — Author `docs/demo-cli.tape`
- Agent: build
- Files: `docs/demo-cli.tape` (new), fixture cache under `docs/fixtures/` (new, if needed)
- Principles applied: §10.2 YAGNI, §10.7 Clean Code
- Patch (deterministic): — (judgment)
- Detail: VHS tape rendering a `copilotline doctor` reveal from the real binary
  with `COPILOTLINE_USAGE=0` (and the same fixture cache) so doctor output is
  deterministic and **never** prints a real token/account. Output →
  `../demo-cli.gif`.
- Gate: doctor demo emits no secrets/PII; `gitleaks` clean; tape drives only the
  local `dist/cli.js`.

### T-3 — Write `docs/DEMOS.md` (regeneration guide)
- Agent: build
- Files: `docs/DEMOS.md` (new)
- Principles applied: §10.7 Clean Code, §10.6 SDD
- Patch (deterministic): — (judgment)
- Detail: Replaces the deleted `docs/remotion/README.md`. Covers: VHS + ffmpeg
  install (`brew install vhs ffmpeg`), `bun run build` first, then
  `vhs docs/demo-statusline.tape && vhs docs/demo-cli.tape`, the PII rule
  (public-safe sample values only — no real tokens/accounts/usernames/private
  paths), and **when** to regenerate (statusline/doctor output changes).
- Gate: file exists; commands reference real script paths; no machine-specific
  paths (anonymous-content rule, CLAUDE.md §13 rule 4).

### T-4 — Delete `docs/remotion/` entirely
- Agent: build
- Files: `docs/remotion/**` (delete: package.json, package-lock.json,
  tsconfig.json, remotion.config.ts, .gitignore, README.md, src/Statusline.tsx,
  src/Cli.tsx, src/Root.tsx, src/index.ts, src/_helpers.ts)
- Principles applied: §10.2 YAGNI, CLAUDE.md §13 rule 3 (hard delete, no shim)
- Patch (deterministic): `git rm -r docs/remotion`
- Gate: `docs/remotion/` gone; `grep -rn "remotion" --include=*.json
  --include=*.ts .` (excl node_modules/.git/ai-video-editing skill) returns
  nothing; no `react`/`react-dom`/`webpack`/`@remotion` left in repo.

## Phase 2 — README rewrite (depends on T-1 for the demo asset reference)

### T-5 — Rewrite `README.md` newcomer-first with corrected facts
- Agent: build
- Files: `README.md`
- Principles applied: §10.6 SDD, §10.7 Clean Code, §10.4 DRY
- Patch (deterministic): — (judgment: full restructure)
- Detail: Apply the `## Design` section order. Hero = zero-prereq 60-second
  trial. Fold in ALL D-003-04 factual corrections:
  - Command table → canonical `account` (`--auto`/`--set`/`--json`); **remove**
    `render --capture`; keep `accounts`/`use` out of the canonical table (at
    most a one-line "legacy aliases" footnote).
  - JSONC text → v0.2.0 surgical-edit behavior (preserves comments); **delete**
    the stale "JSONC comments disappeared" troubleshooting entry.
  - **Remove** the `COPILOTLINE_VERSION=v0.1.0` example (or bump to current).
  - **Add**: Node ≥18, GitHub Copilot CLI prerequisite, `gh auth` quota
    prerequisite, `~/.local/bin` PATH note, `npx @arcasilesgroup/copilotline
    doctor` zero-install trial.
  - Dev section: replace `cd docs/remotion && npm install && npm run
    render:gif:all` (README:356-362) with a pointer to `docs/DEMOS.md` (VHS).
  - Keep the two GIF image URLs (stable filenames, D-003-02).
- Gate: every command/flag in README appears verbatim in `src/cli.ts` HELP; zero
  occurrences of `--capture`, `npm run render:gif`, `docs/remotion`, or
  `v0.1.0`; markdown links resolve; English only (no `README.es.md`).

### T-6 — Update `CHANGELOG.md`
- Agent: build
- Files: `CHANGELOG.md`
- Principles applied: §10.7 Clean Code, CLAUDE.md §13 rule 3 (document breakage)
- Patch (deterministic): — (judgment: changelog prose)
- Detail: Add an `## [Unreleased]` entry — `Changed`: README rewritten
  newcomer-first + factual corrections; `Changed`/`Removed`: demo pipeline
  migrated from Remotion to VHS (`docs/remotion/` removed, `.tape` + `docs/DEMOS.md`
  added). Note the npm-page README refreshes on next publish.
- Gate: CHANGELOG parses; entry references the Remotion→VHS swap.

## Phase 3 — Cleanup + verification

### T-7 — Close obsolete branch `fix/osv-remotion-transitive-deps` (MANUAL / maintainer)
- Agent: guard (advisory) — **manual maintainer action** (outward-facing remote delete)
- Files: — (git refs only)
- Principles applied: §10.2 YAGNI
- Patch (deterministic): — (run manually, fail-open if already gone)
  ```
  git branch -D fix/osv-remotion-transitive-deps 2>/dev/null || true
  git push origin --delete fix/osv-remotion-transitive-deps 2>/dev/null || true
  ```
- Gate (AC-8): branch absent locally and on origin.

### T-8 — Render the two GIFs (build — vhs+ffmpeg now installed)
- Agent: build
- Files: `docs/demo-statusline.gif`, `docs/demo-cli.gif` (regenerated binaries)
- Principles applied: §10.6 SDD
- Patch (deterministic): `bun run build && vhs docs/demo-statusline.tape && vhs docs/demo-cli.tape`
- Detail: Depends on T-1/T-2 (`.tape`) and a built `dist/cli.js`. Render both
  GIFs, then **review for PII** before staging (no real token/account/path).
  Replaces the stale committed GIFs in place (stable filenames, D-003-02).
- Gate (AC-2): GIFs reproduce from the `.tape` scripts; visually reflect v0.2.x
  output; PII-free (`gitleaks` clean on the demo assets).

### T-9 — Terminal verification (read-only)
- Agent: verify
- Files: repo-wide (read-only)
- Principles applied: §10.6 SDD, §10.7 Clean Code
- Patch (deterministic): —
- Detail: Confirm the automatable acceptance-criteria subset:
  - AC-1: no `react`/`react-dom`/`webpack`/`@remotion` anywhere; `docs/remotion/`
    gone.
  - AC-4: README command parity vs `src/cli.ts` HELP; no `--capture`.
  - AC-5: prereqs + npx + PATH present in README.
  - AC-6: English only; no `README.es.md`.
  - AC-7: `gitleaks` clean on `docs/*.tape`, `docs/fixtures/**`, `docs/DEMOS.md`.
  - Dead refs: no `docs/remotion`, `npm run render:gif`, `v0.1.0` in README.
- Gate: all checks pass; report deviations. (AC-2/AC-3-visual and AC-8 are
  manual, covered by T-7/T-8.)

---

## Phase ordering & gates

- **Phase 1** (T-1…T-4) before **Phase 2** (T-5 references the demo asset + the
  DEMOS.md link). T-1/T-2/T-3 are independent; T-4 (delete) runs last in the
  phase to keep tape authoring referenceable if needed.
- **Phase 2** (T-5, T-6) after Phase 1.
- **Phase 3**: T-8 (render) after T-1/T-2 + a built `dist/cli.js`; T-9 (verify)
  last. T-7 (branch remote-delete) is the only **manual maintainer step** —
  surfaced in the PR body, not blocking the build.

## Automatable vs manual split

- **Automatable by `/ai-build`**: T-1, T-2, T-3, T-4, T-5, T-6, T-8, T-9.
- **Manual maintainer (outward-facing remote ref delete)**: T-7 (close
  `fix/osv-remotion-transitive-deps`). `/ai-pr` surfaces it as a follow-up.

## Quality Remediation

used: true
max_attempts: 1
Scope (blocker/high from initial assessment, mechanical + finding-scoped):
- BLOCKER: `docs/fixtures/usage-cache.json` swallowed by `.gitignore:13`
  (`usage-cache.json`) → negate for the fixture path + force-add so the demo
  regenerates from a clean clone (AC-2).
- HIGH: dangling `docs/remotion` config — remove the `/docs/remotion` npm block
  from `.github/dependabot.yml` and the dead `docs/remotion/*` rules from
  `.gitignore` (AC-1).
Low findings (CHANGELOG branch-name note, spec-003.json state drift, doctor
`use auto` src hint) are recorded in the PR body, NOT remediated here (the
doctor hint is a spec Non-Goal src change → follow-up spec).
final_reassessment: pass

## Quality Outcome

Initial assessment (verify 88/100 + review): 1 blocker + 1 high, corroborated.
After one bounded remediation pass + deterministic final reassessment:
**0 blockers, 0 criticals, 0 highs → PASS.**
- Blocker (fixture gitignored): `.gitignore` negated for `docs/fixtures/usage-cache.json`
  + force-added → `git check-ignore` clears, `git ls-files` lists it.
- High (dangling docs/remotion config): removed `/docs/remotion` npm block from
  `.github/dependabot.yml` + dead `docs/remotion/*` rules from `.gitignore`.
- Evidence: `src/` unchanged; `bun test` 85 pass / 0 fail; `tsc --noEmit` exit 0;
  gitleaks clean; dependabot.yml valid (npm:/ + github-actions:/).

## Operator decision (resolved)

- GIF render (T-8): operator chose to **install vhs+ffmpeg now** → `/ai-build`
  renders fresh v0.2.x GIFs in the same PR. Resolved 2026-06-02.
