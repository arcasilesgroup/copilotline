# Performance Review — copilotline

**Health score: 49/100** (start 100; −25 Critical [F1: 3× redundant `gh`/`sqlite3` subprocess fan-out per render]; −12 High [F2: `getGitInfo` double git spawn]; −12 High [F3: synchronous blocking subprocesses on render path]; −2 Low [F6: repeated alias-path scans]; floor 0 → 100−25−12−12−2 = **49**)

**Verdict:** Render is NOT fast enough for per-turn repaint. The headline "blocking git spawn" is real but secondary — the actual dominant cost is that account resolution runs an **eager, un-memoized subprocess fan-out (`gh auth status` + `sqlite3` per VS Code DB) THREE times on every single render**, plausibly 200ms–600ms+ of blocking subprocess wall-time per repaint on a typical multi-IDE dev machine.

> **Verified correction to the brief:** The debounce check is **in-process BEFORE spawn** (good — see F4). So the background-refresh `spawn` is correctly skipped on most renders. But `refreshCopilotUsageInBackground` still calls `selectCopilotAccount` twice (cli.ts:206 + the internal `shouldRefreshUsageCache` at :196) to *compute* the debounce key — and that account lookup is itself the expensive subprocess fan-out. The spawn-guard is cheap; the guard's *inputs* are not.

## Findings

| # | Severity | Location | Issue | Est. impact | Recommendation |
|---|----------|----------|-------|-------------|----------------|
| F1 | **Critical** | `copilot-account.ts:60-65` + `copilot-usage.ts:187,196,206` | `selectCopilotAccount` runs an **eager, un-memoized** candidate scan (`gh auth status` + `sqlite3` × up-to-5 VS Code DBs) and is invoked **3×/render** | 3 × (`gh` spawn ≤2000ms + `sqlite3` spawns ≤2000ms each); realistically ~150–500ms+ blocking per render, ×3 | Memoize `selectCopilotAccount(input)` per process; short-circuit candidate scan once payload/config yields a login; compute the account once in `runRender` and pass it down |
| F2 | **High** | `git-info.ts:19-37,61-65` | `getGitInfo` runs **two** sequential blocking `spawnSync("git")` calls (`status` then `rev-parse --git-dir`) | 2× git process spawn per render in a repo (~10–60ms each, worse on cold FS/large repo) | Derive worktree from a single `git status -b --porcelain=v2` call, or skip worktree detection on render |
| F3 | **High** | `cli.ts:135-141`, `git-info.ts:62`, `copilot-account.ts:246,332` | All of render's data gathering is **synchronous blocking subprocess I/O** on the foreground render path (git, gh, sqlite3) — serialized, no parallelism | Worst-case render latency = sum of all `spawnSync` timeouts; these run before any output is written | Read the cache only on render and move ALL detection into the already-detached `refresh` child |
| F4 | info (verified-good) | `copilot-usage.ts:201-222` | Debounce-before-spawn correctly implemented: `shouldRefreshUsageCache` + `refreshRecentlyStarted` gate at :207 run **in-parent before `spawn`** (:216). No "spawn-to-check-debounce" anti-pattern. | Most renders skip the spawn entirely (mtime marker, 30s). | No action. Note: the guard's account lookup is the F1 cost, not the spawn. |
| F5 | minor | `cli.ts:407-437` | `enrichAccounts` awaits `tokenStatusForAccount` **sequentially** per account | N accounts → N sequential network `/user` calls; only on `account` cmd (cold path, N≈1-3) | `Promise.all(accounts.map(...))`. Low priority — not render path. |
| F6 | Low | `render-status-line.ts:53-113`, `value-reader.ts:25-43` | Large multi-path `pickString` alias scans (e.g. ~22 effort paths) | Pure in-memory object walks on a tiny payload; sub-microsecond | Negligible. Ignore unless payload grows. |
| F7 | minor | `copilot-account.ts:108,119,419` | Token resolution issues a `GET /user` network verification even for env-var tokens | Adds one ~RTT network call to **refresh** (the detached child), not render | Acceptable in detached child; could cache login→token mapping. |

## Hot-path latency budget (where the render-path milliseconds go)

Per `copilotline render` invocation (foreground, blocking, before any byte is written to stdout):

