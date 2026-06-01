---
plan: plan-001
spec: spec-001
title: copilotline Statusline Excellence — Release Blockers (M0–M2)
status: draft
pipeline: full
execution_route:
  version: 1
  spec: spec-001
  executor: autopilot
  automation: multi-wave
  concern_count: 3
  estimated_files: 16
  reason: "Three independent concerns (security, performance, correctness) across ~16 files including 2 new infrastructure modules and ~6 test files, with TDD RED/GREEN pairs and cross-file contention on copilot-usage.ts — multi-wave decomposition fits /ai-autopilot. /ai-build is viable if the operator prefers a single sequential wave."
  safe_next_command: "/ai-autopilot"
---

# Plan — spec-001 copilotline Statusline Excellence (M0–M2)

Contract for execution. **HARD GATE:** operator approves this plan before any
build runs (§10.6 SDD). Patch hunks are provided for mechanical edits (cheap-tier
dispatch); judgment edits carry prose only.

## Pipeline

`full` — new module + multi-file refactor across >5 files, 3 concerns.

## Design

**Routing: skipped (no in-scope UI surface).** M0–M2 are backend/logic
release-blockers; the terminal-UI design system, palette, glyphs, and motion are
M3–M4, explicitly deferred (spec Non-Goals). No new user-facing visual artifact is
introduced in this scope. `formatReset` gains a `UTC` label (correctness, not
design). Design routing resumes in the deferred M3–M6 follow-up spec.

## Architecture

**Pattern: Hexagonal (existing) — additive infrastructure modules, no new domain
ports.** Two new pure infrastructure modules absorb cross-cutting concerns so the
domain stays untouched and `cli.ts` sheds responsibility:

- `src/infrastructure/host-policy.ts` (new) — single allowlist boundary; owns
  `normalizeHost` + `usageApiBaseForHost` + GHEC allowlist (D-001-02/03).
- `src/infrastructure/quota-snapshot.ts` (new) — single `parseQuotaSnapshot`
  consumed by both the live (`copilot-usage.ts`) and payload (`render-status-line.ts`)
  paths (D-001-05).

No new domain types (reuses `QuotaSnapshot` from `domain/status-line.ts`). Import
direction stays application→infrastructure→domain, consistent with the existing
`render-status-line.ts` → `infrastructure/value-reader.ts` dependency.

**File-contention note (sequencing constraint):** `copilot-usage.ts` is touched by
T-02 (import host-policy), T-06 (signature threading), and T-09 (parser unify).
Execute those three in order on that file (or let autopilot serialize the wave) to
avoid merge churn.

---

## Phase M0 — Safety & data integrity (release-blockers)

Gate: a malicious payload host never receives the token (test); a comment-bearing
settings file survives install+uninstall (test); the JSONC test now fails if
comments are dropped.

### T-01 — RED: token never sent to a non-allowlisted host
- Agent: build
- Files: `tests/host-policy.test.ts` (new)
- Principles applied: §10.5 TDD, §10.1 KISS
- Patch (deterministic): — (judgment: inject a `fetchImpl` that records every
  requested URL; drive `resolveTokenForAccount`/`loginForToken` with a payload
  account `{ login: "victim", host: "attacker.tld" }`; assert NO recorded URL host
  matches `api.attacker.tld`). Must fail against current `usageApiBaseForHost:288`.
- Gate: test present and RED.

### T-02 — GREEN: host-policy allowlist boundary
- Agent: build
- Files: `src/infrastructure/host-policy.ts` (new); `src/infrastructure/copilot-account.ts:282-289` (move `normalizeHost`/`usageApiBaseForHost` out, re-export for callers); `src/infrastructure/copilot-usage.ts:7-15` (import from host-policy)
- Principles applied: §10.8 Hexagonal Architecture, §10.4 DRY
- Patch (deterministic): — (judgment) New module exposes:
  `normalizeHost(host)` (scheme/slash strip, unchanged syntactic normalizer);
  `isAllowedHost(host)` → true for `github.com` and any collapsed `<label>.ghe.com`;
  `resolveAllowedHost(host)` → the allowlisted host or `"github.com"` (fail-closed);
  `usageApiBaseForHost(host)` builds `https://api.<resolveAllowedHost(host)>`.
  GHES (`api.enterprise.githubcopilot.com`) is NOT allowlisted (D-001-03). Both
  token-bearing fetches already route through `usageApiBaseForHost`, so the single
  chokepoint closes the exfil; `copilot-account.ts` re-exports the moved symbols so
  the ~9 existing `normalizeHost` call sites keep compiling.
