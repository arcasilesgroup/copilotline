# Correctness Review — copilotline

**Health score: 11/100**
Arithmetic: `100 − 25 (1 Critical) − 36 (3 High × 12) − 24 (4 Medium × 6) − 4 (2 Low × 2) = 11`. Floor not hit.

**Verdict:** One genuinely destructive bug (install/uninstall silently strips user JSONC comments) plus a behavioral-drift duplicate that mis-renders unlimited quotas on the cache path; core render math is otherwise solid and well-tested. Fix the Critical before shipping `install`/`uninstall` to real `~/.copilot/settings.json` files.

## Findings

| # | Severity | Location | Issue | Recommendation |
|---|----------|----------|-------|----------------|
| 1 | Critical | copilot-settings-file.ts:21-44 | `install`/`uninstall` round-trip user settings through `JSON.parse`→`JSON.stringify`, permanently deleting JSONC comments (and trailing commas) the user wrote | Use a surgical edit that preserves the original text, or document the destruction loudly + back up first |
| 2 | High | copilot-usage.ts:322-362 vs render-status-line.ts:478-528 | Duplicated `quotaFromSnapshot` with behavioral DRIFT: cache path uses `unlimited ?? false` and reads only `remaining`; payload path treats `entitlement===-1` as unlimited and also reads `quota_remaining`/`quotaRemaining`. Same API response renders differently depending on path | Extract one shared parser; make cache path honor `entitlement===-1` and the `quota_remaining` aliases |
| 3 | High | render-status-line.ts:828-844 | `formatReset` uses `getMonth/getDate/getHours/getMinutes` (machine-local TZ) with no TZ label → reset time shown is machine-dependent and unlabeled | Render in UTC (`getUTC*`) and/or append a TZ marker; tests already avoid asserting the hour, masking this |
| 4 | High | cli.ts:676-683 | `readFlagValue` returns `args[index+1]` without checking it is not another flag: `render --capture --json` writes a file literally named `--json` | Return `undefined` when the next token starts with `-`; reject/scream on missing value |
| 5 | Medium | copilot-usage.ts:207-211, 434-449 | Refresh debounce is check-then-act across a `statSync`→`writeFileSync` gap; two near-simultaneous `render` invocations both pass `refreshRecentlyStarted` and spawn duplicate detached refreshers | Write marker first with `wx`/atomic create, or accept as best-effort and document |
| 6 | Medium | cli.ts:644-654 | `safeParse` collapses both empty input and malformed JSON to `{}` with no signal; a corrupt payload renders an empty/default line with no diagnostic | Distinguish empty (`{}`) from parse failure; surface parse failure in `--json` / doctor |
| 7 | Medium | cli.ts:407-437 | `enrichAccounts` awaits `tokenStatusForAccount` sequentially in a `for` loop; each does a network `/user` call, so N accounts = N serial round-trips | `await Promise.all(accounts.map(...))` |
| 8 | Medium | configure-status-line.ts:15,33-44 | `disableBuiltInFooterItems` is implemented but no caller ever sets it (`runInstall` passes only `command`+`padding`); the entire `BUILT_IN_FOOTER_KEYS` branch is unreachable in production | Wire a flag/env to it or delete the dead branch + option |
| 9 | Low | render-status-line.ts:37 | `palette.magenta` defined, never referenced | Delete |
| 10 | Low | cli.ts:212; copilot-settings-file.ts:23,30,82 | `as` casts lack the justifying comment the repo convention requires | Add justification comments or narrow with type guards |

## Detail (Critical / High)

### #1 — Critical: install/uninstall destroys user JSONC comments

**Evidence:**
- `copilot-settings-file.ts:33-44` — `applySettingsMutations` calls `parseSettings(...)` then `return \`${JSON.stringify(document, null, 2)}\n\``.
- `copilot-settings-file.ts:21-31` — `parseSettings` runs `stripTrailingCommas(stripJsonComments(text))` then `JSON.parse`. Comments and trailing commas are gone before parsing; the parsed object is plain JS with no comment metadata.
- `cli.ts:163-197` — both `runInstall` and `runUninstall` write the `applySettingsMutations` output back to the real `defaultSettingsPath()` (`~/.copilot/settings.json`).
- Test `configure-status-line.test.ts:28-45` is named *"accepts JSONC comments and keeps unrelated settings"* but only asserts `parsed["theme"] === "dark"` — it never asserts the `// keep me` comment survives. It does **not**.

**Why it's a bug / impact:** `~/.copilot/settings.json` is a user-owned JSONC file the user may have annotated. Running `copilotline install` (also invoked automatically by `scripts/install.sh:122`) or `uninstall` rewrites it as plain minified-key JSON, silently deleting every comment and trailing comma. This is irreversible data loss on a file the tool does not own — the worst category for an installer.

**Fix:** Apply mutations as a minimal textual edit that preserves surrounding bytes (e.g., locate/replace just the `statusLine` and `footer.showCustom` keys), or — at minimum — write a `.bak` copy before overwriting and print a warning that comments will be stripped. Update the misleadingly-named test to assert the actual contract.

