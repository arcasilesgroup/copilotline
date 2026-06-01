---
title: "copilotline Statusline Excellence"
status: draft
audience: framework-dev
branch: main
length_estimate: long
authoring_style: diagnostic-then-roadmap
principles_required: ["§10.1 KISS", "§10.4 DRY", "§10.5 TDD", "§10.6 SDD", "§10.7 Clean Code", "§10.8 Hexagonal Architecture"]
delivery_mode: multi-wave
mantra: "Never break the host prompt; never leak the token; degrade without losing meaning."
sources_consulted: ["/ai-explore", "/ai-research (exa+web+context7)", "/ai-review --full (6 specialists)", "/ai-design", "/ai-animation"]
---

# Spec Brief — copilotline Statusline Excellence

> Companion artifact to the full code review at `reports/code-review/00-summary.md`.
> This brief converts the review's findings plus external research into a
> hand-off-ready problem statement for `/ai-brainstorm`. Every diagnostic claim
> cites `file:line`. Machine paths are written as `$HOME/...`.

## 1. Vision

`copilotline` should be the statusline a GitHub Copilot CLI user installs and
forgets about — because it is fast enough to repaint every turn without lag,
honest about the data it shows, safe with the GitHub token it holds, and legible
on every terminal from a 16-color CI log to a truecolor iTerm session. Today the
architecture is excellent (clean hexagonal layering at `src/domain` →
`src/application` → `src/infrastructure`, zero runtime dependencies, atomic
writes, no shell injection) but a small cluster of high-consequence defects keeps
it below a shippable bar: it can leak the user's token to an attacker-controlled
host, it silently rewrites the user's `~/.copilot/settings.json` and deletes
their comments, it spawns `gh`+`sqlite3` three times on every render, and it
ignores `NO_COLOR` on its primary output. We fix those release-blockers, then
layer a real design system (themes, color-depth fallback, width-adaptive layout,
accessible severity cues) and a tasteful motion model (freshness affordance,
interactive spinner) on top. The end state: a polished, safe, instant statusline
with a config-driven theme system and a test suite that enforces it.

## 2. Scope Boundary

**In scope** — the TypeScript/Bun product in `src/` (3,487 LOC), its tests in
`tests/`, `scripts/install.sh`, root config (`package.json`, `tsconfig.json`,
`.semgrep.yml`), and `.github/workflows/`. Specifically: the SSRF host allowlist,
the settings-file write strategy, render-path performance, the quota-parse
duplication, the terminal-UI design system, motion/micro-interactions, the test
coverage gap, and DX (flags, completions, docs).

**Explicitly NOT in scope** — the vendored `.ai-engineering/`, `.claude/`,
`.codex/` framework tooling (out of scope for product review); adding runtime
dependencies (the zero-dep posture is a deliberate constraint we preserve);
rewriting the hexagonal architecture (it is sound); Windows shell-installer
parity (the npm + `.exe`-asset path is intentional and documented at
`scripts/install.sh:78`); supporting non-GitHub quota providers.

## 3. Diagnostic Snapshot

Current state, evidence-cited. Grouped by the wave that addresses it.

### 3.1 Security — token exfiltration via payload-controlled host (release-blocker)

`normalizeHost` strips the scheme and trailing slash but applies **no allowlist**
(`src/infrastructure/copilot-account.ts:282`), and `usageApiBaseForHost` then
builds `https://api.${normalized}` for any non-`github.com` host
(`src/infrastructure/copilot-account.ts:288`). A payload-supplied `host` flows
from `accountFromPayload` (`src/infrastructure/copilot-account.ts:171`) through to
a token-bearing `GET https://api.<host>/user` (`src/infrastructure/copilot-account.ts:419`)
and `GET /copilot_internal/user` (`src/infrastructure/copilot-usage.ts:96`). The
render path reaches this via a detached refresh child carrying `--host <payloadHost>`
(`src/cli.ts:136` → `src/infrastructure/copilot-usage.ts:206`). The token is sent
during verification **before** the login-match check rejects it. This violates the
project's own pledge in `SECURITY.md` that tokens never leave GitHub's API.
go-gh solves exactly this with a host allowlist (`NormalizeHostname`/`IsTenancy`)
[ref 21].

### 3.2 Correctness — install/uninstall destroys the user's settings comments (release-blocker)

