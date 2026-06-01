---
spec: spec-001
title: copilotline Statusline Excellence — Release Blockers (M0–M2)
status: approved
effort: large
summary: Close copilotline's three release-blockers — token exfiltration via unallowlisted host, JSONC-comment data loss on settings write, and 3x-per-render subprocess fan-out — plus quota-parse and CLI correctness fixes, behind a new host-policy allowlist boundary proven failing-test-first.
---

# copilotline Statusline Excellence — Release Blockers (M0–M2)

## Summary

`copilotline` is architecturally sound (clean hexagonal layering, zero runtime
dependencies, atomic writes) but a cluster of high-consequence defects keeps it
below a shippable bar. Three are release-blockers: (1) `normalizeHost` applies
**no allowlist**, so a payload-supplied `host` flows through to a token-bearing
`GET https://api.<host>/user`, leaking the user's GitHub token to an
attacker-controlled host before the login-match check rejects it
(`src/infrastructure/copilot-account.ts:282`,`:288`,`:419`;
`src/infrastructure/copilot-usage.ts:96`) — violating the pledge in `SECURITY.md`;
(2) install/uninstall round-trips the user-owned JSONC `~/.copilot/settings.json`
through `JSON.parse`→`JSON.stringify`, **irreversibly deleting every comment and
trailing comma** (`src/infrastructure/copilot-settings-file.ts:33`); (3) the render
path resolves the account **eagerly and three times per render**, each spawning
`gh`+`sqlite3`, plus a double `git` spawn, all synchronous foreground I/O —
hundreds of milliseconds, too slow for per-turn repaint
(`src/infrastructure/copilot-usage.ts:187`,`:196`,`:206`;
`src/infrastructure/git-info.ts:20`,`:31`). Alongside, correctness defects make
output untrustworthy: a duplicated, drifted quota parser renders `∞` from live
data and a garbage bar from cache (`copilot-usage.ts:328` vs
`render-status-line.ts:485`); `formatReset` formats a UTC instant with
local-timezone getters and no label (`render-status-line.ts:838`); and
`readFlagValue` swallows the next flag as a value (`cli.ts:676`). This spec closes
all of the above (milestones **M0 safety**, **M1 performance**, **M2 correctness**)
and proves each with a failing test first. The terminal-UI design system, motion,
broader observability, and DX polish are **deferred to a follow-up spec**.

## Goals

- **No token egress to a non-allowlisted host.** A payload of
  `{"account":{"host":"attacker.tld"}}` produces zero network requests to any host
  outside the allowlist — proven by a test with an injected `fetchImpl` recording
  the request URL.
- **The host allowlist lives behind one boundary.** A new
  `src/infrastructure/host-policy.ts` is the single place host normalization and
  the allowlist decision happen; the host is validated at every ingestion point
  (account record, `--host`, VS Code state), not only at fetch time.
- **The user's settings comments survive.** `install` then `uninstall` on a
  `settings.json` containing comments leaves every comment and trailing comma
  byte-identical except the managed keys.
- **Render repaints fast.** Exactly one `selectCopilotAccount` invocation per
  render; zero foreground `gh`/`sqlite3` spawns on the render path; a single `git`
  spawn per in-repo render.
- **Quota renders identically from live and cache.** The unlimited
  (`entitlement === -1`) and aliased (`quota_remaining`/`quotaRemaining`) cases
  produce the same output whether read from the live payload or the cache.
- **Time and flag parsing are deterministic and safe.** `formatReset` is
  timezone-deterministic and labeled under a forced `TZ`; `readFlagValue` rejects a
  flag-shaped value; `copilotline-config` never crashes render on malformed config.
- **The arbitrary-write footgun is gone.** The `--capture` flag and its
  payload-named write path are removed.
- **Tests assert the real contract.** The false-confidence JSONC test
  (`tests/configure-status-line.test.ts:28`) is rewritten to assert comment
  survival, and the previously-untested load-bearing units exercised by M0–M2
  gain coverage. All gates (`bun run lint` / tsc strict, `bun test`, gitleaks,
  CodeQL) stay green.