- Gate: T-01 GREEN; `tests/copilot-account.test.ts` stays green; add a GHEC
  (`*.ghe.com`) accept-case test.

### T-03 — RED: settings comments survive install+uninstall
- Agent: build
- Files: `tests/configure-status-line.test.ts:28` (rewrite the false-confidence test) + new round-trip case
- Principles applied: §10.5 TDD
- Patch (deterministic): — (judgment) Rewrite the `"accepts JSONC comments"` test to
  assert the `// keep me` comment substring **survives** in the written output (not
  just the parsed value); add an install→uninstall round-trip asserting the comment
  is byte-present after both. Must fail against the current
  `parseSettings`→`JSON.stringify` round-trip (`copilot-settings-file.ts:43`).
- Gate: test RED.

### T-04 — GREEN: surgical JSONC settings editor (+ .bak fallback)
- Agent: build
- Files: `src/infrastructure/copilot-settings-file.ts:33-44` (`applySettingsMutations`); callers `src/cli.ts:163-179` (install), `src/cli.ts:181-197` (uninstall)
- Principles applied: §10.7 Clean Code, §10.1 KISS
- Patch (deterministic): — (judgment) Replace the parse→stringify rewrite with a
  surgical editor that locates and rewrites only the `statusLine` / `footer.showCustom`
  spans in the raw JSONC text, preserving all comments and trailing commas; on parse
  ambiguity (cannot uniquely locate the span) write a `<path>.bak`, full-rewrite, and
  emit a warning to stderr (D-001-04). Keep `writeSettingsText`'s atomic temp+rename.
- Gate: T-03 GREEN; `"removes statusLine"` test green.

---

## Phase M1 — Render performance

Gate: one `selectCopilotAccount` call per render (spy assertion); zero foreground
`gh`/`sqlite3` spawns on the render path; single `git` spawn per in-repo render.

### T-05 — RED: account resolved once; render path spawns nothing
- Agent: build
- Files: `tests/cli.test.ts` (or `tests/render-status-line.test.ts`)
- Principles applied: §10.5 TDD
- Patch (deterministic): — (judgment) Inject a counting spy for account selection
  through the render DI seam and assert it is invoked exactly once; assert no
  `gh`/`sqlite3` child is spawned on the `render` path (cache-only). Must fail
  against current `runRender` (3 calls: `quotaForRender:187`,
  `refreshCopilotUsageInBackground:206`, `shouldRefreshUsageCache:196`).
- Gate: test RED.

### T-06 — GREEN: thread the resolved account through the render path
- Agent: build
- Files: `src/cli.ts:125-161` (`runRender`); `src/infrastructure/copilot-usage.ts:182-222` (`quotaForRender`, `shouldRefreshUsageCache`, `refreshCopilotUsageInBackground`)
- Principles applied: §10.3 SOLID (dependency inversion), §10.4 DRY
- Patch (deterministic): — (judgment) `runRender` resolves
  `selectCopilotAccount(parsed).selected` once; pass the resolved account into
  `quotaForRender(account, …)`, `shouldRefreshUsageCache(account, …)`, and
  `refreshCopilotUsageInBackground(cmd, account, …)` (add an optional pre-resolved
  account param to each, memoizing the legacy `input`-based path). Render reads only
  the cache; the pre-spawn debounce (`copilot-usage.ts:207`) is preserved.
- Gate: T-05 GREEN; `tests/copilot-usage.test.ts` green.

### T-07 — git-info single spawn (RED + GREEN)
- Agent: build
- Files: `tests/git-info.test.ts`; `src/infrastructure/git-info.ts:19-37`
- Principles applied: §10.5 TDD, §10.1 KISS
- Patch (deterministic): — (judgment) RED: spy `spawnSync('git', …)` and assert one
  call per `getGitInfo`. GREEN: collapse to a single `git status --porcelain=v2
  --branch` spawn for branch+dirty; derive `worktree` without a second spawn
  (filesystem probe of the resolved git dir) — accept best-effort worktree under the
  one-spawn constraint, documented in the test. Preserve `parseGitStatus` branch/dirty
  semantics.
