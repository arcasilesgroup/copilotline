# Frontend / Terminal-UI Review — copilotline

> The "frontend" lens here is a **terminal-UI renderer** (ANSI status line), not
> React. Absorbs the design lens + the TypeScript type-safety lens applied to
> terminal rendering.

**Health score: 64/100** (start 100; −12 High [NO_COLOR violation on primary `render` output]; −6 Medium [no color-depth fallback]; −6 Medium [color-only quota/threshold signalling]; −6 Medium [no width-aware truncation]; −6 Medium [emoji/glyph width]; floor 0; 100−12−6−6−6−6 = 64. Palette dup + dead `magenta` scored Low, folded into detail.)

**Verdict:** Solid, well-typed normalization layer with a tasteful default statusline, but the primary `render` output ignores `NO_COLOR`/`TERM=dumb` (the interactive path honors them — inconsistent), has no color-depth fallback or width-awareness, and signals quota/context state with color alone.

## Findings

| # | Severity | Location | Issue | Recommendation |
|---|----------|----------|-------|----------------|
| 1 | High | `render-status-line.ts:19-39,167-184` | `NO_COLOR` / `TERM=dumb` not honored on the primary `render` output; always emits 24-bit truecolor + `\x1b[2m` dim. `cli.ts:602` honors them only for interactive helpers — inconsistent contract. | Gate ANSI behind a `colorEnabled()` check (mirror `cli.ts:602`); when disabled, emit plain text. Share via one ansi module. |
| 2 | Medium | `render-status-line.ts:19-21` | No color-depth fallback. `color()` only emits `38;2;r;g;b` truecolor; terminals without `COLORTERM=truecolor` (Apple Terminal, older PuTTY, tmux w/o `-T`) render garbage or approximate badly. | Detect depth (`COLORTERM`/`TERM`); degrade truecolor→256 (`38;5;n`)→16 (`3x`)→none. |
| 3 | Medium | `render-status-line.ts:602,648-671,711-725` | Quota/context state signaled by color only (green/orange/yellow/red thresholds). Fails for the ~8% color-blind and any no-color terminal — `48%` looks identical at all severities once color is stripped. | Add a non-color cue at high severity (e.g. `!`/`⚠` at ≥90%), or rely on the bar fill ratio which already encodes magnitude. |
| 4 | Medium | `render-status-line.ts:167-184` (no `columns` ref anywhere) | No width handling. `formatStatusLine` joins all segments unconditionally; on an 80-col terminal a full quota line + model + dir + git + session overflows and wraps/corrupts the Copilot footer. | Read `process.stdout.columns` (fallback `$COLUMNS`, then ~80); elide lowest-priority segments (agent → session → counts → reset) or truncate dir name when over budget. |
| 5 | Medium | `render-status-line.ts:13,602` | `CONTEXT_GLYPH = "✍️"` is emoji + VS16 (U+270D U+FE0F): width is terminal-dependent (1 vs 2 cells); code hard-codes two trailing spaces. README §"Emoji spacing" already concedes misalignment. Same risk for `💸`/`⎇`/`⏱`/`⟳`. | Prefer a single-cell glyph or measure with an east-asian-width-aware function; do not hard-code padding. Make the glyph set configurable for non-nerd-font terminals. |

## Detail (each High)

### Finding 1 — `NO_COLOR` not honored on primary output (High)
`render` is the hot path (`cli.ts:159` → `formatStatusLine`; `cli.ts:236` → `renderStatusLine`). Every segment builder paints unconditionally:
- `paint()` (`render-status-line.ts:707-709`) wraps in `${ansi}…${RESET}`,
- the separator `formatStatusLine:168` emits `\x1b[2m│\x1b[0m`,
- `buildBar:27`, `quotaSegment:656,670`, `sessionSegment:631`, `formatReset:843` all hard-emit escapes.