## Non-Goals

- **M3 — Terminal-UI design system.** Semantic-token palette + degradation ladder,
  `NO_COLOR`/color-depth resolver, `--color`/`--theme`/`--bg` flags, width-budget +
  directory truncation, VS16-free glyph sets, severity sigils, the new
  `terminal-capabilities.ts` and `presentation/theme.ts` modules — **deferred to a
  follow-up spec.**
- **M4 — Motion & interactive polish.** Freshness state machine, `enrichAccounts`
  Braille spinner, confirmation flash, partial-cell quota bar — **deferred.**
- **M5 — Broader observability.** Wiring `bun test --coverage` thresholds into CI,
  `doctor` probes for `sqlite3` / the internal endpoint / cache age, release-gating
  `src/version.ts`, and `VERSION` interpolation into HTTP headers — **deferred.**
  (The per-blocker failing tests of M0–M2 are **in scope**; only the CI
  coverage-floor enforcement and doctor probes are deferred.)
- **M6 — DX & distribution.** Shell completions, consolidated env-var/config README
  reference, man page, `upgrade` subcommand — **deferred.**
- **GHES self-hosted Copilot quota** (`api.enterprise.githubcopilot.com`). The
  allowlist is GHEC-only; GHES fails closed (no quota) and may be an additive
  opt-in in a later spec.
- **Open design decisions #2/#3/#6** (zero-dep `displayWidth` vs `string-width`,
  dot bar vs eighth-block bar, powerline preset) — these belong to the deferred
  design-system/motion spec, not this one.
- **Restoring `--capture`** — it is removed, not deferred.
- **Adding any runtime dependency** — the zero-dep posture is a preserved invariant.
- **Rewriting the hexagonal architecture** — it is sound; only new
  infrastructure modules are added.
- **Windows shell-installer parity** and **non-GitHub quota providers** — out of
  scope, unchanged.

## Decisions

- **D-001-01 — Scope is M0–M2 release-blockers; M3–M6 deferred to a follow-up
  spec.** *Rationale:* the brief establishes M0–M2 as independently shippable
  release-blockers; gating a token-exfiltration fix behind a design-system rewrite
  violates Surgical Changes and inflates blast radius. Ship safety/perf/correctness
  first; layer excellence next.
- **D-001-02 — A new `src/infrastructure/host-policy.ts` is the single allowlist
  boundary.** `normalizeHost`/`usageApiBaseForHost` move here; every host ingestion
  point (account record, `--host`, VS Code state) validates through it, not just the
  fetch site. *Rationale:* centralizes the security control at one reviewable seam
  (§10.4 DRY, §10.8 Hexagonal); mirrors go-gh `NormalizeHostname`/`IsTenancy`
  [ref 21]; closes the exfil at the boundary rather than patching one call site.
- **D-001-03 — Allowlist is GHEC-only, fail-closed.** Accept exactly `github.com`
  or a collapsed `*.ghe.com` tenancy host; any other host falls back to
  `api.github.com` and shows no quota. *Rationale:* smallest safe surface; legit
  GHEC users are accepted (so no per-host token-binding mitigation is needed now);
  GHES is an additive opt-in for a later spec.
- **D-001-04 — Settings writes use a surgical JSONC edit, with `.bak`+rewrite as a
  parse-ambiguity fallback.** Locate and replace only the `statusLine` /
  `footer.showCustom` keys, preserving all comments and trailing commas
  byte-for-byte; if the JSONC cannot be unambiguously located, write a `.bak`,
  full-rewrite, and warn. *Rationale:* "never break the host's file" for a
  user-owned config the tool does not own; the fallback bounds the exotic-JSONC
  risk (§11) without abandoning the no-data-loss bar.
- **D-001-05 — One unified `parseQuotaSnapshot` serves both live and cache paths.**
  Treat `entitlement === -1` as unlimited and read `remaining` plus the
  `quota_remaining`/`quotaRemaining` aliases in the single parser. *Rationale:*
  eliminates the live-vs-cache drift (`∞` vs garbage bar) at its root — one source
  of truth (§10.4 DRY) instead of two copies that re-drift.
