---
spec: spec-002
title: Token-Based Billing Support for copilotline
status: approved
effort: large
summary: Migrate copilotline's quota statusline from the retired request/premium-request model to GitHub's token-based AI-credit billing — a unit-aware QuotaSnapshot, a defensive best-effort data resolver that degrades instead of lying, credits-by-default display, and updated docs.
---

## Summary

As of 2026-06-01 GitHub Copilot retired its request / "premium request" billing
model and now meters input + output + cached tokens, converting them to GitHub
AI Credits (1 credit = $0.01 USD) governed by a base + flex monthly allowance.
copilotline's quota segment is request-count shaped end to end — the domain
`QuotaSnapshot` carries count fields (`src/domain/status-line.ts:31-47`), the
renderer hard-labels the segment the literal noun `"premium"`
(`src/application/render-status-line.ts:599-605`), and the parser keys on
`premium_models`/`premium_interactions`/`chat`/`completions`
(`src/infrastructure/copilot-usage.ts:236-241`). The statusline therefore now
describes a billing model that no longer exists. The undocumented data surface it
reads (`copilot_internal/user` and the `x-quota-snapshot-*` headers) shows no
evidence of having changed shape, so this is primarily a **semantics +
resilience** change, not an API rewrite: teach the domain a token/credit unit,
make the parser degrade instead of asserting a wrong count, display AI credits by
default, and never break the host prompt or leak the token while doing it. Full
companion analysis with 46 file:line citations lives in the consumed brief.

## Goals

- The renderer never emits the literal noun "premium" for a token/credit-billed
  account; the noun derives from a `unit` discriminator (or a GitHub-supplied
  `label`).
- The domain `QuotaSnapshot` is unit-aware (`request | credit | token`) with
  optional `costUsd` and `creditAllowanceSource`, applied in place — no parallel
  or compat snapshot type.
- For any malformed, empty, or unrecognized upstream payload the statusline
  degrades (last-good cache → render nothing) and never throws into the host CLI
  prompt.
- Display defaults to AI credits, but always renders the unit the data is
  actually in: `usage.units` selects only among units the payload exposes and
  otherwise falls back to the datum's native unit (so a request-shaped payload
  never renders an empty "credits" segment). Percent-of-allowance stays the
  primary visual; USD cost is opt-in and off by default.
- The denominator is dynamic only: show `used/limit` + bar when GitHub reports an
  allowance, and a `used`-only clause (no bar, no fabricated denominator) when it
  does not — including when the only datum is a raw used count with no
  entitlement.
- The data source is the best-effort internal endpoint (`copilot_internal/user`)
  plus the `x-quota-snapshot-*` headers, with cache→render-nothing degradation; it
  tolerates the shape being uncertain (missing fields, unknown keys, vanished
  headers) without throwing.
- The Copilot token is never persisted to cache and never logged; the cache stays
  owner-only (`0600`).
- `usage.units` (`credit|token|usd`) and `usage.showCost` are configurable via
  the config file and a `COPILOTLINE_USAGE_UNITS` env override; malformed config
  falls back to defaults.
- Doctor reports whether the internal endpoint answered and whether token/credit
  fields (vs. legacy request-count fields) were present in the response.
- All affected test suites migrate to token/credit semantics and stay green; new
  edge-case fixtures cover degradation paths.
- README, CHANGELOG, SECURITY, MARKETING, and the `--demo` payload describe
  token/credit billing; the CHANGELOG documents the breaking field change.
- Zero new runtime dependencies; the hexagonal boundary holds (domain stays free
  of GitHub field names).

## Non-Goals

- A cost-estimation engine that multiplies token counts by per-model published
  rates. We render GitHub-reported credits/USD only; estimation is out of scope.
- Hardcoding per-plan credit allowances (Pro 1,500 / Pro+ 7,000 / Max 20,000) as
  constants. Allowances must be data-driven.
- Adopting the documented `/settings/billing/usage` REST API (Tier A) as a data
  source. It needs a billing-scoped token (an auth-flow change) and is deferred
  to a follow-up spec. This spec builds no extension-point machinery for it — the
  later spec adds its own seam (YAGNI); this spec must simply not preclude it.
- Becoming a Copilot CLI SDK extension to read
  `session.rpc.usage.getMetrics()` / `totalNanoAiu`.
- PRU-to-token/credit conversion math (GitHub publishes no formula).
- Org/enterprise pooled-credit modelling and the Actions-minutes side of
  code-review billing.
- Changing any HTTP API-version or `Editor-Version` / `Editor-Plugin-Version`
  header. The internal endpoint keeps its current `X-GitHub-Api-Version`
  (`src/infrastructure/copilot-usage.ts:20`); the version-pin refresh is unrelated
  to billing and travels with the deferred Tier A spec.

## Decisions