- Gate: one `spawnSync('git')` per `getGitInfo`; branch/dirty cases stay green.

---

## Phase M2 — Correctness hardening

Gate: unlimited (`entitlement:-1`) and aliased quota render identically from live and
cache (test); deterministic reset rendering under a forced `TZ` (test).

### T-08 — RED: live==cache quota parity (unlimited + aliased)
- Agent: build
- Files: `tests/quota-snapshot.test.ts` (new)
- Principles applied: §10.5 TDD
- Patch (deterministic): — (judgment) Feed one GitHub snapshot with `entitlement:-1`
  and only `quota_remaining` (alias) through both the live parser
  (`copilot-usage.ts:322`) and the cache/payload parser (`render-status-line.ts:478`
  + `parseUsageCache:399`); assert identical `QuotaSnapshot`. Must fail (live treats
  `-1` as unlimited + reads aliases; cache path uses `unlimited ?? false`, no aliases).
- Gate: test RED.

### T-09 — GREEN: one shared `parseQuotaSnapshot`
- Agent: build
- Files: `src/infrastructure/quota-snapshot.ts` (new); `src/infrastructure/copilot-usage.ts:322-362` (delete local `quotaFromSnapshot`, import shared) + `:364-408` (`parseUsageCache` uses shared semantics for `unlimited`/aliases); `src/application/render-status-line.ts:478-528` (delete local `quotaFromSnapshot`, import shared)
- Principles applied: §10.4 DRY, §10.8 Hexagonal Architecture
- Patch (deterministic): — (judgment) Extract the superset parser: `unlimited =
  readBoolean(...) ?? entitlement === -1`; `remaining = remaining ?? quota_remaining
  ?? quotaRemaining`; shared percent/used/overage/reset logic. Both call sites import
  it; cache read-back aligns to the same `unlimited` rule.
- Gate: T-08 GREEN; existing `copilot-usage` + `render-status-line` quota tests green.

### T-10 — RED: deterministic, labeled reset time
- Agent: build
- Files: `tests/render-status-line.test.ts`
- Principles applied: §10.5 TDD
- Patch (deterministic): — (judgment) Set `process.env.TZ` to two different zones,
  render the same `resetAt`, assert identical output containing `UTC`. Must fail
  against current local-getter `formatReset`.
- Gate: test RED.

### T-11 — GREEN: formatReset → UTC + label
- Agent: build
- Files: `src/application/render-status-line.ts:838-843`
- Principles applied: §10.7 Clean Code
- Patch (deterministic):
```diff
@@ function formatReset @@
   const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
-  const month = months[date.getMonth()] ?? "";
-  const day = date.getDate();
-  const hour = String(date.getHours()).padStart(2, "0");
-  const minute = String(date.getMinutes()).padStart(2, "0");
-  return `${style.dim}⟳${RESET} ${palette.white}${month} ${day} ${hour}:${minute}${RESET}`;
+  const month = months[date.getUTCMonth()] ?? "";
+  const day = date.getUTCDate();
+  const hour = String(date.getUTCHours()).padStart(2, "0");
+  const minute = String(date.getUTCMinutes()).padStart(2, "0");
+  return `${style.dim}⟳${RESET} ${palette.white}${month} ${day} ${hour}:${minute} UTC${RESET}`;
```
- Gate: T-10 GREEN.

### T-12 — RED: readFlagValue rejects a flag-shaped value
- Agent: build
- Files: `tests/cli.test.ts`; export `readFlagValue` from `src/cli.ts` for unit test
- Principles applied: §10.5 TDD
- Patch (deterministic): — (judgment) Assert `readFlagValue(["--login","--host","x"],
  "--login")` returns `undefined` (not `"--host"`). Must fail against current
  `cli.ts:682`.
- Gate: test RED.

### T-13 — GREEN: readFlagValue guard
- Agent: build
- Files: `src/cli.ts:676-683`
- Principles applied: §10.7 Clean Code
- Patch (deterministic):
```diff
@@ function readFlagValue @@
   const index = args.indexOf(flag);
   if (index === -1) {
     return undefined;
   }
-
-  return args[index + 1];
+
+  const value = args[index + 1];
+  return value === undefined || value.startsWith("-") ? undefined : value;
```
- Gate: T-12 GREEN; `refresh --login`/`--host` parsing unaffected.