- **D-001-06 — Deterministic time and safe flag/config parsing.** `formatReset`
  uses UTC getters and an explicit label; `readFlagValue` rejects a value that
  begins with `-`; `copilotline-config`'s `JSON.parse` is guarded to distinguish
  empty from malformed and surface it rather than crashing render. *Rationale:*
  machine-independent, trustworthy output; a malformed user config must never take
  down the statusline.
- **D-001-07 — The render path is cache-only with account resolved once.**
  `selectCopilotAccount` is computed a single time in `runRender` (memoized,
  short-circuiting) and threaded down; render reads only the cache (zero foreground
  `gh`/`sqlite3`), and `getGitInfo` collapses to a single `git` spawn. The
  background-refresh debounce (correctly gating before spawn,
  `copilot-usage.ts:207`) is preserved. *Rationale:* per-turn repaint demands no
  blocking subprocess work; the binding gate is **structural** (call-count +
  spawn-count assertions), which is deterministic and testable — unlike a
  machine-dependent wall-clock number.
- **D-001-08 — `--capture` is removed (hard delete, no shim).** Delete the flag and
  its payload-named write path (`src/cli.ts:131`); CHANGELOG documents the breaking
  CLI change (Hard Rule §13.3); schema discovery is served by the documented stdin
  payload [ref 2]. *Rationale:* a niche debug flag with an arbitrary-write footgun;
  removing the surface beats paying to harden it.
- **D-001-09 — No new runtime dependency; hexagonal seam preserved.** New logic
  lands in infrastructure (`host-policy.ts`); domain snapshot types stay pure
  render-time data; width/parse helpers are zero-dep. *Rationale:* the zero-dep
  posture is a stated product invariant (§10.8).
- **D-001-10 — Every blocker is proven failing-test-first (TDD).** Injected
  `fetchImpl` records the URL (exfil); byte-compare proves comment survival;
  call-count + spawn assertions prove the render path; live==cache parity covers
  unlimited/aliased; forced-`TZ` proves reset determinism. The false-confidence
  test (`configure-status-line.test.ts:28`) is rewritten to assert the real
  contract. *Rationale:* §10.5 TDD — the gate is a RED test before the fix, not a
  post-hoc assertion of behavior the code never delivered.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|:---:|:---:|------------|
| Host allowlist breaks a legitimate GHEC/tenancy user | Med | Med | Mirror go-gh `NormalizeHostname`/`IsTenancy` precisely [ref 21]; add `*.ghe.com` tests; GHEC hosts are accepted so no legitimate quota user is cut off |
| Surgical settings edit mishandles an exotic JSONC file | Med | High | Property-test the editor against fuzzed JSONC; fall back to `.bak`+full-rewrite+warn on parse ambiguity (D-001-04) |
| Cache-only render shows stale quota immediately after login | High | Low | First render triggers the background refresh; an explicit staleness affordance is M4 (deferred), so interim staleness is bounded by the existing 60 s TTL |
| Removing `--capture` breaks a script that depended on it | Low | Low | Niche flag; CHANGELOG documents the removal; stdin payload is documented for schema discovery [ref 2] |
| `formatReset` UTC change alters the displayed reset day for some users | Low | Low | This is the correct, machine-independent behavior; the value is labeled and the change is noted in CHANGELOG |

## Architecture

The fix preserves the hexagonal seam and the zero-dependency constraint. Only one
new module is introduced in this scope; the rest are surgical edits to existing
files.

- **`src/infrastructure/host-policy.ts` (new)** — the single allowlist boundary
  (D-001-02/03). `normalizeHost`/`usageApiBaseForHost` move here and gain the
  GHEC-only allowlist; validation runs at every host ingestion point.
- **`src/infrastructure/copilot-settings-file.ts`** — surgical JSONC editor with
  `.bak` fallback (D-001-04), replacing the destructive `parse`→`stringify`
  round-trip.