`applySettingsMutations` round-trips `~/.copilot/settings.json` through
`parseSettings` (which runs `stripJsonComments` + `JSON.parse`) and then
`JSON.stringify` (`src/infrastructure/copilot-settings-file.ts:33`), permanently
deleting every JSONC comment and trailing comma on each `install`/`uninstall`
(`src/cli.ts:163`, `src/cli.ts:181`). This is irreversible data loss on a
user-owned file the tool does not own. The Copilot CLI documents `settings.json`
as JSONC, user-editable [ref 1].

### 3.3 Performance — render is too slow for per-turn repaint (release-blocker)

`selectCopilotAccount` builds its candidate list eagerly with no short-circuit —
`accountsFromVSCode()` spawns `sqlite3` per VS Code DB and `accountFromGitHubCli()`
spawns `gh auth status` (`src/infrastructure/copilot-account.ts:60`) — and it is
called **three times** on a single render (`src/infrastructure/copilot-usage.ts:187`,
`:196`, `:206`, reached from `src/cli.ts:135`). There is no memoization. On a
developer machine with `gh` and several VS Code variants installed this is
hundreds of milliseconds of blocking subprocess work, tripled. Compounding it,
`getGitInfo` runs two sequential blocking `spawnSync("git", …)` calls per in-repo
render (`src/infrastructure/git-info.ts:20` then `:31`), and the entire render
data path is synchronous foreground subprocess I/O (`src/cli.ts:135`). (Verified
good: the background-refresh debounce correctly gates **before** spawning —
`src/infrastructure/copilot-usage.ts:207`.)

### 3.4 Correctness — quota parse drift between live and cached paths

`quotaFromSnapshot` exists in two copies that have drifted: the cache path uses
`unlimited ?? false` and reads only `remaining` (`src/infrastructure/copilot-usage.ts:328`),
while the payload path treats `entitlement === -1` as unlimited and also reads the
`quota_remaining`/`quotaRemaining` aliases (`src/application/render-status-line.ts:485`).
The same GitHub response therefore renders `∞` from live data and a garbage bar
from cache. `formatReset` formats a UTC reset instant with local-timezone getters
and no label (`src/application/render-status-line.ts:838`), so output is
machine-dependent and can show the wrong day. `readFlagValue` returns the next
token without checking it is a flag (`src/cli.ts:676`), so `render --capture --json`
writes a file literally named `--json`.

### 3.5 Terminal-UI — no NO_COLOR, no fallback, no width awareness

The renderer always emits 24-bit truecolor; there is no `NO_COLOR`/`TERM` guard
anywhere in `src/application/render-status-line.ts` (the only such check is in the
interactive helper at `src/cli.ts:602`), violating the no-color.org spec [ref 12]
on the primary `render` output. There is no color-depth fallback — `color()`
emits only `38;2;r;g;b` (`src/application/render-status-line.ts:19`). Severity is
signalled by color alone (`colorForPercentage`, `src/application/render-status-line.ts:711`).
The renderer never reads `process.stdout.columns`, so long lines overflow narrow
terminals (`src/application/render-status-line.ts:167`). The context glyph is the
VS16 emoji `✍️` with hard-coded compensating padding
(`src/application/render-status-line.ts:13`). The palette is duplicated between
`src/application/render-status-line.ts:30` and `src/cli.ts:606`, and the `magenta`
entry is dead (`src/application/render-status-line.ts:37`).

### 3.6 Testing — false confidence + untested load-bearing units

The test named "accepts JSONC comments and keeps unrelated settings"
(`tests/configure-status-line.test.ts:28`) asserts only that a setting *value*
survives — never that the comment survives — certifying behavior the code does
not deliver. The untrusted-input guard `value-reader.ts` (used by every parse
path), `command-tools.ts`, the `copilot-usage.ts` cache/TTL/debounce logic, and
`copilotline-config.ts` (whose `JSON.parse` at `src/infrastructure/copilotline-config.ts:26`
has no try/catch and can crash render on a malformed config) all have zero unit
tests. No `--coverage` is wired into `package.json:30` or CI, so the 80%/70%
floor is unenforced.

### 3.7 Compatibility / observability — silent degradations

The release gate validates `package.json` against the tag but never `src/version.ts:1`
(`.github/workflows/release.yml:32`), which feeds `--version`/HELP/doctor. The
HTTP `Editor-Version` header is hardcoded `copilotline/0.1.0`
(`src/infrastructure/copilot-usage.ts:101`). VS Code detection silently returns
empty when `sqlite3` is absent (`src/infrastructure/copilot-account.ts:333`), and
the usage feature depends on the undocumented `/copilot_internal/user` endpoint
(`src/infrastructure/copilot-usage.ts:96`) — neither is surfaced by `doctor`.

