---
id: spec-003
slug: readme-and-remotion-repair
title: README rewrite and demo-pipeline migration to VHS
status: approved-pending
created: 2026-06-02
refs: []
---

# README rewrite and demo-pipeline migration to VHS

## Summary

The root `README.md` is **significantly stale** relative to the shipped
`v0.2.1` CLI, and the Remotion project at `docs/remotion/` that generates the
two README demo GIFs **cannot run** and carries an unresolved security desync.
This spec makes the README an accurate, newcomer-first document that lets a
first-time visitor understand *what copilotline is*, *what it does*, and *try
it with zero prerequisites in under a minute* — and replaces the heavyweight
Remotion demo toolchain with [charmbracelet VHS](https://github.com/charmbracelet/vhs)
`.tape` scripts that render the **real CLI output**, so the demos can never
again drift from reality and stop importing a recurring transitive-CVE tax.

This is a **docs + demo-tooling** change only. No `src/` behavior, no CLI
feature, and no npm version/release is in scope.

### Current-state evidence (research, spec-003)

README rot (verdict: `significantly-stale`):
- `render --capture <path>` documented (README:116) but **removed in v0.2.0**
  (CHANGELOG [0.2.0] Removed; zero `capture` matches in `src/cli.ts`).
- `accounts` / `use auto` / `use <login>` presented as canonical
  (README:119-121) but the real canonical command is `account` (singular) with
  `--json` / `--auto` / `--set <login>` (`src/cli.ts:55-68`); `accounts`/`use`
  are legacy alias shims (`src/cli.ts:100-109`).
- JSONC handling text — "rewrites as formatted JSON" (README:108-109) and the
  "JSONC comments disappeared" troubleshooting (README:333-337) — describes
  **pre-v0.2.0 behavior**; v0.2.0 edits surgically and preserves comments.
- Install example pins `COPILOTLINE_VERSION=v0.1.0` (README:59) — two versions
  back, breaking.
- Missing for a newcomer: Node ≥18 requirement, the canonical `account`
  command, an `npx` zero-install trial path, the prerequisite that **GitHub
  Copilot CLI itself must be installed**, the `gh auth` prerequisite for quota,
  and the `~/.local/bin` PATH gap from the curl installer.

Remotion breakage (fix complexity: `moderate`):
- `docs/remotion/node_modules` absent → nothing runs without `npm install`.
- Security desync: `docs/remotion/package.json` has an `overrides` block
  (webpack / fast-uri / ws) but `package-lock.json` root `""` entry **lacks
  it**. The fix lives on the **unmerged** branch
  `fix/osv-remotion-transitive-deps` (commit `3f49ca3`). A clean `npm install`
  on `main` may re-resolve to vulnerable `fast-uri` (High, GHSA-q3j6-qgpj-74h6)
  / `ws` (Medium, GHSA-58qx-3vcg-4xpx).
- The two GIFs (`docs/demo-statusline.gif`, `docs/demo-cli.gif`) exist, are
  git-tracked, and are **load-bearing** in the README (lines 16, 135) but
  **stale** — never re-rendered after the token-billing UI change to
  `Statusline.tsx` (PRs #13/#14).
- The stack (React 19 + webpack + 6 `@remotion/*` deps) is heavyweight for two
  terminal GIFs and contradicts copilotline's own **zero-dependency** design.

## Goals

1. A README a first-time visitor can read top-to-bottom and immediately grok
   **what copilotline is, what it does, and how to try it** — leading with the
   value proposition and a **zero-prerequisite 60-second trial** (the piped
   `echo … | copilotline render` smoke test, which needs neither GitHub Copilot
   CLI nor `gh` auth).
2. Every command, flag, env var, and behavioral claim in the README matches the
   shipped `v0.2.1` reality (`src/cli.ts` HELP + CHANGELOG).
3. The two demo GIFs are generated from the **real CLI output** by a tool that
   matches copilotline's zero-dependency ethos and carries no recurring
   transitive-CVE maintenance burden.
4. The demo regeneration path is documented and reproducible by any maintainer.
5. No known-vulnerable dependency is introduced anywhere in the repo by this
   change.

## Non-Goals

- **No `src/` changes.** No new CLI commands, flags, or rendering behavior.
- **No npm version bump or release.** (Note: the npm registry README only
  refreshes on the next publish — see Risks.)
- **No bilingual README.** English only; a community Spanish translation may be
  added later if audience demand justifies it.
- **No repair of the existing Remotion project.** It is removed, not fixed; the
  unmerged `fix/osv-remotion-transitive-deps` branch is closed as obsolete.
- **No new marketing collateral** (blog, social, landing page) — README +
  in-repo demo assets only.
- **No CI gate that renders demos.** Regeneration stays a manual maintainer
  step (VHS needs a TTY + ffmpeg); CI is not extended to render GIFs.

## Decisions

- **D-003-01 — Replace Remotion with charmbracelet VHS.** Delete
  `docs/remotion/` entirely (removing `react`, `react-dom`, `webpack`, and the
  three `@remotion/*` packages plus their lockfile). Author `.tape` scripts that
  drive the **real `copilotline` binary** to produce the demos. *Rationale:*
  copilotline is zero-dependency by design; a React+webpack toolchain for two
  GIFs is the tail wagging the dog (§10.2 YAGNI, §8 elegance), and VHS demos run
  the actual CLI so they cannot silently drift from shipped behavior.
- **D-003-02 — Stable GIF filenames.** Keep `docs/demo-statusline.gif` and
  `docs/demo-cli.gif` so the README `raw.githubusercontent.com` image URLs and
  any external links do not break. Only the *content* and the *generator*
  change.
- **D-003-03 — README restructured newcomer-first.** Order: one-line what +
  why → demo GIF → **"See it in 60 seconds"** zero-prereq quickstart → Install
  → Configure GitHub Copilot CLI → Command reference → Usage & quota → Privacy
  & security → Troubleshooting → Development → Release → License. The hero is
  the no-setup piped-`echo` smoke test.
- **D-003-04 — Factual correction is part of the rewrite.** The canonical
  `account` command (`--json` / `--auto` / `--set <login>`) replaces the
  alias-as-primary presentation; `render --capture` is removed; the JSONC text
  is updated to the v0.2.0 surgical-edit behavior; the `v0.1.0` install example
  is removed/updated; Node ≥18, the GitHub Copilot CLI prerequisite, the
  `gh auth` quota prerequisite, the `~/.local/bin` PATH note, and an `npx`
  zero-install trial path are added.
- **D-003-05 — English only.** Matches the npm package, source, CHANGELOG, and
  CONSTITUTION; single source of truth, no drift.
- **D-003-06 — Demos are PII-free and reproducible.** `.tape` scripts use
  public-safe sample values only (the README-style sample payload) and disable
  live usage (`COPILOTLINE_USAGE=0`) or a fixture for the `doctor` demo — no
  real tokens, accounts, usernames, or private paths in any generated asset.
- **D-003-07 — Demo regeneration is documented.** Replace
  `docs/remotion/README.md` with a regeneration guide (new home under `docs/`,
  e.g. `docs/DEMOS.md` plus the `.tape` files) covering VHS install and the
  render commands.

## Approaches considered

- **A — Repair Remotion in place** (merge the OSV lockfile overrides,
  `npm install`, regenerate GIFs against v0.2.x UI). Fastest to ship, but keeps
  the heavy React/webpack tree and the recurring CVE maintenance, and the demo
  remains a hand-animated mock that can drift from real output. *Rejected.*
- **B — Replace with VHS (chosen).** Aligns with the zero-dep ethos, eliminates
  the transitive-CVE surface, and the demos run the real binary so they stay
  honest. Higher up-front effort (re-author the two animations as `.tape`).
- **C — Repair install/security only, do not regenerate** — leaves the stale-UI
  GIFs in the README. *Rejected* (fails Goal 1's visual accuracy).
- **D — Delete the demo pipeline and the GIFs, text-only README** — kills all
  maintenance/security surface but removes the visual demo a newcomer benefits
  from. *Rejected* (weakens comprehension).

## Acceptance Criteria

1. `docs/remotion/` is deleted; no `react`, `react-dom`, `webpack`, or
   `@remotion/*` dependency or lockfile remains anywhere in the repo, and a repo
   dependency/secret scan is clean.
2. `.tape` script(s) and a regeneration guide exist under `docs/`; running them
   reproduces `docs/demo-statusline.gif` and `docs/demo-cli.gif` from the **real
   `copilotline` CLI output** with public-safe sample values only.
3. `README.md` opens with a concise what + why, shows the demo, then a
   **zero-prerequisite 60-second trial** (piped `echo … | COPILOTLINE_USAGE=0
   copilotline render`) before any install/configure section.
4. Every command, flag, and env var in `README.md` matches `src/cli.ts` HELP and
   the CHANGELOG: `account` is canonical (with `--auto` / `--set` / `--json`),
   `render --capture` is gone, JSONC text reflects v0.2.0 surgical editing, and
   the `v0.1.0` example is removed/updated.
5. `README.md` documents the GitHub Copilot CLI prerequisite, Node ≥18, the
   `gh auth` quota prerequisite, the `~/.local/bin` PATH note, and an `npx`
   trial path.
6. `README.md` is English; no Spanish file is added.
7. No real tokens, accounts, usernames, or private repository paths appear in
   any committed demo asset or `.tape` script.
8. The unmerged `fix/osv-remotion-transitive-deps` branch is closed as obsolete.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|:---:|:---:|------------|
| npm registry README only refreshes on next publish; npmjs.com shows old README until then | High | Low | Accepted — GitHub-rendered README + raw-served GIFs update on merge to `main` (primary discovery path); a future release republishes |
| VHS absent in maintainer/CI env (needs TTY + ffmpeg) | Medium | Low | Regeneration is a documented manual step (D-003-07), not CI-gated (Non-Goal); committed GIFs are SoT between regenerations |
| VHS captures real terminal output → more utilitarian/honest, less "produced" look than hand-animated Remotion | High | Low | Accepted — honesty + zero maintenance outweigh polish |
| A `.tape` running the live binary captures a real token/account | Low | Critical | D-003-06 mandates fixtures + `COPILOTLINE_USAGE=0`; AC-7 + commit-time `gitleaks` gate enforce it |
| Removing Remotion abandons in-flight `fix/osv-remotion-transitive-deps` work | Medium | Low | AC-8 closes the branch explicitly; CHANGELOG documents the demo-toolchain change |
| Demo content drifts again from a future UI change | Low | Medium | VHS runs the real binary, so a re-render reflects current output; document the regen trigger in `docs/DEMOS.md` |