### #2 — High: duplicate `quotaFromSnapshot` with behavioral drift

**Evidence — payload path** (`render-status-line.ts:484-501`):
```ts
const unlimited = readBoolean(snapshot["unlimited"]) ?? entitlement === -1;
const remaining =
  readNumberValue(snapshot["remaining"]) ??
  readNumberValue(snapshot["quota_remaining"]) ??
  readNumberValue(snapshot["quotaRemaining"]);
```
**Evidence — cache path** (`copilot-usage.ts:328-339`):
```ts
const unlimited = readBoolean(snapshot["unlimited"]) ?? false;
const remaining = readNumber(snapshot["remaining"]);
```
Same function name, same role (parse one `quota_snapshots` entry into a `QuotaSnapshot`), divergent logic.

**Why it's a bug / impact:** The live payload (`buildStatusSnapshot`) and the cached refresh (`parseCopilotUsageResponse` → written to disk → read back by `quotaForRender`) parse the **same GitHub API shape**. For an unlimited entitlement the API returns `entitlement: -1`:
- Payload path → `unlimited = true` → renders `💸 … ∞` (render-status-line.ts:655-657).
- Cache path → `unlimited = false`, `entitlement = -1` → `used = max(0, -1 - remaining)`, `usedPercent` falls through to `null`, and `formatQuotaCounts` prints nonsense like `…/-1`.

So whether a user sees `∞` or a garbage bar depends purely on whether the data arrived inline vs. from cache — a classic producer/consumer drift. The `quota_remaining` alias is likewise honored on one path only. Neither divergence is covered by tests.

**Fix:** Hoist a single `parseQuotaSnapshot` into a shared module (e.g., next to `QuotaSnapshot`) and call it from both sites. Ensure it treats `entitlement === -1` as unlimited and reads the `quota_remaining`/`quotaRemaining` aliases everywhere.

### #3 — High: `formatReset` emits machine-local, unlabeled time

**Evidence** (`render-status-line.ts:838-843`):
```ts
const month = months[date.getMonth()] ?? "";
const day = date.getDate();
const hour = String(date.getHours()).padStart(2, "0");
const minute = String(date.getMinutes()).padStart(2, "0");
return `… ${month} ${day} ${hour}:${minute} …`;
```
The input `resetAt` is a UTC ISO string (e.g. `2026-06-01T00:00:00Z`). `getMonth/getDate/getHours/getMinutes` all read the host's local timezone.

**Why it's a bug / impact:** The same reset instant renders as `Jun 1 00:00` in UTC, `Jun 1 02:00` in CEST, or even `May 31 …` west of UTC — with no timezone label to disambiguate. Output is non-deterministic across machines and can show the **wrong day**. The header test (render-status-line.test.ts:164) asserts only `⟳ Jun 1` and omits the hour, sidestepping the non-determinism rather than pinning it.

**Fix:** Use `getUTCMonth/getUTCDate/getUTCHours/getUTCMinutes` (and append a `UTC`/`Z` marker), or format with an explicit, documented timezone.

### #4 — High: `readFlagValue` swallows the following flag as a value

**Evidence** (`cli.ts:676-683`):
```ts
function readFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];     // no check that this isn't itself a flag
}
```

**Why it's a bug / impact:** `copilotline render --capture --json` sets `capturePath = "--json"` and `asJson = true`, so the tool writes the raw payload to a file literally named `--json` in CWD and still emits JSON. A missing value (`render --capture` at end of args) yields `undefined` and silently skips capture. Same helper backs `--login`/`--host`/`--set` (cli.ts:312-313,366-367,562), so `account --set --host x` would pin login to the literal `"--host"`.

**Fix:** Treat a following token that starts with `-` (and is not a bare `-`) as "no value": return `undefined` or raise a usage error. Consider a tiny shared arg parser given the five call sites.

## DRY / Architecture / Maintainability notes