## 4. Architecture

The fix preserves the hexagonal seam and the zero-dependency constraint. Two new
infrastructure/presentation modules absorb the cross-cutting concerns so the
domain stays pure:

- **`src/infrastructure/host-policy.ts` (new)** — the single allowlist boundary.
  `normalizeHost`/`usageApiBaseForHost` move here and gain a go-gh-faithful
  allowlist: accept exactly `github.com` or `*.ghe.com` (collapsed to
  `<last-label>.ghe.com`), fail closed to `api.github.com` otherwise [ref 21]. The
  host is validated at every ingestion point (account record, `--host`, VS Code
  state), not only at fetch time.
- **`src/infrastructure/terminal-capabilities.ts` (new)** — resolves an effective
  color depth `{none, ansi16, xterm256, truecolor}` once per render from
  `NO_COLOR` (present-and-non-empty per spec [ref 12]), `--color`/`--no-color`,
  `stdout.isTTY`, `TERM`, and `COLORTERM` [ref 11]. Also exposes a zero-dep
  `displayWidth(str)` (strip SGR, sum an embedded East-Asian-width table, treat
  VS/ZWJ as zero-width) [ref 15][ref 16][ref 18].
- **`src/presentation/theme.ts` (new)** — the palette/glyph registries and a
  single `paint(token, depth, bg)` function. Replaces the duplicated `palette`
  and `style()` with one semantic-token table (`model`, `dir`, `git`, `session`,
  `accent`, `muted`, `ok`, `warn`, `crit`, …) carrying a baked
  `[hexDark, hexLight, xterm256, ansi16]` degradation ladder. Kills the
  duplication and the dead `magenta` (§10.4 DRY, Hard Rule §13.7).
- **`src/infrastructure/copilotline-config.ts`** gains an additive `theme` block
  (`ThemeConfig` with `preset`, `palette`, `glyphs`, `separator`, `color`,
  `background`, user `palettes`/`glyphSets`). Absent ⇒ defaults, so existing
  config files keep working with no migration.
- **`src/cli.ts`** shrinks: the standalone `style()` (`src/cli.ts:601`) is deleted
  in favour of `theme.ts`; presentation helpers (`formatAccountList`,
  `printAccountHeader`) move to `src/presentation/`; account selection is computed
  **once** in `runRender` and threaded down (kills two of the three
  `selectCopilotAccount` calls).
- **`src/application/render-status-line.ts`** becomes render-only against the
  cache (no foreground subprocess I/O); the quota parser is unified into one
  shared `parseQuotaSnapshot` consumed by both the live and cache paths.

```
                          stdin (Copilot JSON, untrusted)
                                     │
 src/cli.ts runRender ── selectAccount() ONCE ──┐
       │                                         │ (memoized)
       ├─ quotaForRender(cache) ─────────────────┘   reads only; never spawns
       ├─ refreshInBackground() ── detached child ── host-policy allowlist ─▶ api.github.com
       └─ buildStatusSnapshot ─▶ formatStatusLine ─▶ theme.paint(depth,bg) ─▶ width budget ─▶ stdout
```

## 5. Evidence Catalog

