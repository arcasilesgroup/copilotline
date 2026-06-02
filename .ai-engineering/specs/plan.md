---
execution_route:
  version: 1
  spec: spec-004
  executor: build
  automation: autonomous
  concern_count: 1
  estimated_files: 3
  reason: "Single-concern security hotfix at the runRender/safeParse boundary in src/cli.ts plus its tests and a CHANGELOG note. No domain changes, no parallel waves, fully automatable in-env (no vhs/manual steps). Well under the autopilot threshold."
  safe_next_command: "/ai-build"
spec: spec-004
slug: render-empty-stdin-pii
title: Guard render against empty/invalid stdin leaking the real account — execution plan
status: approved
pipeline: hotfix
created: 2026-06-02
---

# Plan — spec-004 render empty/invalid stdin PII guard

## Code facts (read-only exploration, 2026-06-02)

- `runRender(args)` — `src/cli.ts:129-165`: reads stdin → `safeParse` → then
  **unconditionally** `selectCopilotAccount(parsed).selected` (`:137`),
  `quotaForRender(account)` (`:138`), `refreshCopilotUsageInBackground(...)`
  (`:139`), `buildStatusSnapshot(parsed, …)`; then `--json` branch (`:147-161`)
  or `formatStatusLine` (`:163`). Both output paths return 0.
- `safeParse(raw)` — `src/cli.ts:735-745`: returns `{}` for BOTH `raw.trim()===""`
  and `JSON.parse` failure → the collapse that erases the empty-vs-payload signal.
- Bare invocation — `src/cli.ts:112-119`: non-TTY stdin → `runRender([])` (same path).
- `modelSegment` — `src/application/render-status-line.ts:681`: `label?.trim() ||
  "Copilot"` (cosmetic fallback, OUT OF SCOPE per spec Non-Goals).
- Quota ternary — `render-status-line.ts:162`: `hasQuotaData(inputQuota) ?
  inputQuota : (deps.quota ?? emptyQuota())` → empty payload routes to the live
  `deps.quota` (host cache).
- Tests — `tests/cli.test.ts`: `run()` helper (`:13-28`) hardcodes
  `COPILOTLINE_USAGE:"0", COPILOTLINE_ACCOUNT:"0"` (masks the bug). Tests build
  `dist/cli.js` in `beforeAll`. `tests/helpers.js` exposes
  `createTempDir`/`cleanupTempDir`. Account resolution order
  (`copilot-account.ts`): payload → `~/.copilot/config.json` → VS Code sqlite3 →
  `gh` (first non-manual candidate wins → a fixture `COPILOT_HOME` config short-
  circuits before VS Code/gh).

## Design

`--skip-design` (no UI). Output contract decided in spec-004 interrogation:
empty/invalid stdin → stdout placeholder `copilotline` (exit 0, zero host data);
invalid JSON additionally writes one diagnostic line to **stderr**; `--json`
emits a neutral envelope with `data: null`.

## Architecture

`ad-hoc` — guard clause at the application/CLI boundary (`runRender`). Hexagonal
domain (`render-status-line`, `copilot-account`, `copilot-usage`) is **untouched**;
the fix is purely "do not call the host readers when there is no payload".

## TDD

RED test task (T-1) precedes the GREEN implementation (T-2/T-3): the empty/invalid
no-leak tests must fail against current `main`, then pass after the guard.

---

## Phase 1 — RED