- **`src/cli.ts`** — `selectCopilotAccount` computed once in `runRender` and
  threaded down (D-001-07); `--capture` and its write path deleted (D-001-08);
  `readFlagValue` rejects flag-shaped values (D-001-06).
- **`src/infrastructure/copilot-usage.ts` / `src/application/render-status-line.ts`**
  — render path becomes cache-only; the two drifted quota parsers collapse into one
  shared `parseQuotaSnapshot` (D-001-05); `formatReset` → UTC + label (D-001-06).
- **`src/infrastructure/git-info.ts`** — collapse the double `git` spawn to one
  (D-001-07).
- **`src/infrastructure/copilotline-config.ts`** — guard `JSON.parse` (D-001-06).

```
                          stdin (Copilot JSON, untrusted)
                                     │
 src/cli.ts runRender ── selectAccount() ONCE ──┐
       │                                         │ (memoized, short-circuit)
       ├─ quotaForRender(cache) ─────────────────┘   reads only; never spawns
       ├─ refreshInBackground() ── detached child ── host-policy allowlist ─▶ api.github.com
       └─ buildStatusSnapshot ─▶ formatStatusLine ─▶ stdout
```

## Milestones

- **M0 — Safety & data integrity.** Host allowlist in `host-policy.ts`
  (D-001-02/03); comment-preserving surgical settings write (D-001-04); rewrite the
  false-confidence test (D-001-10). *Gate:* malicious payload host never receives
  the token (injected-`fetchImpl` test); a comment-bearing settings file survives
  install+uninstall byte-identical except managed keys; the JSONC test now fails if
  comments are dropped.
- **M1 — Render performance.** Resolve the account once + memoize + short-circuit;
  make render cache-only; single `git` spawn (D-001-07). *Gate:* one
  `selectCopilotAccount` call per render (assertion/trace); zero foreground
  `gh`/`sqlite3` spawns on the render path; a documented render-time budget tracked
  against a measured baseline.
- **M2 — Correctness hardening.** Unify `parseQuotaSnapshot` (D-001-05);
  `formatReset` → UTC + label; `readFlagValue` rejects flag-as-value; guard the
  config `JSON.parse`; remove `--capture` (D-001-06/08). *Gate:* unlimited
  (`entitlement:-1`) and aliased quota render identically from live and cache
  (test); deterministic reset rendering under a forced `TZ` (test).

## Definition of Done

1. A payload with `{"account":{"host":"attacker.tld"}}` causes no network request
   to any host outside the allowlist, proven by an injected-`fetchImpl` test.
2. `install` then `uninstall` on a `settings.json` containing comments leaves all
   comments intact (surgical edit; `.bak`+warn only on parse ambiguity).
3. A single `selectCopilotAccount` invocation per render; zero foreground
   `gh`/`sqlite3`/second-`git` spawns on the render path.
4. Live and cached quota render identically for the unlimited and aliased cases.
5. `formatReset` is deterministic under a forced `TZ`; `readFlagValue` rejects a
   flag-shaped value; a malformed config never crashes render.
6. `--capture` and its write path are removed; CHANGELOG documents the breaking change.
7. The false-confidence JSONC test asserts comment survival; the load-bearing units
   exercised by M0–M2 have tests.
8. `bun run lint` (tsc strict), `bun test`, gitleaks, and CodeQL are green; CHANGELOG
   documents the settings-write behavioral change and the `--capture` removal.

## References

- doc: .ai-engineering/specs/drafts/copilotline-statusline-excellence-brief.md
- doc: reports/code-review/00-summary.md
- doc: SECURITY.md
- doc: https://github.com/cli/go-gh — `pkg/auth` `NormalizeHostname`/`IsTenancy` [ref 21]
- doc: https://no-color.org — NO_COLOR specification [ref 12] (informs the deferred M3 spec)

## Open Questions

- **M1 render wall-time budget.** The *binding* gate is structural (one
  `selectCopilotAccount` call, zero render-path spawns); the concrete p50/p95
  wall-clock numbers are documented-and-tracked, to be fixed in `/ai-plan` against a
  measured baseline rather than guessed here. Non-blocking for approval.