| Stage | Calls | Blocking work | Notes |
|-------|-------|---------------|-------|
| `readStandardInput` | 1 | async stdin drain | Fine; non-blocking, 2MB cap |
| process cold start | 1 | Node boot + 44.4K minified bundle parse, **zero deps** | ~30–60ms Node startup; bundle negligible. Good. |
| `quotaForRender` → `selectCopilotAccount` #1 | 1 | **`gh auth status` (≤2s) + `sqlite3`×DBs (≤2s ea)** + config reads | copilot-usage.ts:187 |
| `refreshCopilotUsageInBackground` → `selectCopilotAccount` #2 | 1 | **same subprocess fan-out again** | cli.ts:206 |
| `…shouldRefreshUsageCache` → `selectCopilotAccount` #3 | 1 | **same subprocess fan-out a third time** | copilot-usage.ts:196 |
| (background refresh `spawn`) | 0–1 | skipped on most renders (F4 debounce) | only ~once / 30s |
| `buildStatusSnapshot` → `getGitInfo` | 1 | **`git status` spawn + `git rev-parse` spawn** (≤1.5s ea) | git-info.ts:20,31 |
| `formatStatusLine` | 1 | pure string build | Negligible |

**Dominant cost = the 3× account-detection subprocess fan-out (F1), then the 2× git spawn (F2).** On a developer machine with `gh` installed and several VS Code variants present, this is easily the difference between a ~50ms repaint and a multi-hundred-ms repaint. For a statusline that may repaint per turn, that is user-perceptible lag.

## Detail (each High)

### F1 (Critical) — 3× eager subprocess fan-out for account detection
**Evidence:** `selectCopilotAccount` (copilot-account.ts:48) unconditionally builds its candidate array eagerly:
```
60  const candidates = uniqueAccounts([
61    accountFromPayload(input),
62    accountFromCopilotConfig(),
63    ...accountsFromVSCode(),     // existsSync ×5 + spawnSync("sqlite3") per existing DB (≤2s)
64    accountFromGitHubCli(),      // spawnSync("gh","auth","status") (≤2s)
65  ]);
```
There is **no short-circuit**: even when `accountFromPayload(input)` already returns a login, `gh` and `sqlite3` are still spawned (JS evaluates all array elements before `uniqueAccounts`). And there is **no memoization** — confirmed via grep. The render path calls it three times: `quotaForRender` (copilot-usage.ts:187), `refreshCopilotUsageInBackground` (:206), and the nested `shouldRefreshUsageCache` (:196). All three execute on a normal render (cli.ts:135-136).

**Fix (expected ~66% reduction immediately, ~90%+ with payload short-circuit):**
1. Compute the selection **once** in `runRender` and thread it into `quotaForRender` and `refreshCopilotUsageInBackground` (eliminates 2 of 3 calls outright).
2. Memoize `selectCopilotAccount` by a key derived from `input` for the process lifetime (single-shot CLI → effectively one computation).
3. Short-circuit: if `accountFromPayload(input)` or `accountFromCopilotConfig()` yields a login, skip `accountsFromVSCode()` + `accountFromGitHubCli()` on the render path entirely.

### F2 (High) — `getGitInfo` does two blocking git spawns
**Evidence:** git-info.ts:20 runs `git ... status --porcelain --branch`, then git-info.ts:31 runs a **second** `git ... rev-parse --git-dir` solely to set the `worktree` boolean. Both go through `runGit` → `spawnSync("git", …, {timeout:1500})`. **Mitigation present:** when `statusOutput === null` it returns early at :28 before the second spawn — non-repo dirs cost only 1 spawn. But the common case (inside a repo) pays 2.

**Fix:** Eliminate the second spawn. `git status --porcelain=v2 --branch` headers, or deferring worktree detection to the background refresh, removes one full subprocess from every in-repo render.

### F3 (High) — entire render data path is synchronous blocking subprocess I/O
**Evidence:** render (cli.ts:135-141) gathers quota + git synchronously; underlying calls are all `spawnSync` — serialized, foreground, each gated only by its own timeout. Nothing is parallelized; nothing is written to stdout until all complete.

