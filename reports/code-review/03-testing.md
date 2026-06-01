# Testing Review — copilotline

**Health score: 50/100**
Arithmetic: 100 − 25 (1 Critical: false-confidence JSONC test masking confirmed data-loss bug) − 36 (6 High × −6: value-reader guard untested, command-tools probe untested, copilot-usage fetch/cache/TTL/debounce/bg-spawn untested, copilotline-config untested + uncaught-throw path, formatReset TZ assertion gap masking a real bug, doctor-report presentation untested) − 6 (1 Medium: no `--coverage` enforcement) − 2 (1 Low: `--capture` truncated silent-skip branch untested) = 50.

**Verdict:** Solid pure-function coverage on the render/parse core, but every untrusted-input guard, the JSONC writer, the token+cache subsystem, and the doctor probe layer are untested — and one passing test actively certifies behavior the code does not deliver.

## Findings
| # | Severity | Location | Issue | Recommendation |
|---|----------|----------|-------|----------------|
| 1 | Critical | tests/configure-status-line.test.ts:28-45 | "accepts JSONC comments and keeps unrelated settings" asserts only that the `theme` *value* survives, never that the `// keep me` comment survives. `applySettingsMutations` strips all comments. The test name claims comment fidelity and gives false confidence on a real data-loss bug. | Rename to reflect reality, and add a separate failing/xfail test asserting `expect(updated).toContain("// keep me")`, or fix the writer to a comment-preserving edit. |
| 2 | High | value-reader.ts:3-67 | Zero tests. This is the DRY guard (`asRecord`/`pickUnknown`/`pickString`/`pickNumber`) every untrusted-JSON path funnels through. A regression here silently corrupts render, account, usage, and config parsing at once. | Unit tests: `asRecord` rejects arrays/null/primitives; `pickUnknown` traverses nested paths, falls through; `pickString` rejects empty/whitespace; `pickNumber` rejects NaN/Infinity and string-numbers. |
| 3 | High | command-tools.ts:5-77 | Zero tests for `isCommandAvailable`/`isExecutableReferenceAvailable`: PATH split + win32 `.exe/.cmd/.bat` suffixing, `~` expansion, `${VAR:-default}` regex. Doctor's verdict depends entirely on this. | Inject `env`/`platform`: fake-PATH lookup, win32 suffix resolution, absolute-path `existsSync`, `~`→homedir, `${X:-fallback}` set/unset. |
| 4 | High | copilot-usage.ts | Only `parseCopilotUsageResponse` covered. Untested: `readCachedCopilotUsage` TTL/age math, `shouldRefreshUsageCache` 60s boundary, `refreshRecentlyStarted` 30s debounce, `refreshCopilotUsageInBackground` spawn-gating, `fetchCopilotUsage` header/HTTP-error/timeout, `parseUsageCache` round-trip — all injectable (`now`, `fetchImpl`). | Cache fresh vs stale across 60s with injected `now`; debounce within 30s; `fetchCopilotUsage` 401 throws / 200 returns; `parseUsageCache` round-trip. |
| 5 | High | copilotline-config.ts:21-39 | Zero unit tests. Line 26: `JSON.parse(readFileSync(...))` has **no try/catch** (unlike the usage cache) — a malformed `config.json` throws uncaught and crashes render/account. | Test missing-file defaults, `mode:"manual"` round-trip, unknown-mode coercion, whitespace-login→null, and malformed-JSON behavior. |
| 6 | High | render-status-line.ts:828-844 | `formatReset` formats with **local-TZ** `getMonth()/getDate()/getHours()`, but the tests feeding UTC `2026-06-01T00:00:00Z` assert only `⟳ Jun 1`, deliberately omitting the hour. West of UTC the same input renders "May 31 …", so the day assertion is itself TZ-fragile and the hour bug is fully masked. | Render in a fixed zone (UTC) and assert the full `Jun 1 00:00`, or inject a timezone/formatter; at minimum pin month+day+hour under a forced `TZ`. |
| 7 | High | doctor-report.ts (no test) | `runDoctor` is tested only as a pure mapper over hand-built `DoctorInput`. The presentation layer and the input-gathering wiring (which calls `isCommandAvailable`, git probe, settings parse) have no direct tests. | Add a `doctor-report` unit test asserting pass/warn/fail glyphs, section ordering, and summary line for a representative report. |
| 8 | Medium | package.json:30-40 / CI | No `--coverage` wired into `test` or any CI step; the 80% stmt / 70% branch floor is unenforced. | Add `bun test --coverage` with a `bunfig.toml` `[test] coverageThreshold` (lines 0.8 / functions 0.7) and gate CI on it. |
| 9 | Low | cli.ts:130 | `render --capture` is tested only on the success path. The `&& !stdin.truncated` guard means oversized input **silently skips** the capture write with no warning. Untested. | Pipe input over the truncation cap with `--capture`, assert the file is NOT written and a notice reaches stderr. |