| # | Claim | Evidence |
|---|-------|----------|
| 1 | Host not allowlisted before token-bearing fetch | `src/infrastructure/copilot-account.ts:282`, `:288`, `:419`; `src/infrastructure/copilot-usage.ts:96` |
| 2 | Payload host reaches the detached refresh child | `src/cli.ts:136`; `src/infrastructure/copilot-usage.ts:206` |
| 3 | settings.json round-trip deletes comments | `src/infrastructure/copilot-settings-file.ts:33`; callers `src/cli.ts:163`, `:181` |
| 4 | `selectCopilotAccount` eager + called 3×/render | `src/infrastructure/copilot-account.ts:60`; `src/infrastructure/copilot-usage.ts:187`, `:196`, `:206` |
| 5 | Double git spawn per in-repo render | `src/infrastructure/git-info.ts:20`, `:31` |
| 6 | Debounce correctly gates before spawn (good) | `src/infrastructure/copilot-usage.ts:207` |
| 7 | Quota parser duplicated + drifted | `src/infrastructure/copilot-usage.ts:328` vs `src/application/render-status-line.ts:485` |
| 8 | `formatReset` local timezone, unlabeled | `src/application/render-status-line.ts:838` |
| 9 | `readFlagValue` swallows next flag | `src/cli.ts:676` |
| 10 | Renderer ignores NO_COLOR/TERM | `src/application/render-status-line.ts:19`, `:167`; cf. `src/cli.ts:602` |
| 11 | No width handling | `src/application/render-status-line.ts:167` |
| 12 | VS16 emoji glyph + hardcoded padding | `src/application/render-status-line.ts:13` |
| 13 | Palette duplicated + dead `magenta` | `src/application/render-status-line.ts:30`, `:37`; `src/cli.ts:606` |
| 14 | False-confidence JSONC test | `tests/configure-status-line.test.ts:28` |
| 15 | `copilotline-config` uncaught `JSON.parse` | `src/infrastructure/copilotline-config.ts:26` |
| 16 | No coverage enforcement | `package.json:30` |
| 17 | Version-sync gap + hardcoded header | `.github/workflows/release.yml:32`; `src/version.ts:1`; `src/infrastructure/copilot-usage.ts:101` |
| 18 | sqlite3 / internal-endpoint silent degradation | `src/infrastructure/copilot-account.ts:333`; `src/infrastructure/copilot-usage.ts:96` |

## 6. Roadmap

Milestones are ordered so the release-blockers land first. Each has an acceptance gate.

- **M0 — Safety & data integrity (release-blockers).** Host allowlist in the new
  `host-policy.ts`; comment-preserving settings write (surgical edit or `.bak`+warn);
  fix the false-confidence test to assert the real contract. *Gate:* a malicious
  payload host never receives the token (test); a settings file with comments
  survives install+uninstall byte-identical except the managed keys (test); the
  JSONC test fails if comments are dropped.
- **M1 — Render performance.** Compute account once + memoize + short-circuit;
  make render cache-only; single git spawn. *Gate:* one `selectCopilotAccount`
  call per render (test/trace); zero foreground `gh`/`sqlite3` spawns on the
  render path; render wall-time budget documented and met.
- **M2 — Correctness hardening.** Unify `parseQuotaSnapshot`; `formatReset` → UTC
  + label; `readFlagValue` rejects flag-as-value; `safeParse` distinguishes
  empty vs malformed and surfaces it in `--json`/doctor; guard the config
  `JSON.parse`. *Gate:* unlimited (`entitlement:-1`) renders identically from live
  and cache (test); deterministic reset rendering under a forced `TZ` (test).
- **M3 — Terminal-UI design system.** Semantic-token palette + degradation ladder;
  `NO_COLOR`/depth resolver; `--color`/`--no-color`/`--theme`/`--bg` flags;
  width-budget + dir truncation; VS16-free default glyph set + glyph-set presets;
  severity sigils for color-independent state; 4 shipped presets
  (`default`/`minimal`/`nerdfont`/`high-contrast`). *Gate:* `NO_COLOR=1` ⇒ zero
  SGR bytes (test); the `default` preset renders correctly at 16/256/truecolor;
  every text token clears 4.5:1 on its background; line never exceeds
  `stdout.columns`.
- **M4 — Motion & interactive polish.** Freshness state machine
  (fresh/refreshing/stale/error) using existing `ageMs` + marker, plus a 1-byte
  error breadcrumb; `enrichAccounts` Braille spinner (80 ms/frame, TTY-gated,
  single-line, auto-cleared); one-shot confirmation flash; partial-cell block
  quota bar; `COPILOTLINE_NO_SPINNER` opt-out. *Gate:* no timer ever runs on the
  render path; all motion stripped under `NO_COLOR`/non-TTY; scrollback unchanged
  after the spinner.
- **M5 — Testing & observability.** Unit suites for `value-reader`,
  `command-tools`, `copilot-usage` cache/TTL/debounce, `copilotline-config`
  malformed-input, `doctor-report`; wire `bun test --coverage` + `bunfig.toml`
  threshold into CI; doctor probes for `sqlite3`, the internal endpoint, and cache
  age; release-gate `src/version.ts`; interpolate `VERSION` into HTTP headers.
  *Gate:* coverage floor enforced in CI; doctor surfaces each silent degradation.
- **M6 — DX & distribution.** `completion bash|zsh|fish` subcommand;
  consolidated env-var + config reference in README; `man/copilotline.1`;
  optional `upgrade` for the compiled binary. *Gate:* completions install-tested
  on all three OSes; docs reviewed by `/ai-docs`.