- **D-002-01 — Extend `QuotaSnapshot` in place with a `unit` discriminator; no
  parallel type.** Add `unit: "request" | "credit" | "token"`, `costUsd: number |
  null`, and `creditAllowanceSource: string | null` to the existing domain type
  (`src/domain/status-line.ts:31-47`); `entitlement`/`remaining`/`used` keep their
  numeric meaning, reinterpreted through `unit`. A payload or cache entry that
  lacks `unit` deserializes to `"request"` (its pre-migration meaning), so a stale
  `usage-cache.json` from an older build renders as honest legacy request data,
  not a mislabeled token snapshot. *Rationale:* CLAUDE.md §13 rule 3 (no
  backwards-compat shims — hard rename/delete/migration) forbids a parallel
  `TokenQuotaSnapshot`, which would fork the parser and renderer. Extending in
  place preserves the hexagonal seam and lets the renderer pick the noun from one
  field. The `unit`-on-absence default closes the cache-migration gap without a
  schema-version field, since the cache parses field-by-field
  (`src/infrastructure/copilot-usage.ts:363-365`) and would otherwise silently
  yield a unit-less snapshot rendered through the new logic.
- **D-002-02 — Default display unit is AI credits; `showCost` off by default;
  `usage.units` selects only among units the payload exposes, else falls back to
  the datum's native `unit`.** If the live payload carries only a request count
  (the current and plausibly-persisting shape), the segment renders as requests
  even when `usage.units = credit` — the config never forces a unit the data does
  not contain, so "credits by default" can never produce an empty or fabricated
  credits segment. *Rationale:* AI credits are GitHub's own included-usage
  vocabulary (1 credit = $0.01) and match the billing UI users cross-reference, so
  they are the right default *when available*; but the endpoint may still report
  only request counts (Open Questions), and rendering the data's true unit beats
  asserting a unit that is not present. Surfacing USD by default overstates spend
  under pooled org credits and invites misreads, hence `showCost` off.
- **D-002-03 — Allowance denominator is dynamic only; never hardcode.** When
  GitHub reports an allowance, render `used/limit` + percent bar; when it does
  not, render the `used`-only clause (D-002-12) with no bar and no fabricated
  denominator. This requires relaxing the current parse and eligibility guards,
  which today discard any snapshot lacking `entitlement`/`remaining`/`usedPercent`
  (`src/infrastructure/quota-snapshot.ts:32-33`,
  `src/application/render-status-line.ts:622-630`, `:745-747`) — so a raw `used`
  count alone currently renders nothing; that guard widens under D-002-05/D-002-12.
  *Rationale:* flex allotments and promos shift the included total, so any baked
  constant goes stale and lies; showing no denominator is honest, showing a wrong
  one is not. The no-allowance, count-only case is the *most likely* live outcome,
  so it must be a first-class render path, not an afterthought.
- **D-002-04 — Data source is the best-effort internal endpoint plus its headers,
  with cache→render-nothing degradation; the documented billing API (Tier A) is
  deferred and no extension-point machinery is built for it now.** *Rationale:*
  the internal endpoint is the only source available without an auth-flow change
  and its shape appears unchanged post-migration. Building a "pluggable" resolver
  seam for a deferred consumer is speculative (§10.2 YAGNI) and would ship an
  untestable extension point; the Tier A follow-up spec adds its own seam. This
  spec must only avoid hard-coding assumptions that would *preclude* Tier A later.
- **D-002-05 — Defensive parse: map any recognized numeric token/credit field
  generically; tolerate missing/zeroed `entitlement`/`remaining`, unknown
  `quota_snapshots` keys, and absent `x-quota-snapshot-*` headers; never throw.**
  The display-eligibility check accepts token/credit data, not only the legacy
  count fields it gates on today (`src/application/render-status-line.ts:622-630`).
  *Rationale:* GitHub may add token/credit fields or remove
  the endpoint at any time; the exact field names are unknown today (see Open
  Questions), so the parser keys on shape, not a guessed name, and degrades rather
  than asserting a wrong value.
- **D-002-06 — No PRU→token/credit conversion.** Render whatever unit the data is
  actually in. *Rationale:* GitHub publishes no conversion formula and the models
  are structurally different; any conversion would fabricate a number.
- **D-002-07 — No API-version header change in this spec.** The internal endpoint
  keeps its current `X-GitHub-Api-Version: 2025-04-01`
  (`src/infrastructure/copilot-usage.ts:20`); the `2026-03-10` bump travels with
  the deferred Tier A documented-billing spec. *Rationale:* the only endpoint this
  spec calls is the undocumented internal one, which works at the current pin and
  is left conservative (D-002-04); since no documented endpoint is in scope, a
  version bump would have no call site and would be an unverifiable, risk-only
  change here.
- **D-002-08 — Treat the CLI stdin `context_window.*` block as context fullness,
  never as billable spend.** *Rationale:* the documented statusline payload
  exposes context-window tokens (how full the current session is), not cumulative
  billed tokens; presenting it as spend would mislead.