`color()` (line 19) only ever produces `\x1b[38;2;…m`. There is no `process.env.NO_COLOR` / `TERM` guard anywhere in the file (the only match in `src/` is `cli.ts:602`). This violates the [no-color.org](https://no-color.org) contract on the one output users pipe into Copilot CLI, and is internally inconsistent — `style()` in `cli.ts` correctly bails to plain text. Concrete impact: `NO_COLOR=1` gives clean interactive output but a statusline full of raw escape sequences. Remediation: extract a shared `colorEnabled()`/`paint()` into one ansi module consumed by both files; this also fixes the palette-duplication drift.

## Design & animation opportunities (for the improvement spec — ranked)

1. **Shared ansi module + theming presets** (highest leverage). Collapse `palette` (`render-status-line.ts:30-39`) and the duplicated `style()` codes (`cli.ts:606-611`, identical truecolor values — drift risk) into one module exporting named colors + a `colorEnabled()`/depth helper. Then expose `COPILOTLINE_THEME` presets (`default`, `mono`, `solarized`, `high-contrast`) and a `COPILOTLINE_NO_GLYPHS` ASCII mode (`|` separator, `~` worktree, `t` timer). Also removes dead `palette.magenta` (`:37`).
2. **Width-adaptive layout / segment priority.** Given `process.stdout.columns`, define a priority order and progressively elide (agent → reset → counts → session → git detail) plus dir-name truncation with `…`.
3. **Powerline / separator hierarchy.** Optional powerline separators (``/``) with per-segment bg, behind a nerd-font opt-in; today every segment is flat `│`-separated with no visual grouping of the account/quota cluster vs. environment cluster.
4. **Quota bar polish.** The 8-cell `●/○` bar is good; consider partial-cell glyphs (`▏▎▍▌`) for finer granularity and a severity glyph prefix (doubles as the no-color cue).
5. **Refresh affordance (animation).** Single-shot render today. A statusline can't animate itself, but a transient `⟳` "refreshing" marker or a dimmed stale-quota tint when serving cached data would communicate freshness. Keep any motion subtle and honor `NO_COLOR`/non-interactive → no marker.

## Accessibility notes
- **Color-only state** (Finding 3): green/orange/yellow/red thresholds carry all the severity meaning; numeric `%` is present but identical styling once color is stripped. The bar fill ratio partially mitigates context but the standalone `47%` does not.
- **Contrast on light backgrounds**: `palette.yellow = (230,200,0)` and `palette.white = (220,220,220)` are tuned for dark terminals; on a light/solarized-light background both fall well under 4.5:1. A high-contrast theme addresses this; truecolor with no theme switch cannot adapt to background luminance.
- **Dirty marker** `*` and the `∞` unlimited marker are real non-color glyphs — good; they survive `NO_COLOR`.

## TypeScript type-safety notes (render layer)
- **Clean overall.** The normalization layer is genuinely well-typed: `pickString` → `string | null`, `pickNumber` → `number | undefined`, `clampPercent:576` guards `null`/`undefined`/`!Number.isFinite`. Every `QuotaSnapshot`/`ContextSnapshot` field is explicitly `… | null` and the segment builders null-check before formatting. No `any` in the render layer.
- **`value-reader.ts:8` `return value as JsonRecord`** — NOT a finding: a safe narrowing immediately guarded by `typeof value !== "object" || value === null || Array.isArray(value)` at `:4`.
- **Minor (info):** `formatStatusLine:181` and `:668` use the `(segment): segment is string => Boolean(segment)` type-guard filter — idiomatic and correct.

## not_applicable / low_signal
- **React component design, hooks, JSX, error boundaries, virtualization** — not applicable; synchronous Node string builder, no React.
- **Forms / inputs** — not applicable; the only input is `prompt()` at `cli.ts:507` (single readline numeric selection, validated at `:514-518`).
- **`<img>`/CLS/lazy-loading, focus rings, touch targets, modals** — not applicable (terminal, no DOM).
- **`sanitizeText:727`** strips `\x00-\x1f\x7f-\x9f` from untrusted payload before painting — correct and load-bearing; prevents ANSI injection via the Copilot payload. Confirmed applied at every interpolation of external strings. No finding.
- **Typography rules** — `formatReset:843` and duration use plain ASCII; acceptable for a dense monospace statusline.

## Self-challenge
- *Is it simple enough that NO_COLOR doesn't matter?* No — `render` is the single output piped into Copilot CLI for every refresh; raw escapes when `NO_COLOR=1` is a concrete regression, and the codebase already honors it elsewhere. High stands.
- *Did I overcount width?* The `padding: 1` and Copilot's own footer chrome eat columns; a full quota+git+session line is ~70+ visible cells. Medium (not High) because many users run wide terminals — impact is conditional.
- *Is the emoji finding real or just README hand-waving?* Real and code-level: `CONTEXT_GLYPH` is U+270D+U+FE0F and the two hard-coded trailing spaces are a per-terminal hack. README concedes it.
- *Palette dup / dead magenta?* Low individually; folded into opportunity #1 rather than inflating the score.

## Validator handoff (YAML)
```yaml
findings:
  - id: frontend-1
    severity: high
    file: src/application/render-status-line.ts
    line: 19
    claim: "render output ignores NO_COLOR / TERM=dumb; always emits 24-bit truecolor + dim ANSI, unlike cli.ts:602 which honors them"
    fix: "extract shared colorEnabled()/paint() module; return bare text when color disabled"
  - id: frontend-2
    severity: medium
    file: src/application/render-status-line.ts
    line: 19
    claim: "no color-depth fallback; color() only emits 38;2;r;g;b truecolor, breaks on non-truecolor terminals"
    fix: "detect COLORTERM/TERM; degrade truecolor->256->16->none"
  - id: frontend-3
    severity: medium
    file: src/application/render-status-line.ts
    line: 711
    claim: "quota/context severity signaled by color alone; fails color-blind and NO_COLOR users"
    fix: "add non-color severity glyph at high thresholds or lean on bar fill ratio"
  - id: frontend-4
    severity: medium
    file: src/application/render-status-line.ts
    line: 167
    claim: "no width handling; formatStatusLine joins all segments unconditionally, overflows narrow terminals (no process.stdout.columns ref anywhere)"
    fix: "read stdout.columns; elide low-priority segments / truncate dir name over budget"
  - id: frontend-5
    severity: medium
    file: src/application/render-status-line.ts
    line: 13
    claim: "CONTEXT_GLYPH '✍️' is emoji+VS16 with terminal-dependent width; two trailing spaces hard-coded at line 602; same risk for 💸/⎇/⏱/⟳"
    fix: "use single-cell glyph or east-asian-width-aware measurement; offer ASCII glyph mode; stop hard-coding compensating padding"
  - id: frontend-6
    severity: low
    file: src/application/render-status-line.ts
    line: 30
    claim: "palette duplicates style() truecolor values (cli.ts:606-611) — drift risk; palette.magenta line 37 is dead"
    fix: "single shared ansi module; delete unused magenta"
```