- **DRY (primary):** Finding #2 is the headline duplication — two `quotaFromSnapshot` implementations that have already drifted. Beyond that, `readString`/`readNumber(Value)`/`readBoolean`/`clampPercent` are re-declared near-identically in render-status-line.ts (770-797), copilot-usage.ts (492-515), copilot-account.ts (465-471), copilotline-config.ts (81-83). Consolidating into `value-reader.ts` would remove ~5 copies and eliminate future drift like #2. Proportionality is otherwise fine — no premature abstraction; hexagonal layering is clean.
- **Maintainability:** `buildStatusSnapshot` (render-status-line.ts:47-161) is long but it is a flat, readable field-extraction table — acceptable. Naming is consistent and honest throughout. `runDoctorCommand` (cli.ts:199-307) is large and mixes parse + preview + report assembly; a future split would help but no correctness impact.
- **Dead code:** `palette.magenta` (#9) and the `disableBuiltInFooterItems` branch (#8) are both genuinely unreachable in production.

## not_applicable / low_signal

- **install.sh checksum — VERIFIED CORRECT, not a finding.** `release.yml:85` generates the sidecar via `shasum -a 256 <asset>`; install.sh:103 runs `--check` from the dir containing `$ASSET`, so the embedded filename resolves. Intent matches implementation.
- **Fresh-payload-vs-cache precedence — VERIFIED CORRECT.** `buildStatusSnapshot` line 149 correctly prefers live payload over cache; covered by render-status-line.test.ts:109-148.
- **`writeSettingsText`/`writeCopilotlineConfig` atomic writes — VERIFIED CORRECT.** Both use tmp-file + `renameSync` with `0o600`. No partial-write race.

## Self-challenge (weakest findings)

- **#8 `disableBuiltInFooterItems` (Medium):** Strongest counter — it may be a deliberate, tested public API of `installStatusLineMutations` for library consumers, not dead. But it is an *application*-layer function in a zero-dep CLI with a single internal caller that never sets it, and no test exercises the `true` branch. Unreachable-in-product stands.
- **#4 `readFlagValue` (High vs Medium):** Counter — `--capture` is a developer-only schema-discovery flag, so real-world blast radius is small. Kept at High because the *same* helper governs `--set`/`--host`/`--login` where a wrong value silently pins the wrong account.
- **#5 cache TOCTOU (Medium):** Counter — the worst case is one redundant detached background fetch that just overwrites the cache; no corruption, self-healing. That is why it is Medium.
- **#6 `safeParse` (Medium):** Counter — for a statusline, failing silent to an empty line is arguably *desirable* (never break the user's prompt). Kept Medium; remediation scoped to surfacing the failure only in `--json`/doctor, not the hot render path.

## Validator handoff (YAML)

```yaml
findings:
  - id: correctness-1
    severity: critical
    file: src/infrastructure/copilot-settings-file.ts
    line: 33
    claim: "applySettingsMutations round-trips user settings through JSON.parse->JSON.stringify, permanently deleting JSONC comments and trailing commas on every install/uninstall of the user-owned ~/.copilot/settings.json."
    fix: "Apply surgical textual edits that preserve surrounding bytes, or write a .bak and warn before overwriting."
  - id: correctness-2
    severity: high
    file: src/infrastructure/copilot-usage.ts
    line: 328
    claim: "quotaFromSnapshot duplicated with drift vs render-status-line.ts:485. Cache path uses 'unlimited ?? false' and reads only 'remaining'; payload path treats entitlement===-1 as unlimited and reads quota_remaining/quotaRemaining."
    fix: "Extract one shared parseQuotaSnapshot honoring entitlement===-1 and quota_remaining aliases; call from both sites."
  - id: correctness-3
    severity: high
    file: src/application/render-status-line.ts
    line: 838
    claim: "formatReset uses local-timezone getMonth/getDate/getHours/getMinutes on a UTC ISO reset time with no TZ label; output is machine-dependent and can show wrong day."
    fix: "Use getUTC* and append a UTC/Z marker (or an explicit documented TZ)."
  - id: correctness-4
    severity: high
    file: src/cli.ts
    line: 676
    claim: "readFlagValue returns args[index+1] without checking it is a flag; 'render --capture --json' writes a file literally named '--json'. Same helper backs --set/--host/--login."
    fix: "Return undefined (or error) when the next token starts with '-'."
  - id: correctness-5
    severity: medium
    file: src/infrastructure/copilot-usage.ts
    line: 207
    claim: "Refresh debounce is check-then-act across statSync and writeFileSync; concurrent renders both pass the check and spawn duplicate detached refreshers."
    fix: "Atomically create the marker (wx) before spawning, or document as best-effort."
  - id: correctness-6
    severity: medium
    file: src/cli.ts
    line: 644
    claim: "safeParse collapses empty input and malformed JSON to {} with no signal; corrupt payload renders a default line with no diagnostic."
    fix: "Distinguish empty from parse-failure and surface failure in --json/doctor."
  - id: correctness-7
    severity: medium
    file: src/cli.ts
    line: 413
    claim: "enrichAccounts awaits tokenStatusForAccount sequentially; each performs a /user network call, so N accounts = N serial round-trips."
    fix: "Use await Promise.all(accounts.map(...))."
  - id: correctness-8
    severity: medium
    file: src/application/configure-status-line.ts
    line: 33
    claim: "disableBuiltInFooterItems option and its BUILT_IN_FOOTER_KEYS branch are never reachable in production; runInstall passes only command+padding and no test sets the flag true."
    fix: "Wire a flag/env to it or delete the dead option and branch."
  - id: correctness-9
    severity: low
    file: src/application/render-status-line.ts
    line: 37
    claim: "palette.magenta defined but never referenced anywhere in src/ or tests/."
    fix: "Delete the unused palette entry."
  - id: correctness-10
    severity: low
    file: src/cli.ts
    line: 212
    claim: "Multiple 'as' casts lack the justifying comment required by repo convention (cli.ts:212; copilot-settings-file.ts:23,30,82)."
    fix: "Add justification comments or narrow with type guards."
```