## 7. Definition of Done

1. A payload with `{"account":{"host":"attacker.tld"}}` causes **no** network
   request to any host other than the allowlist, proven by a test with an injected
   `fetchImpl` recording the URL.
2. `install` then `uninstall` on a `settings.json` containing comments leaves all
   comments intact (or, if the surgical approach is deferred, writes a `.bak` and
   prints a warning — decided in §9).
3. A single `selectCopilotAccount` invocation per `render`; zero foreground
   `gh`/`sqlite3`/second-git spawns on the render path.
4. Live and cached quota render identically for the unlimited and aliased cases.
5. `NO_COLOR=1` (non-empty) ⇒ output contains zero ANSI escapes; `--color always`
   overrides; the `default` preset renders legibly at 16/256/truecolor depths.
6. Rendered width never exceeds `process.stdout.columns`; severity is legible with
   color stripped (sigil + bar shape).
7. CI fails if statement coverage on touched files drops below 80% or branch below
   70%; the previously-untested units have suites.
8. `doctor` reports `sqlite3` availability, internal-endpoint health, cache age,
   and a version-consistency check; release fails on a `src/version.ts`/tag mismatch.
9. `bun run lint` (tsc strict), `bun test`, gitleaks, and CodeQL all green;
   CHANGELOG documents the palette rename and any behavioral change.

## 8. Quality Stamps

- **§10.8 Hexagonal Architecture** — new concerns land in infrastructure/presentation
  (`host-policy.ts`, `terminal-capabilities.ts`, `theme.ts`); the domain snapshot
  types stay pure render-time data.
- **§10.4 DRY** — one `parseQuotaSnapshot`, one palette/`paint()`, one color
  resolver replace the current triplicated value-readers and dual palettes.
- **§10.1 KISS / §10.7 Clean Code** — `cli.ts` sheds presentation + the duplicate
  `style()`; semantic tokens replace hue-keys.
- **§10.5 TDD** — every M0–M2 gate is expressed as a failing test first
  (security exfil test, comment-survival test, unlimited-parity test).
- **§10.6 SDD** — this brief is the contract `/ai-brainstorm` consumes; the spec
  it produces governs `/ai-plan` → `/ai-build`.
- **Hard Rules** — no suppressions; host allowlist is a security control not a
  risk-accept; palette rename is a hard rename documented in CHANGELOG (§13.3); no
  new runtime dependency (zero-dep width measurement, §13.7 single-source palette).

## 9. Open Decisions

1. **Comment-preserving write vs `.bak`+warn.** A surgical JSONC edit (locate and
   replace only the `statusLine`/`footer.showCustom` keys) fully preserves the
   file but is more code; a `.bak`+warning is cheap but still rewrites. Pick one in
   the spec. *(Recommendation: surgical edit — it is the only option that honours
   "never break the host's file".)*
2. **Zero-dep `displayWidth` vs the `string-width` dependency.** A small embedded
   East-Asian-width table keeps zero deps but must be maintained; `string-width`
   is correct but adds two transitive deps [ref 18]. *(Recommendation: zero-dep —
   the default glyph set is deliberately VS16-free, so a minimal table is correct.)*
3. **Dot bar vs eighth-block bar.** The block ramp raises resolution from 12.5% to
   ~1.5% but changes the visual identity. *(Recommendation: eighth-block.)*
4. **GHES Copilot quota support.** The allowlist permits `*.ghe.com`; do we also
   attempt GHES (`api.enterprise.githubcopilot.com`) [ref 23], or fail closed and
   show no quota there for now?
5. **Keep or drop `--capture`.** It is a niche schema-discovery flag with an
   arbitrary-write footgun (`src/cli.ts:131`). Keep + harden (resolve path, 0o600)
   or remove?
6. **Powerline separators** — ship as an opt-in preset now, or defer to a later
   wave given the host-prompt background-bleed risk?

## 10. Migration

- **Palette hue-keys → semantic tokens** is a hard rename with no compatibility
  shim (Hard Rule §13.3); the change is internal (no public API), documented in
  CHANGELOG.
- **Config `theme` block** is purely additive: absence is equivalent to the
  shipped `default` preset, so every existing `config.json` keeps working with no
  migration step and no shim.