## Coverage matrix (module → tested? → risk if untested)
| Module | Tested? | Risk if untested |
|--------|---------|------------------|
| application/render-status-line.ts | Yes (11, strong) | Low — core well covered, except `formatReset` TZ (F6) |
| application/configure-status-line.ts | Indirect (3) | Med — comment fidelity falsely asserted (F1) |
| application/run-doctor.ts | Yes (4, pure mapper) | Med — verdict logic covered, wiring/presentation not (F7) |
| infrastructure/copilot-account.ts | Yes (4) | Low — payload/config/token-match covered |
| infrastructure/copilot-usage.ts | Partial (parse only) | **High** — fetch/cache/TTL/debounce/bg-spawn untested (F4) |
| infrastructure/git-info.ts | Partial (parse only) | Med — `getGitInfo` spawn path untested |
| infrastructure/copilot-settings-file.ts | Indirect | **High** — JSONC strip + data-loss path uncovered (F1) |
| infrastructure/value-reader.ts | No | **High** — shared untrusted-input guard, blast radius = everything (F2) |
| infrastructure/command-tools.ts | No | **High** — PATH/env/`~` expansion + win32 suffixes (F3) |
| infrastructure/copilotline-config.ts | Indirect (CLI only) | **High** — uncaught JSON.parse throw (F5) |
| presentation/doctor-report.ts | No | High — report rendering unverified (F7) |
| domain/* | No (types/consts) | Low — type/shape declarations |
| cli.ts | Yes (12 integration) | Med — `use` aliases, `refresh --login/--host`, NO_COLOR, capture-truncated untested |

## Highest-value tests to add (ranked; the exact behavior each locks down)
1. **JSONC comment-loss assertion** (F1) — converts a false-positive test into a true guard on confirmed data loss.
2. **value-reader guard suite** (F2) — protects the single chokepoint for all untrusted JSON.
3. **usage cache TTL + debounce boundaries** (F4) — protects token spend and stale-quota behavior, via injected `now`/`fetchImpl`.
4. **command-tools resolution** (F3) — the basis of doctor's availability verdict.
5. **copilotline-config malformed input** (F5) — prevents a render-time crash.
6. **formatReset under forced TZ** (F6) — exposes the local-time bug instead of hiding it.
7. **capture-truncated silent-skip** (F9).

## Test-quality notes (brittleness, determinism, isolation)
- **False-confidence test (F1):** the standout issue — a green test whose name promises comment preservation while asserting only value survival, over code that provably strips comments. Worse than no test.
- **Determinism — good:** `render-status-line.test.ts` injects `now`; `copilot-usage`/`copilot-account` accept `now`/`fetchImpl`/`env`. The seams exist; they are simply under-used.
- **Determinism — gap (F6):** `formatReset` reads local time; tests dodge it by omitting the hour. The `Jun 1` assertion is itself a latent flaky test across timezones.
- **Isolation — minor risk:** `copilot-account.test.ts:52-75` mutates `process.env` and restores in `finally` — correct, but order-fragile if a future test throws before restoration; prefer per-test env injection (the functions already accept an `env` arg).
- **Integration cost:** `cli.test.ts` runs a real `bun build` in `beforeAll` and spawns `node dist/cli.js` per test — high-fidelity but slow; assertions are substring-only (acceptable for smoke).
- **Assertions — generally specific:** numeric expectations are exact and meaningful; no no-op patterns found.

## not_applicable / low_signal
- `src/version.ts` — single generated constant; no test warranted.
- `src/domain/{settings,doctor,status-line}.ts` — type/interface and constant declarations; exercised transitively.
- `tests/helpers.ts` — test utility; does not itself need tests.

## Self-challenge
- *Strongest case the JSONC finding doesn't matter:* one could argue Copilot's `settings.json` is machine-managed so comment loss is cosmetic. Rejected — the test explicitly advertises comment handling, users do hand-edit this file, and a test certifying absent behavior is a defect regardless. Held at Critical.
- *Did I verify before flagging missing coverage?* Yes — grep over `tests/` returned zero references to `value-reader`, `command-tools`/`isCommandAvailable`, `copilotline-config`/`readCopilotlineConfig`, `doctor-report`, `formatReset`, `runUseAlias`; read every test body in full.
- *Are any "missing" units covered indirectly?* `copilotline-config`/`copilot-settings-file` are hit by `cli.test.ts` integration, so downgraded from "zero coverage" to "no unit coverage / specific path uncovered".
- *Would suggested tests verify implementation detail?* No — all target observable behavior using existing injection seams.
- *Possible false positive on F6?* Did not execute under a non-UTC TZ, but the source provably uses local `getHours/getMonth/getDate` and the tests provably omit the hour — masking is structural, not environmental.

## Validator handoff (YAML)
```yaml
findings:
  - id: testing-1
    severity: critical
    file: tests/configure-status-line.test.ts
    line: 28
    claim: "Test 'accepts JSONC comments' asserts only value survival, not comment survival, over code (copilot-settings-file.ts:33-44) that strips all comments — false confidence masking a confirmed comment data-loss bug."
    fix: "Rename to reflect value-only preservation and add a test asserting the '// keep me' comment survives (xfail until the writer preserves comments)."
  - id: testing-2
    severity: high
    file: src/infrastructure/value-reader.ts
    line: 3
    claim: "Shared untrusted-JSON guard has zero tests; regressions silently corrupt render, account, usage, and config parsing."
    fix: "Unit-test array/null/primitive rejection, nested path traversal with fallthrough, empty-string and NaN/Infinity rejection."
  - id: testing-3
    severity: high
    file: src/infrastructure/command-tools.ts
    line: 18
    claim: "isCommandAvailable untested: PATH split, win32 .exe/.cmd/.bat suffixing, ~ expansion, ${VAR:-default} regex all uncovered; doctor verdict depends on them."
    fix: "Inject env/platform: fake PATH, win32 suffix, absolute-path existsSync, ~→homedir, ${X:-fallback}."
  - id: testing-4
    severity: high
    file: src/infrastructure/copilot-usage.ts
    line: 191
    claim: "Only parseCopilotUsageResponse covered; TTL(60s), 30s debounce, background spawn-gating, fetch HTTP-error/timeout, parseUsageCache round-trip untested despite injectable now/fetchImpl."
    fix: "Add cache fresh/stale-at-60s with injected now, 30s debounce, fetch 401/200, parseUsageCache round-trip."
  - id: testing-5
    severity: high
    file: src/infrastructure/copilotline-config.ts
    line: 26
    claim: "readCopilotlineConfig has no unit tests and its JSON.parse lacks try/catch, so a malformed config.json throws uncaught and crashes render/account."
    fix: "Test missing-file defaults, manual round-trip, unknown-mode coercion, whitespace-login→null, malformed-JSON."
  - id: testing-6
    severity: high
    file: src/application/render-status-line.ts
    line: 828
    claim: "formatReset uses local-TZ; tests feed UTC midnight but assert only 'Jun 1', omitting the hour — masking a TZ bug and leaving the day assertion TZ-fragile."
    fix: "Render in a fixed zone or inject a formatter; assert full month+day+hour under a forced TZ."
  - id: testing-7
    severity: high
    file: src/presentation/doctor-report.ts
    line: 1
    claim: "runDoctor tested only as a pure mapper; the doctor-report renderer and the input-gathering wiring have no direct tests."
    fix: "Add a doctor-report unit test asserting glyphs, section order, and summary line."
  - id: testing-8
    severity: medium
    file: package.json
    line: 30
    claim: "No --coverage wired into test script or CI; 80%/70% floor unenforced."
    fix: "Add 'bun test --coverage' with bunfig.toml coverageThreshold gated in CI."
  - id: testing-9
    severity: low
    file: src/cli.ts
    line: 130
    claim: "render --capture tested only on success; the '&& !stdin.truncated' guard silently skips capture for oversized input, and that branch is untested."
    fix: "Pipe over the truncation cap with --capture and assert the file is not written."
```