**Fix (architectural, highest leverage):** Make render **read-only against the cache** — emit instantly from `quotaForRender`'s cached file + a fast/cached git read, and push ALL subprocess detection (gh, sqlite3, the second git call) into the already-detached `refresh` child (cli.ts:216). The statusline then renders in ~Node-startup time and self-heals on the next turn. This subsumes F1 and F2.

## not_applicable / low_signal

- **Bundle size / import graph (startup):** `not_applicable`. 44.4K minified, **zero runtime deps**, single-file `bun build --minify`. Cold start dominated by Node boot, not bundle parse.
- **Debounce-before-spawn:** Verified **correct** (F4). Not a finding.
- **`quotaFromSnapshot` duplication / `pickString` alias scans (F6):** `low_signal`. Pure in-memory walks over a small JSON payload.
- **Sequential `enrichAccounts` (F5) & redundant `/user` verification (F7):** real but **cold path only** (`account`/`refresh`, N≈1-3). No render impact.
- **O(n²):** none found. `uniqueAccounts` is O(n) with a Set; candidate lists are tiny.

## Self-challenge

- *Strongest case F1 doesn't matter:* If neither `gh` nor any VS Code DB exists, both helpers fail fast — fan-out collapses to cheap `existsSync` misses. **Rebuttal:** the target audience is GitHub Copilot CLI users, who almost certainly have `gh` and frequently one+ VS Code variants installed — exactly the population that pays full cost, ×3. The redundant 3× invocation is unconditionally wasteful regardless.
- *Did I verify, not assume?* Yes — confirmed the three call sites, confirmed no memoization (grep), confirmed eager (non-short-circuiting) array construction at copilot-account.ts:60-65, and confirmed the git double-spawn at git-info.ts:20+31 with its non-repo early-return at :28.
- *Is F2 overstated?* The early-return genuinely halves cost for non-repo dirs, so held at High (not Critical).
- *Net:* F1 is the only Critical; it dwarfs the git spawn the brief led with.

## Validator handoff (YAML)

```yaml
findings:
  - id: performance-1
    severity: critical
    file: src/infrastructure/copilot-account.ts
    line: 60
    claim: "selectCopilotAccount eagerly spawns `gh auth status` + `sqlite3` (per VS Code DB) with no short-circuit and no memoization, and is invoked 3x per render (copilot-usage.ts:187,196,206 via cli.ts:135-136). ~3x redundant blocking subprocess fan-out, hundreds of ms per repaint."
    fix: "Compute selection once in runRender and pass down; memoize per-process; short-circuit candidate scan once payload/config yields a login."
  - id: performance-2
    severity: high
    file: src/infrastructure/git-info.ts
    line: 31
    claim: "getGitInfo runs a second blocking spawnSync('git rev-parse --git-dir') after status, solely for the worktree flag; 2 git spawns per in-repo render."
    fix: "Use `git status --porcelain=v2 --branch` to derive worktree from one call, or defer worktree detection off the render path."
  - id: performance-3
    severity: high
    file: src/cli.ts
    line: 135
    claim: "Entire render data path is synchronous blocking subprocess I/O (git/gh/sqlite3 via spawnSync), serialized in the foreground before any stdout. Worst-case latency = sum of all reachable spawn timeouts."
    fix: "Make render read-only against the cache and move all subprocess detection into the detached refresh child (cli.ts:216)."
  - id: performance-4
    severity: info
    file: src/infrastructure/copilot-usage.ts
    line: 207
    claim: "VERIFIED GOOD: debounce guard runs in-parent BEFORE spawn (:216). No spawn-to-check-debounce anti-pattern."
    fix: "None. The guard's account lookup is the perf-1 cost, not the spawn itself."
  - id: performance-5
    severity: minor
    file: src/cli.ts
    line: 413
    claim: "enrichAccounts awaits tokenStatusForAccount sequentially (N network /user calls). Cold path only (account command)."
    fix: "Promise.all over accounts. Low priority; not render path."
  - id: performance-6
    severity: minor
    file: src/infrastructure/copilot-account.ts
    line: 419
    claim: "Token resolution issues a GET /user verification even for env-var tokens; adds one RTT to refresh (detached child, not render)."
    fix: "Cache login->token mapping; acceptable in detached child."
```