### T-14 — GREEN: remove --capture (hard delete)
- Agent: build
- Files: `src/cli.ts:1` (import), `src/cli.ts:52` (HELP), `src/cli.ts:126-132` (`runRender`)
- Principles applied: §10.1 KISS, Hard Rule §13.3 (hard delete, no shim)
- Patch (deterministic):
```diff
@@ src/cli.ts top imports @@
-import { writeFileSync } from "node:fs";
 import { spawnSync } from "node:child_process";
```
```diff
@@ HELP block @@
-  copilotline render --capture <path>     Save the raw stdin payload for schema discovery
   copilotline refresh                     Fetch and cache Copilot usage from GitHub
```
```diff
@@ async function runRender @@
   const asJson = args.includes("--json");
-  const capturePath = readFlagValue(args, "--capture");
   const stdin = await readStandardInput();
-
-  if (capturePath && !stdin.truncated) {
-    writeFileSync(capturePath, stdin.raw, "utf-8");
-  }
 
   const parsed = safeParse(stdin.raw);
```
  Note: remove the `writeFileSync` import only if no other use remains in `cli.ts`
  (tsc strict will flag an unused import — confirm before deleting the line).
- Gate: `render --capture x` writes no file; tsc strict green; T-16 documents removal.

### T-15 — GREEN: guard copilotline-config JSON.parse
- Agent: build
- Files: `src/infrastructure/copilotline-config.ts:26`; `tests/` (new malformed-config case)
- Principles applied: §10.7 Clean Code (fail safe at the source, not per-caller)
- Patch (deterministic):
```diff
@@ export function readCopilotlineConfig @@
-  const record = asRecord(JSON.parse(readFileSync(path, "utf-8")) as unknown);
+  let parsed: unknown;
+  try {
+    parsed = JSON.parse(readFileSync(path, "utf-8"));
+  } catch {
+    return defaultCopilotlineConfig();
+  }
+  const record = asRecord(parsed);
```
- Gate: malformed config returns defaults (does not throw); existing config tests green.

---

## Phase M3-docs — Changelog (breaking/behavioral changes)

### T-16 — CHANGELOG entries
- Agent: build
- Files: `CHANGELOG.md`
- Principles applied: Hard Rule §13.3 (document breakage), §13.6 (Conventional Commits)
- Patch (deterministic): — (judgment) Add entries: (a) settings writes now preserve
  JSONC comments (prior versions stripped them); (b) `--capture` flag removed
  (breaking CLI change); (c) reset time now rendered in UTC with label.
- Gate: CHANGELOG names all three changes.

---

## Phase V — Quality gate (terminal)

### T-17 — Verify the full changeset
- Agent: verify
- Files: (read-only) entire spec-001 changeset
- Principles applied: §10.5 TDD, §10.4 Goal-Driven Execution
- Patch (deterministic): —
- Gate: `bun run lint` (tsc strict) green; `bun test` green (all RED→GREEN pairs now
  pass); `gitleaks` clean; semgrep/CodeQL clean; the previously-untested units exercised
  by M0–M2 (`host-policy`, surgical settings editor, unified `parseQuotaSnapshot`,
  `git-info` single-spawn, config guard) have coverage. Matches spec Definition of Done 1–8.

---

## Task DAG (dependencies)

- TDD pairs: T-01→T-02, T-03→T-04, T-05→T-06, T-08→T-09, T-10→T-11, T-12→T-13.
- T-07 standalone (RED+GREEN in one block). T-14, T-15 standalone GREEN+test.
- `copilot-usage.ts` serialization: T-02 → T-06 → T-09 (same-file contention).
- T-16 after T-04 + T-11 + T-14 (the documented changes exist).
- T-17 last (gates everything).

## Suggested waves (autopilot)

1. **Wave 1 (parallel):** T-01, T-03, T-05, T-08, T-10, T-12 (all RED tests — independent files).
2. **Wave 2:** T-02 → T-06 → T-09 (serialized on copilot-usage.ts); in parallel T-04, T-07, T-11, T-13, T-14, T-15.
3. **Wave 3:** T-16 (CHANGELOG).
4. **Wave 4:** T-17 (terminal verify).

---

**safe_next_command: `/ai-autopilot`** — operator approves this plan, then runs it.
(`/ai-build` is acceptable for a single sequential wave if preferred.)