- **settings.json write change** is a behavioral improvement (stops destroying
  comments); CHANGELOG notes that prior versions stripped comments.
- **New `--color`/`--theme` flags** are additive; env vars
  (`COPILOTLINE_THEME`, `COPILOTLINE_COLOR`, `COPILOTLINE_BG`,
  `COPILOTLINE_NO_SPINNER`) follow the existing `COPILOTLINE_*` precedent
  (`src/infrastructure/copilot-usage.ts:44`).

## 11. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|:---:|:---:|------------|
| Host allowlist breaks a legitimate GHE/tenancy user | Med | Med | Mirror go-gh patterns precisely [ref 21]; add GHE tests; allow an explicit per-host opt-in token bound to that host [ref 24] |
| Surgical settings edit mishandles an exotic JSONC file | Med | High | Property-test the editor against fuzzed JSONC; fall back to `.bak`+full-rewrite on parse ambiguity |
| Cache-only render shows stale quota right after login | High | Low | The freshness state machine (M4) signals staleness; first render triggers the background refresh |
| Zero-dep width table mis-measures an exotic glyph | Low | Low | Default glyph set is VS16-free single-cell; width math is exact for shipped presets |
| Color-depth downgrade picks a poor 256/16 match | Low | Low | Store explicit `256`/`16` values per token (reviewable), not auto-derived |
| Scope creep across six milestones | Med | Med | M0–M2 are independently shippable release-blockers; M3–M6 are incremental and gated |

## 12. References

External evidence gathered via `/ai-research` (Exa + web + Context7). NotebookLM
deep research was attempted but requires a one-time `uvx notebooklm login` that is
not yet configured on this host — recommended as a follow-up enrichment.

- [1] GitHub Copilot CLI config directory reference (statusLine/footer keys, JSONC) — docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference
- [2] "Customize GitHub Copilot CLI Status Line" — full stdin payload reference (`context_window.current_context_used_percentage`, `cost.total_premium_requests`, `remote.*`) — tgrall.github.io/blog/2026/05/02/copilot-cli-customize-statusline
- [3] github/copilot-cli #1311 — working config requires `STATUS_LINE` flag + `type:"command"`
- [4] github/copilot-cli #2582 — Configurable Status Line (shipped v0.0.413)
- [7] Oh My Posh configuration — blocks/segments, `palette`/`palettes`, `extends`
- [8] Starship configuration — style strings, truncation, `format`/`right_format`
- [11] powerlevel10k #62 — truecolor detection (`COLORTERM`) + `zsh/nearcolor` fallback
- [12] NO_COLOR specification — disable only when present and non-empty; flags override
- [13] powerlevel10k — shortest-unique-prefix directory truncation
- [15] Unicode TR11 East Asian Width / wcwidth (wide=2, ambiguous→narrow, VS16)
- [16] kitty #3998 — VS15/VS16 width disagreement across terminals
- [18] npm `string-width` — east-asian-width + strip-ansi, `ambiguousIsNarrow`
- [19] Bun docs — `bun build --compile`, `--target`, `--define` build-time constants
- [21] cli/go-gh `pkg/auth/auth.go` — `NormalizeHostname`/`IsTenancy`/`IsEnterprise`/token routing
- [23] github/gh-aw-firewall — GHEC `api.<tenant>.ghe.com`; GHES `api.enterprise.githubcopilot.com`
- [24] cli/cli #12928 — per-host token binding (`GH_TOKEN_<host>`) to prevent cross-host leakage
- Methodology: `/ai-design` SKILL (`.claude/skills/ai-design/SKILL.md`) and `/ai-animation` SKILL (`.claude/skills/ai-animation/SKILL.md`).

## 13. Glossary

- **statusLine** — the Copilot CLI `settings.json` key whose `command` receives
  session JSON on stdin and prints the footer line [ref 1].
- **JSONC** — JSON with comments and trailing commas; the format of `settings.json`.
- **SSRF** — Server-Side Request Forgery; here, redirecting a token-bearing
  request to an attacker host.
- **truecolor / 256 / 16** — 24-bit, 8-bit-indexed, and 4-bit ANSI color depths.
- **VS16** — Unicode Variation Selector-16 (`U+FE0F`), forcing emoji presentation
  and terminal-dependent display width.
- **EAW** — East Asian Width; the Unicode property used to compute display columns.
- **TTL / debounce** — cache freshness window (`CACHE_TTL_MS=60_000`) and
  re-spawn suppression (`REFRESH_DEBOUNCE_MS=30_000`), `src/infrastructure/copilot-usage.ts:19`.
