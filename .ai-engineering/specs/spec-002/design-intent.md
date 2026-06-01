# Design Intent — spec-002 (token/credit quota segment)

> Auto-routed from /ai-plan (design-routing matched keyword: `ui`). Scope is
> bounded: this reuses the spec-001 statusline design system wholesale (palette,
> `buildBar`, the U+1F4B8 glyph, severity bands, `formatCompactNumber` k/m,
> `formatReset`). The only NEW visual element is the no-allowance used-only clause
> (D-002-12) and the unit-derived noun (D-002-02). A full /ai-design pass was not
> re-run because the design system already shipped; this note consolidates the
> render contract the plan implements.

## Noun mapping (D-002-02)

The segment noun derives from `QuotaSnapshot.unit`, preserving any GitHub-supplied
`label`:

| `unit` | noun shown | when |
|--------|-----------|------|
| `credit` | `credits` (or the configured `usage.units`) | payload exposes credits |
| `token` | `tokens` | payload exposes token counts |
| `request` | `premium` (legacy) | payload still reports request counts |

`usage.units` selects only among units the payload actually exposes; otherwise the
segment falls back to the datum's native unit (never an empty "credits" segment).

## Render shapes

Reuse the existing segment skeleton `<glyph> [login ]<noun> …` and the existing
separators/colors. Four shapes:

1. **Allowance known** (unchanged shape, units reinterpreted):
   `<glyph> [login ]<noun> <bar> NN% <used>/<limit> [reset] [+overage]`
   Bar colored by used-percent via the existing `colorForPercentage` bands.
2. **Count-only, no allowance** (NEW — D-002-12, the most likely live shape):
   `<glyph> [login ]<noun> <used> used [reset]`
   No bar, no percent, no fabricated denominator. `used` rendered with
   `formatCompactNumber` (k/m). Neutral/white count color — severity color is
   suppressed because there is no denominator to judge fullness against.
3. **No usable datum**: segment omitted entirely (host prompt intact).
4. **Unlimited** (`unit === "request"` or an explicit `unlimited` flag — D-002-10):
   existing `<glyph> <noun> ∞` form. A raw `entitlement === -1` is NOT treated as
   unlimited for non-request units.

## Cost (D-002-02)

`usage.showCost` defaults off. When on AND `costUsd` is present, append a secondary
dim clause `≈ $X.XX` after the count clause. Never estimate cost; only render a
GitHub-reported `costUsd`.

## Inherited constraints (spec-001, unchanged)

`sanitizeText` on all interpolated data; always reset SGR; honor
`NO_COLOR`/non-TTY; never exceed `stdout.columns`; never break the host prompt.
The token is never rendered, cached, or logged.