### T-1 — Failing tests: empty/invalid stdin must not leak the host account
- Agent: build
- Files: `tests/cli.test.ts` (new cases + a non-masking runner), uses `tests/helpers.js` `createTempDir`
- Principles applied: §10.5 TDD, §10.7 Clean Code
- Patch (deterministic): — (judgment: fixture setup + assertions)
- Detail: Add tests that DO NOT use the bug-masking env. Create a temp
  `COPILOT_HOME` fixture with `config.json`
  `{"lastLoggedInUser":{"login":"octocat","host":"github.com"}}` and an octocat
  usage-cache, then spawn `node dist/cli.js render` with env
  `{ COPILOTLINE_ACCOUNT: "1", COPILOTLINE_USAGE: "1", COPILOT_HOME: <fixture> }`
  (detection ENABLED, pointed at the fixture so a leak would surface "octocat"):
  - empty stdin (`input: ""`): assert `status === 0`, `stdout.trim() === "copilotline"`,
    and `stdout` does NOT contain `octocat`, `195`, `(main)`, or `credits`.
  - invalid stdin (`input: "not json"`): same stdout assertions, plus
    `stderr` matches `/invalid/i`.
  - `render --json` empty: assert `status === 0`, parsed JSON has `data === null`
    and the string `octocat` is absent.
  - regression GOLDEN: a valid payload (`{model:{displayName:"GPT-5.4"},contextWindow:{usedPercent:12}}`)
    still renders `GPT-5.4` + `12%` (unchanged) — using the existing masked `run()` is fine here.
- Gate: the three empty/invalid tests FAIL against current `src/cli.ts` (octocat
  leaks); the golden passes. (Build agent runs `bun test` to confirm RED.)

## Phase 2 — GREEN

### T-2 — Discriminate empty vs invalid vs payload in `safeParse`
- Agent: build
- Files: `src/cli.ts:735-745`
- Principles applied: §10.3 SOLID (single responsibility at the boundary), §10.7 Clean Code
- Patch (deterministic):
  ```diff
  -function safeParse(raw: string): unknown {
  -  if (raw.trim() === "") {
  -    return {};
  -  }
  -
  -  try {
  -    return JSON.parse(raw) as unknown;
  -  } catch {
  -    return {};
  -  }
  -}
  +type ParsedStdin =
  +  | { kind: "payload"; value: unknown }
  +  | { kind: "empty" }
  +  | { kind: "invalid" };
  +
  +function safeParse(raw: string): ParsedStdin {
  +  if (raw.trim() === "") {
  +    return { kind: "empty" };
  +  }
  +
  +  try {
  +    return { kind: "payload", value: JSON.parse(raw) as unknown };
  +  } catch {
  +    return { kind: "invalid" };
  +  }
  +}
  ```
- Gate: `tsc --noEmit` clean (callers updated in T-3).

### T-3 — Guard `runRender`: no host reads without a payload
- Agent: build
- Files: `src/cli.ts:129-165`
- Principles applied: §10.3 SOLID, §10.7 Clean Code, §10.2 YAGNI
- Patch (deterministic):
  ```diff
     const parsed = safeParse(stdin.raw);
  -  // Resolve the account once for the whole render; thread it into the
  -  // cache-only readers so the render path never re-detects (no gh/sqlite3
  -  // foreground spawns).
  -  const account = selectCopilotAccount(parsed).selected;
  -  const usage = quotaForRender(account);
  -  refreshCopilotUsageInBackground(statusLineCommand(), account);
  -  const usageConfig = readCopilotlineConfig().usage;
  -  const snapshot = buildStatusSnapshot(parsed, {
  -    now: () => Date.now(),
  -    getGitInfo,
  -    quota: usage,
  -  });
  +
  +  // No trustworthy payload (empty or unparseable stdin): never detect or read
  +  // the host Copilot account/quota — emit a neutral, account-free placeholder
  +  // and exit 0. (spec-004 — PII guard.)
  +  if (parsed.kind !== "payload") {
  +    if (parsed.kind === "invalid") {
  +      process.stderr.write("copilotline: ignoring invalid status JSON on stdin\n");
  +    }
  +    if (asJson) {
  +      process.stdout.write(
  +        `${JSON.stringify(
  +          {
  +            version: VERSION,
  +            generated_at: new Date().toISOString(),
  +            truncated_input: stdin.truncated,
  +            data: null,
  +          },
  +          null,
  +          2,
  +        )}\n`,
  +      );
  +    } else {
  +      process.stdout.write("copilotline\n");
  +    }
  +    return 0;
  +  }
  +
  +  const payload = parsed.value;
  +  const account = selectCopilotAccount(payload).selected;
  +  const usage = quotaForRender(account);
  +  refreshCopilotUsageInBackground(statusLineCommand(), account);
  +  const usageConfig = readCopilotlineConfig().usage;
  +  const snapshot = buildStatusSnapshot(payload, {
  +    now: () => Date.now(),
  +    getGitInfo,
  +    quota: usage,
  +  });
  ```