- **powerline** — segmented prompt style using glyph separators and per-segment
  background colors.
- **tenancy host** — a GitHub Enterprise Cloud `*.ghe.com` host [ref 21].

## 14. Acceptance

- [ ] Token never sent to a non-allowlisted host (injected-`fetchImpl` test).
- [ ] settings.json comments survive install+uninstall (or `.bak`+warn per §9).
- [ ] `selectCopilotAccount` called once per render; no foreground subprocess on render path.
- [ ] Unlimited + aliased quota render identically from live and cache.
- [ ] `formatReset` deterministic under forced `TZ`; `readFlagValue` rejects flag-as-value.
- [ ] `NO_COLOR=1` ⇒ zero SGR; `--color always` overrides; default preset legible at 16/256/truecolor.
- [ ] Rendered width ≤ `stdout.columns`; severity legible color-stripped.
- [ ] Coverage floor enforced in CI; previously-untested units covered.
- [ ] doctor probes sqlite3 / internal endpoint / cache age / version; release gates `src/version.ts`.
- [ ] CHANGELOG documents the palette rename and settings-write change; all gates green.

---

## Appendix A — Terminal-UI Design System (from /ai-design)

**Principles:** never break the host (always reset SGR, never exceed `columns`,
sanitize interpolated data); legible-by-cluster (environment cluster vs
account/quota cluster); degrade as a pure function, never conditionally author;
meaning never carried by color alone; width is a budget.

**Semantic design tokens** (replace the hue-keyed palette; each token carries a
`[hexDark, hexLight, xterm256, ansi16]` ladder):

| Token | Dark | Light | 256 | 16 | Meaning channel |
|-------|------|-------|-----|----|-----------------|
| model | `#5FAFFF` | `#005FAF` | 75/25 | 94/34 | position (leftmost) |
| dir | `#5FD7D7` | `#008787` | 80/30 | 36 | position + glyph |
| git | `#5FD75F` | `#008700` | 77/28 | 36 | parens shape |
| gitDirty | `#FF8787` | `#D70000` | 210/160 | 31 | `*` glyph |
| session | `#BCBCBC` | `#444444` | 250/238 | 37/39 | clock glyph |
| accent | `#AF87FF` | `#8700AF` | 141/91 | 35 | account text (revives dead magenta) |
| muted | `#6C6C6C` | `#767676` | 242/243 | 2 | separators/units (dim) |
| ok | `#5FD75F` | `#008700` | 77/28 | 32 | bar fill, no sigil |
| warn | `#FFAF5F` | `#AF5F00` | 215/130 | 33 | bar fill + `!` sigil |
| crit | `#FF5F5F` | `#D70000` | 203/160 | 91/31 | bar fill + `!!`/`▲` sigil |

**Severity is three bands** (ok <50 / warn 50-89 / crit ≥90), each reinforced by a
non-color sigil so a collapsed `acct !!85%` reads as critical under `NO_COLOR` and
for color-blind users — the old four-band color-only scheme (`colorForPercentage`)
is replaced.

**Default glyph set is VS16-free** (single-cell BMP): context `✎` (U+270E, not
`✍️`), session `◷`, quota `◫`, worktree `⌥`, reset `↻`; `nerdfont` and `ascii`
sets ship alongside. **Width budget** reads `stdout.columns` and drops segments by
priority (agent → session → quota-detail → git-decoration → dir-truncate),
truncating the directory by shortest-unique-prefix while always keeping the leaf
and git-root.

**Color contract:** resolve depth once — `never`→strip SGR; `auto`→`NO_COLOR`
(present+non-empty) / non-TTY / `TERM=dumb` ⇒ none, `COLORTERM∈{truecolor,24bit}`
⇒ truecolor, `*-256color` ⇒ 256, else 16; `always` overrides. Always end any
colored line with `\x1b[0m`.

## Appendix B — Motion Model (from /ai-animation)

copilotline is **print-once** on the render path (no owned loop) and **owns the
TTY** only in the interactive picker. Therefore:

| Feature | Regime | Verdict |
|---------|--------|---------|
| Freshness state machine (fresh/refreshing/stale/error) | render (cross-repaint state) | **BUILD — highest value** |
| Stale = desaturated bar tint + `⟳?`; error = dim `⚠` (orthogonal to the red danger ramp) | render | **BUILD** |
| Cross-repaint quota easing | render | **DO NOT BUILD** — fabricates data; event-driven repaint cadence is uncontrollable; sub-cell deltas |
| `enrichAccounts` Braille spinner (`⠋⠙⠹…`, 80 ms/frame, TTY-gated, single-line `\r`+`\x1b[K`) | interactive | **BUILD — removes silent freeze** |
| One-shot confirmation flash (bright `✓` → settle, ≤400 ms, ease-out) | interactive | **BUILD** |
| Eighth-block partial-cell quota bar (`▏▎▍▌▋▊▉`, 12.5%→~1.5% resolution) | render | **BUILD — recommended** |
| Animated bar fill | render | **NOT FEASIBLE** (print-once) |

**Freshness states** derive from data already on disk: `ageMs`
(`src/infrastructure/copilot-usage.ts:71`), `CACHE_TTL_MS`/`REFRESH_DEBOUNCE_MS`
(`:19`), and the refresh marker (`:434`). The brief's "30 s debounce" is actually
60 s TTL + 30 s re-spawn suppression; the conjunction (age ≥ 60 s AND fresh
marker) makes "refreshing" detectable with **zero new IPC**. The only new
mechanism is a 1-byte sibling error-marker for the error state.

**Guardrails (binding):** never delay render output for animation; no
`setInterval`/`setTimeout` on the render path ever; honor `NO_COLOR`/`TERM=dumb`/
non-TTY (no motion when piped); add `COPILOTLINE_NO_SPINNER=1` opt-out; all
interactive motion is single-line and leaves scrollback unchanged; one timer max.

## Appendix C — ai-engineering skills to execute this spec

The user asked which framework skills to enlist. Mapping the canonical chain plus
specialists to each milestone:

**Canonical chain (drives the whole spec):**
`/ai-spec-draft` (this brief) → `/ai-brainstorm` (approve `spec.md`) →
`/ai-plan` (phased `plan.md`) → `/ai-build` or `/ai-autopilot` (the spec spans
≥3 concerns and ≥10 files → `/ai-autopilot` is the better fit) → `/ai-pr`.

**Per-milestone specialists:**

| Milestone | Primary skills | Why |
|-----------|----------------|-----|
| M0 Safety | `/ai-security` (SSRF allowlist verdict, dependency/secret gates), `/ai-test` (RED test for token-exfil + comment-survival), `/ai-verify` (evidence gate) | The allowlist is a security control; prove it with a failing test first |
| M1 Performance | `/ai-debug` (trace the 3× fan-out), `/ai-simplify` (extract account-resolution, dedupe value-readers), `/ai-test` | Behavior-preserving perf refactor needs guardrail tests |
| M2 Correctness | `/ai-test` (unlimited-parity, TZ determinism), `/ai-simplify` (unify `parseQuotaSnapshot`), `/ai-code` | Single shared parser + deterministic formatting |
| M3 Design system | `/ai-design` (the Appendix A system), `/ai-schema` (the `ThemeConfig` config schema), `/ai-code`, `/ai-test` | Schema-design the theme block; implement the token/glyph registries |
| M4 Motion | `/ai-animation` (Appendix B), `/ai-test` | Freshness state machine + interactive spinner; verify motion-off paths |
| M5 Testing/observability | `/ai-test` (coverage suites + CI wiring), `/ai-reliability-eval` (regression tracking), `/ai-pipeline` (CI `--coverage` gate + version-sync step), `/ai-verify` | Enforce the floor; add doctor probes |
| M6 DX/docs | `/ai-docs` (README env-var reference, man page, CHANGELOG), `/ai-prose` (announce), `/ai-pipeline` (release-asset completions) | Polish + documentation lifecycle |

**Cross-cutting / advisory:** `/ai-explore` (codebase research, already used),
`/ai-research` (external evidence, already used), `/ai-review --full` (already
produced the companion review), `/ai-advise` (governance drift checks during the
build), `/ai-governance` (pre-release compliance), `/ai-learn` (extract lessons
post-merge), `/ai-issue` (file the milestones as board work items),
`/ai-commit` (governed commits), `/ai-branch-cleanup` (post-merge hygiene),
`/ai-mcp-audit` (the tool already depends on `gh`/`sqlite3`/the internal endpoint —
audit those surfaces).

---

**Handoff:** review and edit, then advance with
`/ai-brainstorm --consume copilotline-statusline-excellence-brief.md`.