- **D-002-09 — Reuse `formatCompactNumber` (k/m) and `buildBar` for the
  number/bar primitives; percent-of-allowance stays the primary visual when an
  allowance exists.** "No new formatter" scopes to the magnitude/bar primitives —
  it does NOT forbid the small used-only display clause D-002-12 adds for the
  no-allowance case. *Rationale:* the existing compact formatter
  (`src/application/render-status-line.ts:757-771`) already renders large
  magnitudes; the gap is the unit label, the entitlement scale, and a count-only
  clause, not the number formatting itself (KISS / zero new deps).
- **D-002-10 — Gate `unlimited` detection on `unit === "request"` or an explicit
  `unlimited` flag, not on a raw `entitlement === -1`.** *Rationale:* a token
  payload could legitimately carry a count near or at `-1`-like sentinels;
  reusing the request-era `-1` heuristic
  (`src/infrastructure/quota-snapshot.ts:15-16`) would misrender a token account
  as unlimited.
- **D-002-11 — Ship full scope (M0–M5) in this spec: truthful label, token domain
  model, resilient resolver, units config + `COPILOTLINE_USAGE_UNITS`, doctor
  tier probe, and the docs + `--demo` rewrite.** *Rationale:* the statusline is
  actively lying about live billing; the truth-fix, its display surface, its
  observability, and its documentation are one coherent user-facing change and
  splitting them would ship a half-migrated tool.
- **D-002-12 — Add a first-class `used`-only render clause for the no-allowance
  case.** When a snapshot carries a usable `used` count (in any `unit`) but no
  allowance/entitlement, the quota segment renders the unit-labelled used count
  with no bar and no percent (e.g. a credits/tokens/requests "used so far"
  reading), instead of rendering nothing. The parse and eligibility guards that
  currently drop such a snapshot (`src/infrastructure/quota-snapshot.ts:32-33`,
  `src/application/render-status-line.ts:622-630`, `:745-747`) widen to permit it.
  *Rationale:* this is the most probable live shape (a count with no reported
  allowance, per Open Questions); D-002-03 promises a used-only display and the
  current machinery cannot produce one, so the branch must be named explicitly
  rather than left as an unsatisfiable goal. It is the only new render logic
  permitted under D-002-09.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|:---:|:---:|------------|
| `copilot_internal/user` adds token fields under an unguessed name; parser misses them | High | Medium | Map any recognized numeric token/credit field generically (D-002-05); doctor probe flags unknown keys; default to degrade, not lie |
| `x-quota-snapshot-*` headers vanish or zero out under token billing | Medium | Medium | Best-effort only (D-002-05); degrade to cache/nothing; never block render on headers |
| GitHub deprecates the undocumented internal endpoint entirely | Medium | High | Degrade gracefully to cache→nothing (D-002-04); the deferred Tier A documented-billing spec replaces the source without this spec precluding it |
| A parse change throws into the host CLI prompt | Low | Critical | Total isolation + render-nothing fallback (Goals); tests assert no-throw on malformed input |
| Token value accidentally written to cache/log during refactor | Low | Critical | Cache persists `tokenSource`, not the token (`src/infrastructure/copilot-usage.ts:26-31`); secret-scan gate on commit |
| Reusing `entitlement === -1` unlimited semantics misreads a token payload | Medium | Medium | Gate unlimited on `unit`/explicit flag (D-002-10) |
| Showing estimated USD overstates spend (pooled credits, reasoning tokens) | Medium | High | GitHub-reported credits only (D-002-02); `usage.showCost` off by default; never estimate |
| A stale request-shaped `usage-cache.json` is rendered through new unit logic after upgrade | Medium | Low | Absent `unit` deserializes to `"request"` (D-002-01), so a pre-migration cache renders as honest legacy data, not a mislabeled token snapshot |
| The count-only / no-allowance render path (D-002-12) is missed, so the likeliest live payload renders nothing | Medium | High | D-002-12 makes the used-only clause first-class; a count-only fixture with no allowance is a required test |
| Full-scope blast radius (M0–M5 in one PR) destabilizes a stable base | Medium | Medium | Milestone ordering lands release-blockers first; each milestone independently testable; `/ai-plan` decomposes into gated tasks |

## Open Questions

These depend on facts GitHub has not documented; confirm them against a live
token-billed account during `/ai-plan` or implementation. None blocks approval —
the defensive design (D-002-05) handles each by degrading rather than guessing.

- Does `copilot_internal/user` add token/credit fields under `quota_snapshots`,
  and what are the exact field names? (Currently `[unsourced]`.)
- Do the `x-quota-snapshot-*` headers persist under token billing, and in what
  units?
- Which field, if any, reports the monthly credit/token allowance (the
  denominator for D-002-03)?
- Does the Copilot CLI statusline stdin payload gain a credit/USD field we could
  read without a network call?

## References

- doc: .ai-engineering/specs/drafts/copilot-token-billing-support-brief.md
- doc: https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/
- doc: https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals
- doc: https://github.com/orgs/community/discussions/192948
- doc: https://github.blog/changelog/2026-03-12-rest-api-version-2026-03-10-is-now-available/
- doc: https://docs.github.com/en/rest/billing/usage?apiVersion=2026-03-10