- Gate: T-1's empty/invalid tests now PASS; golden still passes; `tsc --noEmit` clean.

## Phase 3 — Document + verify

### T-4 — CHANGELOG entry
- Agent: build
- Files: `CHANGELOG.md`
- Principles applied: §10.7 Clean Code, CLAUDE.md §13 rule 3 (document behavior change)
- Patch (deterministic): — (judgment: changelog prose under `## [Unreleased]`)
- Detail: `Fixed` — `copilotline render` no longer reads or renders the host
  Copilot account/quota when stdin is empty or not valid JSON; it now prints a
  neutral `copilotline` placeholder (exit 0) and, for invalid JSON, a stderr
  diagnostic. Note the `render --json` empty/invalid envelope now has `data: null`.
- Gate: CHANGELOG parses; entry present.

### T-5 — Terminal verification
- Agent: verify
- Files: repo (read-only)
- Principles applied: §10.5 TDD, §10.6 SDD
- Patch (deterministic): —
- Detail: `bun test` (all green incl. new no-leak tests), `tsc --noEmit` clean.
  Manual repro evidence: `printf '' | node dist/cli.js render` → exactly
  `copilotline`, exit 0, no login/quota; `printf 'x' | node dist/cli.js render`
  → `copilotline` + stderr diagnostic; a valid payload still renders the full
  ribbon. Confirm no `--capture`/behavior regressions elsewhere.
- Gate: all pass; report evidence. Maps AC-1..AC-7.

---

## Phase ordering

T-1 (RED) → T-2 + T-3 (GREEN, same file `src/cli.ts`; T-2 then T-3) → T-4 (CHANGELOG) → T-5 (verify). All automatable by `/ai-build`; no manual steps.

## Quality Remediation

used: true
max_attempts: 1
Finding (review, HIGH, empirically reproduced): `safeParse` classified ANY
`JSON.parse` success as `payload`, so a valid-but-non-object JSON (`null`, `5`,
`true`, `[]`, `"x"`, whitespace-padded primitive) bypassed the guard and still
leaked the host account (`printf '5' | render` → `…octocat credits 42% 84/200`).
Same leak class spec-004 must close. Mechanical, finding-scoped fix: gate the
`payload` kind on the domain's own `asRecord(value)` (value-reader.ts) so a
parsed non-object is classified `invalid` (guarded branch, no host read). Plus
F2: add no-leak tests for `null`/`[]`/`5`.

## Quality Outcome

Initial assessment: verify 98/100 PASS, but adversarial review found **1 HIGH**
(F1: non-object JSON — `null`/`5`/`true`/`[]`/`"x"`/whitespace-primitive — bypassed
the `payload` discriminant and empirically leaked the octocat fixture account).
One bounded remediation pass: gated `safeParse`'s `payload` kind on `asRecord(value)`
so a parsed non-object routes to `invalid` (guarded). Added 4 no-leak tests.
**Final reassessment → 0 blockers / 0 criticals / 0 highs → PASS.**
- Re-review (adversarial, built + ran the binary): F1 closed across the full
  non-object/empty/garbage matrix; guard ordering + all entry points + `--json`
  confirmed; golden unregressed.
- Deterministic gates: `bun test` 93 pass / 0 fail; `tsc --noEmit` clean;
  `gitleaks protect --staged` clean; source scope = `src/cli.ts` only.
- Known boundary (INFO, by-design per D-004-01): a literal `{}` / sparse object
  still takes the payload branch and reads the host account — outside the
  accidental empty/garbage leak vector this spec closes (Approach C, requiring
  specific keys, was explicitly rejected). Candidate future hardening, not a blocker.

final_reassessment: pass

## Acceptance criteria mapping

AC-1/AC-2/AC-4 → T-1 + T-3. AC-3 (golden) → T-1 + T-3. AC-5 (bare invocation) → shares the guarded `runRender` (T-3). AC-6 (no masking) → T-1 fixture design. AC-7 → T-5.
