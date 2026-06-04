---
title: "Token-Based Billing Support for copilotline"
status: draft
audience: ["copilotline maintainers", "/ai-brainstorm facilitator", "/ai-plan author"]
branch: main
length_estimate: "~520 lines; 1 implementation spec spanning domain/application/infrastructure + tests/docs"
authoring_style: "senior-engineer diagnostic-then-roadmap; dense; evidence-anchored (file:line)"
principles_required:
  - "§10.1 KISS — fewest moving parts; do not model the entire GitHub billing platform"
  - "§10.2 YAGNI — surface only what the data sources actually expose; no speculative cost engine"
  - "§10.5 TDD — RED first on every parser/renderer change; fixtures lead implementation"
  - "§10.6 SDD — this brief feeds /ai-brainstorm; no code before an approved spec"
  - "§10.7 Clean Code — token semantics named explicitly, not overloaded onto request fields"
  - "§10.8 Hexagonal Architecture — domain token model stays free of GitHub API shape; adapters absorb uncertainty"
delivery_mode: "spec-brief (pre-brainstorm hand-off)"
mantra: "Never break the host prompt. Never leak the token. Show real headroom or show nothing."
sources_consulted:
  - "src/domain/status-line.ts (QuotaSnapshot)"
  - "src/application/render-status-line.ts (quotaSegment, normalizeQuota, quotaFromHeaders, formatQuotaCounts, formatCompactNumber)"
  - "src/infrastructure/copilot-usage.ts (fetch, parse, cache)"
  - "src/infrastructure/quota-snapshot.ts (parseQuotaSnapshot, computeUsedQuota)"
  - "src/infrastructure/copilotline-config.ts (config schema)"
  - "tests/copilot-usage.test.ts, tests/quota-snapshot.test.ts, tests/render-status-line.test.ts, tests/render-account.test.ts"
  - "README.md, CHANGELOG.md, SECURITY.md, docs/MARKETING.md"
  - "GitHub Docs: usage-based billing for individuals / orgs; models-and-pricing; REST billing usage; usage-limits"
  - "GitHub Blog + community Discussion #192948 (PRU -> AI Credits)"
  - "Third-party reverse-engineering: tgrall statusline schema, DamianEdwards/copilot-cli-cost, avatorl, ccusage (community, treated as unsourced design references)"
---

## 1. Vision

copilotline renders a GitHub Copilot quota glyph that, as of June 1 2026, describes a billing model GitHub has retired. Today the statusline says "930 / 1000 premium" — premium *requests* — but GitHub now meters input + output + cached tokens, converts them to AI Credits at a fixed 1 credit = $0.01 USD, and governs spend with a base + flex monthly credit allowance plus user budgets. The vision is a statusline that tells the truth under the new economics: a token/credit-aware quota model in the domain, adapters that survive an *uncertain and undocumented* upstream data surface by preferring documented endpoints and degrading gracefully, and a render layer that frames consumption as percent-of-allowance with credits (and optional USD) secondary — reusing the k/m compact formatter we already ship. We do this without adding a single runtime dependency, without breaking the host CLI prompt, and without ever caching or leaking the Copilot token. Where GitHub has not documented the exact field shape, copilotline must read defensively and show nothing rather than show a confident lie.

## 2. Scope Boundary

In scope:

- A token/credit-aware domain `QuotaSnapshot` (token units, monthly token/credit entitlement, used/remaining, optional cost-in-USD, AI-credit allowance metadata).
- A data-source strategy resilient to the upstream shape being uncertain: prefer documented endpoints, treat `copilot_internal/user` and `x-quota-snapshot-*` headers as best-effort, degrade to the existing request-count display, then to nothing.
- Label and units changes in the renderer: the literal `"premium"` default becomes token/credit-appropriate; reuse `formatCompactNumber` (k/m) for token magnitudes.
- Config additions for display preference (units: credits | tokens | usd; show/hide cost).
- Doctor and observability probes that report which billing surface answered and whether token fields were present.
- Tests and fixtures rewritten for token/credit semantics; README / CHANGELOG / SECURITY / MARKETING doc updates.

Explicitly NOT in scope:

- A cost-estimation engine that multiplies token counts by per-model published rates (that is copilot-cli-cost's job; we prefer GitHub-reported credits, §9 OD-4).
- Hardcoding per-plan credit allowances (Pro 1,500 / Pro+ 7,000 / Max 20,000) as constants — allowance must be data-driven (§9 OD-3).
- Becoming a Copilot CLI SDK extension to read `session.rpc.usage.getMetrics()` / `totalNanoAiu` (a separate, larger architecture; deferred).
- Adding a billing-scoped OAuth/PAT flow to call `/users/{username}/settings/billing/usage` (auth-flow change; deferred to a follow-up spec, §9 OD-5).
- PRU-to-token conversion math (GitHub publishes no formula; §9 OD-6).
- Org/enterprise pooled-credit modelling and the Actions-minutes side of code-review billing.

## 3. Diagnostic Snapshot

The request/premium-request count model is woven through every layer; spec-001 (statusline excellence) already shipped (`.ai-engineering/specs/_history.md:7`), so this is a semantics change on a stable base, not a greenfield build.

- The domain currently models quota as **request counts**: `QuotaSnapshot` carries `entitlement`, `remaining`, `used`, `usedPercent`, `remainingPercent`, `overageUsed`, `overagePermitted`, with `unlimited` derived from `entitlement === -1` — `src/domain/status-line.ts:31-47`. There is no token, credit, or USD field anywhere in the type.
- The renderer currently labels the segment the literal string `"premium"`: `quotaSegment` falls back to `quota.label ?? "premium"` in two places — `src/application/render-status-line.ts:599-602` and `:605` (the unlimited branch). Under token billing "premium" is the wrong noun.
- The renderer currently draws a percent bar + percent + raw counts: `quotaSegment` composes `buildBar` (`src/application/render-status-line.ts:24-29`), `colorForPercentage`, and `formatQuotaCounts` showing `used/entitlement` — `src/application/render-status-line.ts:608-617`, with `formatQuotaCounts` at `:744-755`. Counts are rendered via `formatCompactNumber` (k/m suffixes) at `:757-771` — so large *token* magnitudes already format acceptably; the gap is the unit label and the entitlement scale, not the number formatter.
- The renderer currently decides display eligibility on **count** fields: `hasQuotaData` returns true only when `unlimited`, `usedPercent`, `entitlement`, `remaining`, or `used` is non-null — `src/application/render-status-line.ts:622-630`. A token-only payload with no `entitlement`/`remaining` would render nothing today.
- The renderer currently computes percent from counts when GitHub omits it: `normalizeQuota` reads `entitlement`/`remaining` aliases (`:307-310`) and computes `usedPercent` as `(used / entitlement) * 100` (`:314-317`). `computeUsedQuota = entitlement - remaining` is duplicated in `src/infrastructure/quota-snapshot.ts:83-88` and `src/application/render-status-line.ts:736-742`.
- The live fetch currently targets the undocumented internal endpoint with a stale API version: `COPILOT_USAGE_URL = https://api.github.com/copilot_internal/user` (`src/infrastructure/copilot-usage.ts:19`), `API_VERSION = "2025-04-01"` (`:20`), sent as `X-GitHub-Api-Version` in the fetch (`:98-107`, header at `:106`). GitHub shipped REST API version `2026-03-10` [3]; our pin is stale for documented endpoints (and likely irrelevant to the internal one, which third-party tools call with `2022-11-28`).
- The parser currently keys on premium-request snapshot names: `parseCopilotUsageResponse` reads `quota_snapshots` and prefers `premium_models`, then `premium_interactions`, then `chat`, then `completions`, labelling them `premium`/`chat`/`completions`, plus a top-level `quota_reset_date` — `src/infrastructure/copilot-usage.ts:229-257` (priority at `:236-241`).
- The shared parser currently reads count fields and request-count overage: `parseQuotaSnapshot` reads `entitlement` (`src/infrastructure/quota-snapshot.ts:15`), `remaining`/`quota_remaining`/`quotaRemaining` (`:17-20`), `percent_remaining`/`percentRemaining` (`:21-23`), `overage_count` -> `overageUsed` (`:46`), `overage_permitted` (`:47-48`), `reset_date`; whole parser at `:9-58`.
- The header path currently parses request-count quota headers: `quotaFromHeaders` looks for `x-quota-snapshot-premium_models`/`..._interactions`/`chat`/`completions` (`src/application/render-status-line.ts:409-435`), and `quotaFromHeaderValue` decodes `ent`/`rem`/`ov`/`ovPerm`/`rst` via `URLSearchParams` (`:479-501`). These headers are entirely undocumented by GitHub [11].
- The cache currently persists the count-shaped snapshot: `UsageCache { fetchedAt, account, tokenSource, quota }` written `0600` — `src/infrastructure/copilot-usage.ts:26-31`, persisted at `:81-89`; re-read by `parseUsageCache` at `:363-365`.
- Config currently has no usage/units/budget surface: `CopilotlineConfig` is only `account.{mode, login, host}` — `src/infrastructure/copilotline-config.ts:9-15`, default at `:61-69`. There is nowhere to express "show credits vs tokens vs USD".
- The CLI demo currently fabricates request counts: the `--demo` payload sets `label: "premium"`, `entitlement: 1000`, `remaining: 930` — `src/cli.ts:279-288`.
- Tests currently assert the count model end to end: `tests/copilot-usage.test.ts:5-50` asserts `premium_models` priority and `premium_interactions` fallback with `overage_count`/`overage_permitted`; `tests/quota-snapshot.test.ts:6-33` asserts `entitlement:-1` unlimited and the `remaining`/`percent_remaining` aliases; `tests/render-status-line.test.ts:95-180` asserts count rendering and the `x-quota-snapshot-*` header params; `tests/render-account.test.ts:18-36` fixtures all seven count fields.

The crucial external finding: the data surface copilotline reads has *not been shown to change shape*. The closest live analog (`opencode-quota`) still parses the same request-count `quota_snapshots` from the same internal endpoint post-June-1, and pulls real token figures from an entirely separate source [10]. So this is primarily a **semantics + resilience** change, hardened against the possibility that GitHub adds token/credit fields (or removes the endpoint) at any time.

## 4. Architecture

Hexagonal layering is preserved: the domain owns a billing-shape-agnostic token model; adapters in `infrastructure/` absorb every flavour of GitHub uncertainty; the renderer in `application/` reads only the domain type.

Proposed structural changes:

1. **Token-aware domain `QuotaSnapshot`** (`src/domain/status-line.ts:31-47`). Extend, do not fork, the type with an explicit `unit: "request" | "credit" | "token"` discriminator and token/credit fields: `entitlement`/`remaining`/`used` keep their numeric meaning but are interpreted through `unit`; add `costUsd: number | null` (optional GitHub-reported dollar value) and `creditAllowanceSource: string | null` (which surface produced the allowance). `unlimited` stays. Per CONSTITUTION §3 this is a hard field change, not a parallel `TokenQuotaSnapshot` shim — fixtures and parsers migrate in the same change. The renderer reads `unit` to pick the noun; counts reuse `formatCompactNumber` (`:757-771`) unchanged.

2. **Data-source strategy that survives shape uncertainty.** A small ordered resolver in `infrastructure/` with graceful degradation:

```
                    +------------------------------+
 statusline stdin ->| (informational only;         |  context_window.* tokens
 (host prompt)      |  NEVER cumulative spend)     |  = context fullness, not bill
                    +------------------------------+
                                  |
        +-------------------------+--------------------------+
        v                          v                          v
 [Tier A: documented]      [Tier B: best-effort]       [Tier C: degrade]
 /settings/billing/usage    copilot_internal/user        last-good cache
 (consumed credits/USD,     quota_snapshots.* + the      -> request-count view
  needs billing scope,      x-quota-snapshot-* headers   -> render nothing
  FUTURE — OD-5)            (undocumented, may add        (host prompt intact)
                            token/credit fields or
                            vanish; parse defensively)
```

   - Tier B remains the *current* default path (`copilot-usage.ts:19-20,98-107`) but the parser must tolerate: missing/zeroed `entitlement`/`remaining`; new unknown keys under `quota_snapshots` (e.g. a credits/AI-credit snapshot — name unknown, OD-1); and headers disappearing (OD-2). Unknown numeric fields map to the token/credit path; absence degrades to Tier C.
   - Tier C is "never break the host prompt": on any parse failure or empty payload, fall back to the last-good cache, then to an empty quota that renders nothing — `hasQuotaData` (`render-status-line.ts:622-630`) is widened to also accept token/credit fields, and the segment is simply omitted when no usable datum exists.
   - Tier A (documented billing usage REST API [12]) is the *forward* path but needs a billing-scoped token, so it is gated behind OD-5 and not built now.

3. **Label + units changes.** Replace the literal `"premium"` default in `quotaSegment` (`render-status-line.ts:599-602,605`) with a unit-derived noun: `credit`/`tokens` when `unit !== "request"`, preserving any GitHub-supplied `label`. The money-with-wings glyph (U+1F4B8) stays; the bar (`buildBar` `:24-29`), percent, and `formatCompactNumber` k/m output are reused verbatim. Percent-of-allowance stays the primary visual; credits/USD are the secondary count clause via `formatQuotaCounts` (`:744-755`).

4. **Config additions.** Extend `CopilotlineConfig` (`copilotline-config.ts:9-15`, default `:61-69`) with an optional `usage` block: `usage.units: "credit" | "token" | "usd"` (default `credit`), `usage.showCost: boolean` (default false). Malformed config must still fall back to defaults — the existing fail-safe parse (`:29-33`) is the pattern to mirror. A matching `COPILOTLINE_USAGE_UNITS` env override aligns with the existing `COPILOTLINE_*` family (`copilot-usage.ts:47,52`).

5. **Doctor + observability probes.** `run-doctor` already reports token availability/source; add a probe that records *which tier answered* and *whether token/credit fields were present* in the upstream response, so we can detect the day GitHub changes the shape. Bump documented-endpoint calls to `X-GitHub-Api-Version: 2026-03-10` [3]; leave the internal endpoint's header as-is or drop to the laxer value (OD-7).

Constraints held throughout: zero runtime deps (TypeScript/Bun); domain stays free of GitHub field names; the token is never written to the cache (`UsageCache` persists `tokenSource`, not the token — `copilot-usage.ts:26-31`) and never logged; render path never throws into the host prompt.

## 5. Evidence Catalog

| Claim | Evidence (file:line) |
|---|---|
| `QuotaSnapshot` is request-count shaped (no token/credit/USD field) | src/domain/status-line.ts:31-47 |
| Segment label defaults to literal `"premium"` | src/application/render-status-line.ts:599-602; :605 |
| Segment = bar + percent + counts + reset + overage | src/application/render-status-line.ts:597-620 |
| `buildBar` percent bar primitive | src/application/render-status-line.ts:24-29 |
| `formatQuotaCounts` renders `used/entitlement` | src/application/render-status-line.ts:744-755 |
| `formatCompactNumber` already does k/m suffixes | src/application/render-status-line.ts:757-771 |
| `hasQuotaData` gates on count fields only | src/application/render-status-line.ts:622-630 |
| `normalizeQuota` reads entitlement/remaining aliases; computes percent from counts | src/application/render-status-line.ts:307-317 |
| `computeUsedQuota = entitlement - remaining` (duplicated) | src/infrastructure/quota-snapshot.ts:83-88; src/application/render-status-line.ts:736-742 |
| Quota-source candidates `premium_models`/`premium_interactions`/`chat`/`completions` | src/application/render-status-line.ts:369-374 |
| Header path parses `x-quota-snapshot-*` | src/application/render-status-line.ts:409-435 |
| Header param schema `ent`/`rem`/`ov`/`ovPerm`/`rst` | src/application/render-status-line.ts:479-501 |
| Live endpoint = undocumented `copilot_internal/user` | src/infrastructure/copilot-usage.ts:19 |
| `API_VERSION = "2025-04-01"` (stale vs 2026-03-10) | src/infrastructure/copilot-usage.ts:20; :106 |
| `Editor-Version` hardcoded `copilotline/0.1.0` | src/infrastructure/copilot-usage.ts:101-106 |
| Parser prefers `premium_models` over fallbacks | src/infrastructure/copilot-usage.ts:236-241; :229-257 |
| `parseQuotaSnapshot` reads entitlement/remaining/percent/overage | src/infrastructure/quota-snapshot.ts:9-58 |
| `entitlement === -1` treated as unlimited | src/infrastructure/quota-snapshot.ts:15-16 |
| Cache schema `UsageCache` persists quota `0600`; token NOT stored | src/infrastructure/copilot-usage.ts:26-31; :81-89 |
| Cache re-read of entitlement/remaining/used | src/infrastructure/copilot-usage.ts:363-365 |
| Cache TTL / debounce constants | src/infrastructure/copilot-usage.ts:21-22 |
| `COPILOTLINE_USAGE` / `COPILOTLINE_CACHE_DIR` env | src/infrastructure/copilot-usage.ts:47; :52 |
| Token resolution env precedence | src/infrastructure/copilot-usage.ts:260-263 |
| Config schema is account-only (no usage/units/budget) | src/infrastructure/copilotline-config.ts:9-15; :61-69 |
| Config malformed-parse fail-safe pattern | src/infrastructure/copilotline-config.ts:29-33 |
| Doctor reports quota-token availability/source | src/application/run-doctor.ts:29-31; :165-178 |
| CLI demo fabricates request counts (`premium`,1000,930) | src/cli.ts:279-288 |
| Test: `premium_models` priority + `premium_interactions` fallback | tests/copilot-usage.test.ts:5-50 |
| Test: `entitlement:-1` unlimited + remaining/percent aliases | tests/quota-snapshot.test.ts:6-33 |
| Test: count rendering + `x-quota-snapshot-*` header params | tests/render-status-line.test.ts:95-180 |
| Test: 7-field count fixture | tests/render-account.test.ts:18-36 |
| README documents the request-based premium model + internal endpoint | README.md:136-151 |
| CHANGELOG documents entitlement:-1 + quota_remaining aliases | CHANGELOG.md:30-31 |
| SECURITY documents the internal endpoint + host allowlist | SECURITY.md:44-47 |
| spec-001 shipped (stable base) | .ai-engineering/specs/_history.md:7 |

## 6. Roadmap

Release-blockers first (M0–M2 must land together; the statusline is currently lying about live billing).

- **M0 — Truthful default label + non-misleading degradation (RELEASE-BLOCKER).** Stop asserting "premium" requests for token-billed accounts. Drive the segment noun from the (new) `unit` field; when the upstream shape is unrecognized, render nothing rather than a wrong count. *Gate:* no fabricated "premium" noun when `unit !== "request"`; host prompt never broken on any malformed/empty payload; `tests/render-status-line.test.ts` extended with a token-unit and an empty-payload case, both green.

- **M1 — Token-aware domain model (RELEASE-BLOCKER).** Extend `QuotaSnapshot` with `unit`, `costUsd`, `creditAllowanceSource`; migrate `normalizeQuota` / `parseQuotaSnapshot` / `computeUsedQuota` and all fixtures in one change. *Gate:* `bun test` green with token/credit fixtures; type compiles with zero new deps; `hasQuotaData` accepts token/credit data.

- **M2 — Resilient data-source resolver + defensive parsing (RELEASE-BLOCKER).** Tier B parser tolerates missing/zeroed fields, unknown `quota_snapshots` keys, and absent headers; Tier C cache/empty fallback wired. Bump documented-endpoint API version to `2026-03-10`. *Gate:* fuzz/edge fixtures (empty `quota_snapshots`, unknown key, missing headers, zeroed counts) all degrade without throwing; doctor probe records the answering tier.

- **M3 — Units/cost config + env override.** `usage.units` / `usage.showCost` config + `COPILOTLINE_USAGE_UNITS`. *Gate:* config round-trips; malformed config still falls back to defaults; render honours units.

- **M4 — Doctor + observability.** Doctor reports answering tier and token-field presence. *Gate:* doctor output asserts the new diagnostic lines in `tests/`.

- **M5 — Docs + demo.** README request-model section (README.md:136-151), CHANGELOG breakage entry, SECURITY note, MARKETING line, and the `--demo` payload (src/cli.ts:279-288) all describe token/credit billing. *Gate:* `/ai-docs` gate passes; no stale "premium request" prose remains.

## 7. Definition of Done

1. `QuotaSnapshot` carries an explicit `unit` discriminator plus `costUsd` and `creditAllowanceSource`; no parallel/compat snapshot type exists (CONSTITUTION §3).
2. The renderer never emits the literal noun "premium" for a token/credit-billed account; the noun derives from `unit`/`label`.
3. For any malformed, empty, or unrecognized upstream payload, the statusline degrades (last-good cache -> nothing) and never breaks the host CLI prompt or throws.
4. Token/credit magnitudes render through the existing `formatCompactNumber` k/m path with no new formatter.
5. Percent-of-allowance remains the primary visual; credits and (when `showCost`) USD are secondary.
6. The data resolver prefers documented surfaces, treats `copilot_internal/user` and `x-quota-snapshot-*` as best-effort, and tolerates the shape being uncertain (missing fields, unknown keys, vanished headers).
7. The Copilot token is never persisted to cache and never logged; cache remains `0600`.
8. `usage.units` (credit|token|usd) and `usage.showCost` are configurable via config file and `COPILOTLINE_USAGE_UNITS`; malformed config falls back to defaults.
9. Doctor reports which data tier answered and whether token/credit fields were present.
10. Documented-endpoint calls send `X-GitHub-Api-Version: 2026-03-10`.
11. All four affected test suites are migrated to token/credit semantics and green; new edge-case fixtures cover degradation.
12. README / CHANGELOG / SECURITY / MARKETING and the `--demo` payload describe token/credit billing; the CHANGELOG documents the breaking field change.
13. Zero new runtime dependencies; hexagonal boundaries intact (domain free of GitHub field names).

## 8. Quality Stamps

- **§10.1 KISS** — extend the existing `QuotaSnapshot` and reuse `formatCompactNumber`/`buildBar`; no new cost engine, no SDK extension.
- **§10.2 YAGNI** — model only fields the live surface exposes; defer the billing-usage REST API and PRU conversion until evidence demands them (OD-4/5/6).
- **§10.5 TDD** — every parser/renderer change is RED-first; edge fixtures (empty/unknown/zeroed) precede the resilient resolver.
- **§10.6 SDD** — this brief produces no code; it hands off to `/ai-brainstorm` for an approved spec.
- **§10.7 Clean Code** — token semantics are named via a `unit` discriminator, not silently overloaded onto request-count fields.
- **§10.8 Hexagonal Architecture** — domain owns a GitHub-shape-agnostic model; adapters absorb endpoint uncertainty; renderer reads only the domain type.
- Hard rules honoured: CONSTITUTION §3 (hard field migration, no compat shim, CHANGELOG documents breakage); secrets gate / no-suppression unaffected; anonymous content (no machine paths — see this brief's use of repo-relative paths only); SSOT (config is the one writable store for display prefs; cache is a labelled rebuildable derived store with TTL `copilot-usage.ts:21`).

## 9. Open Decisions

`/ai-brainstorm` must resolve these. Several depend on facts GitHub has **not documented**; confirm them by inspecting a live token-billed account before committing to a shape.

- **OD-1 — Does `copilot_internal/user` add token/credit fields under `quota_snapshots`, and what are the exact names?** Unknown/[unsourced] — no public source confirms a `credits`/`ai_credits` snapshot or token-denominated `entitlement` [10][11]. *Recommendation:* design the parser to map *any* recognized numeric token/credit field to the new `unit` path, but do not hardcode a field name until a live token-billed response is captured during `/ai-brainstorm`.
- **OD-2 — Do the `x-quota-snapshot-*` headers persist (and keep request-count units) under token billing?** Entirely undocumented [11], [unsourced]. *Recommendation:* keep parsing them best-effort; treat absence/zeroing as "no datum" and degrade. Do not block release on them.
- **OD-3 — Which allowance figure to display (dollar-pegged base vs base+flex included total: Pro 1,500 / Pro+ 7,000 / Max 20,000)?** Sources reconcile but disagree on framing [5]. *Recommendation:* never hardcode — read GitHub-reported allowance dynamically; if absent, show used/percent without a denominator.
- **OD-4 — Show estimated USD via per-model token rates, or only GitHub-reported credits/USD?** *Recommendation:* GitHub-reported only; make estimation out of scope (reasoning tokens are not separately priced [8], and per-model rate tables drift). `usage.showCost` defaults off.
- **OD-5 — Adopt the documented `/settings/billing/usage` REST API as a Tier A source?** It reports consumed usage, not remaining headroom, and needs a billing-scoped token [12] — an auth-flow change. *Recommendation:* defer to a follow-up spec; keep the resolver pluggable so Tier A can be added later.
- **OD-6 — PRU-to-token/credit conversion ratio.** GitHub publishes no formula; the models are structurally different [4], [unsourced as a number]. *Recommendation:* do not convert; render whatever unit the data is actually in.
- **OD-7 — Bump the internal endpoint's API version too, or only documented endpoints?** Third-party tools call the internal endpoint with `2022-11-28`, implying it is lax [3]. *Recommendation:* bump only documented-endpoint calls to `2026-03-10`; leave the internal call's header conservative.
- **OD-8 — Does the Copilot CLI statusline *stdin* payload expose tokens/credits/USD we could read without any network call?** The documented stdin payload still carries `cost.total_premium_requests` and a `context_window.*` token block that measures *context fullness, not cumulative billable spend*; no cost/credit field is documented and the schema is explicitly experimental [unsourced]. *Recommendation:* treat stdin `context_window.*` as informational only; do not present it as spend.

## 10. Migration

Per CONSTITUTION.md §3 this is a **hard migration with no backwards-compat shims**. The `QuotaSnapshot` field change (adding `unit`, `costUsd`, `creditAllowanceSource` and reinterpreting `entitlement`/`remaining`/`used`) is applied in place — there is no parallel `TokenQuotaSnapshot`, no dual-read fallback type, no deprecated alias kept "just in case". The cache schema (`UsageCache` at `copilot-usage.ts:26-31`) changes shape; old `usage-cache.json` files that fail to parse simply miss the cache and trigger a fresh fetch (the existing fail-safe), so no migration script is needed — stale cache is self-healing, not load-bearing. Fixtures and the `--demo` payload (`cli.ts:279-288`) are rewritten, not branched. The CHANGELOG documents the breakage explicitly: the quota segment now describes token/credit billing; the `premium`-request count display is retired as the default; the internal-endpoint shape is treated as best-effort with graceful degradation. Behavioural continuity for the *renderer* is preserved only where it is honest: an account that still reports request counts (e.g. legacy annual PRU plans [4]) renders via `unit: "request"` with the old "premium" noun — that is a correct, not a compat, code path.

## 11. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `copilot_internal/user` adds token fields under an unguessed name; parser misses them | High | Medium | Map any recognized numeric token/credit field generically (OD-1); doctor probe flags unknown keys; defensive default to degrade, not lie |
| `x-quota-snapshot-*` headers vanish or zero out under token billing | Medium | Medium | Treat as best-effort (OD-2); degrade to cache/nothing; never block render on headers |
| GitHub deprecates the undocumented internal endpoint entirely | Medium | High | Keep resolver pluggable so documented `/settings/billing/usage` (Tier A, OD-5) can be slotted in; degrade gracefully meanwhile |
| Hardcoding an allowance denominator (e.g. 1,500) goes stale as flex allotments shift [5] | High (if done) | Medium | Forbid hardcoding (OD-3); read allowance dynamically or show no denominator |
| Showing estimated USD overstates spend (reasoning tokens, pooled org credits) [8] | Medium | High (user trust) | GitHub-reported credits only (OD-4); `usage.showCost` off by default; never estimate |
| A parse change throws into the host CLI prompt | Low | Critical | DoD #3 + M0/M2 gate: total isolation; render-nothing fallback; tests assert no-throw on malformed input |
| Token value accidentally written to cache/log during refactor | Low | Critical | DoD #7; cache persists `tokenSource` not token (`copilot-usage.ts:26-31`); secret-scan gate on commit |
| Stale `API_VERSION 2025-04-01` rejected by a documented endpoint | Low | Medium | Bump documented calls to `2026-03-10` [3] (M2) |
| Reusing `entitlement === -1` unlimited semantics misreads a token payload | Medium | Medium | Gate unlimited detection on `unit === "request"` or an explicit `unlimited` flag, not on a raw `-1` token count |

## 12. References

[1] GitHub Blog — "GitHub Copilot is moving to usage-based billing." https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/ (corroborated)
[2] GitHub Docs — "Usage-based billing for individuals." https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals (corroborated; token categories, 1 credit = $0.01)
[3] GitHub Changelog — "REST API version 2026-03-10 is now available." https://github.blog/changelog/2026-03-12-rest-api-version-2026-03-10-is-now-available/ (corroborated)
[4] GitHub Community Discussion #192948 — PRU -> AI Credits, monthly auto-migration, annual stays legacy. https://github.com/orgs/community/discussions/192948 (corroborated; note: no published PRU->credit conversion formula)
[5] GitHub Docs — "Models and pricing for GitHub Copilot" (per-1M-token rates; reasoning tokens absent). https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing (corroborated)
[6] GitHub Docs — "Usage-based billing for organizations and enterprises" (pooled credits, no automatic fallback to cheaper models). https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises (corroborated)
[7] GitHub Docs — "Usage limits for GitHub Copilot" (session + weekly limits from April 20 2026). https://docs.github.com/en/copilot/concepts/usage-limits (corroborated)
[8] Reasoning tokens not separately priced — derived from [5] (corroborated by absence on the official pricing table)
[10] slkiser/opencode-quota — still parses `copilot_internal/user` request-count `quota_snapshots` post-change; token figures from a separate source. https://github.com/slkiser/opencode-quota (corroborated as evidence the internal shape is unchanged; forward-looking inference)
[11] `x-quota-snapshot-*` response headers — no GitHub doc, changelog, or community thread references them. [unsourced] (confirmed undocumented by absence)
[12] GitHub Docs — REST "Billing usage" (consumed usage by product/sku, not a remaining snapshot; needs billing scope). https://docs.github.com/en/rest/billing/usage?apiVersion=2026-03-10 (corroborated)
[13] tgrall — Copilot CLI statusline stdin schema (experimental; `cost.total_premium_requests` + `context_window.*`; no cost/credit field). https://tgrall.github.io/blog/2026/05/02/copilot-cli-customize-statusline ([unsourced] community reverse-engineering; not GitHub docs)
[14] DamianEdwards/copilot-cli-cost — SDK `session.rpc.usage.getMetrics()` -> `totalNanoAiu`; cost-segment display convention. https://github.com/DamianEdwards/copilot-cli-cost ([unsourced] community convention, not a GitHub standard)
[15] avatorl/copilot-cli-statusline; ryoppippi/ccusage — k/m + percent-of-budget + pacing UX conventions. https://github.com/avatorl/copilot-cli-statusline/ , https://github.com/ryoppippi/ccusage ([unsourced] community design references)
- Exact new `copilot_internal/user` token/credit field names: [unsourced] — must be confirmed during /ai-brainstorm (OD-1).
- `aic_quantity` / `aic_gross_amount` usage-report columns: [unsourced] — surfaced only in secondary sources; not confirmed on an authoritative GitHub Docs page.
- Whether the CLI stdin payload will be renamed to expose credits/USD: [unsourced] — genuinely undocumented (OD-8).
- The 10% auto-model-selection discount figure: [unsourced] — not found on the official pricing table.

## 13. Glossary

- **Premium Request Unit (PRU)** — the retired billing unit: one model interaction times a per-model multiplier. The model copilotline currently renders.
- **GitHub AI Credit** — the new included-usage unit; 1 credit = $0.01 USD. Replaces PRUs on monthly plans as of June 1 2026.
- **Token** — the underlying meter: input + output + cached tokens, priced per model per 1M tokens, converted to AI Credits. (Anthropic models add a separate cache-write cost.)
- **Base + flex allowance** — monthly credit allowance = fixed base (pegged to subscription price) + variable flex allotment; together the "included total".
- **Entitlement / remaining / used** — the count fields copilotline reads today; under token billing they must be reinterpreted through a `unit` discriminator.
- **`copilot_internal/user`** — the undocumented GitHub endpoint copilotline calls for live quota; unstable, best-effort.
- **`quota_snapshots`** — the response object keyed by `premium_models` / `premium_interactions` / `chat` / `completions` that copilotline parses.
- **`x-quota-snapshot-*` headers** — undocumented response headers mirroring `quota_snapshots`; copilotline's secondary quota source.
- **Tier A/B/C** — this brief's data-source strategy: documented billing API / best-effort internal endpoint / cache-then-nothing degradation.
- **U+1F4B8 (money-with-wings)** — the glyph prefixing the quota segment (referred to by codepoint per the no-emoji-prose convention).
- **Graceful degradation** — on uncertain/missing data, fall back to last-good cache then render nothing; never break the host prompt.

## 14. Acceptance

- [ ] `QuotaSnapshot` has an explicit `unit` discriminator plus `costUsd` and `creditAllowanceSource`; no parallel/compat snapshot type (CONSTITUTION §3).
- [ ] Renderer never emits the literal "premium" noun for a token/credit-billed account; noun derives from `unit`/`label`.
- [ ] Any malformed/empty/unrecognized payload degrades (cache -> nothing) and never breaks the host prompt or throws.
- [ ] Token/credit magnitudes reuse `formatCompactNumber` (k/m); no new formatter.
- [ ] Percent-of-allowance stays primary; credits and (when `showCost`) USD are secondary.
- [ ] Resolver prefers documented surfaces, treats `copilot_internal/user` + `x-quota-snapshot-*` as best-effort, tolerates missing fields / unknown keys / vanished headers.
- [ ] Copilot token never persisted to cache, never logged; cache stays `0600`.
- [ ] `usage.units` (credit|token|usd) and `usage.showCost` configurable via config file + `COPILOTLINE_USAGE_UNITS`; malformed config falls back to defaults.
- [ ] Doctor reports which data tier answered and whether token/credit fields were present.
- [ ] Documented-endpoint calls send `X-GitHub-Api-Version: 2026-03-10`.
- [ ] All four affected test suites migrated to token/credit semantics and green; degradation edge-case fixtures added.
- [ ] README / CHANGELOG / SECURITY / MARKETING and `--demo` payload describe token/credit billing; CHANGELOG documents the breaking field change.
- [ ] Zero new runtime dependencies; hexagonal boundaries intact (domain free of GitHub field names).

## Appendix A — Confirmed billing facts (for /ai-brainstorm grounding)

- Token-based usage billing effective June 1 2026; 1 AI Credit = $0.01 USD; metered on input + output + cached tokens, priced per model per 1M tokens [1][2][5].
- PRUs replaced by AI Credits; monthly Pro/Pro+ auto-migrate, annual stays on legacy PRU until expiry [4].
- Individual allowances (base + flex): Pro 1,500; Pro+ 7,000; Max 20,000. Business 1,900/user, Enterprise 3,900/user, pooled, with a June 1–Sep 1 2026 promo (3,000 / 7,000) [2][6].
- No automatic fallback to cheaper models on exhaustion; credits do not roll over; code completions and Next Edit Suggestions remain unlimited and unbilled [2][6].

## Appendix B — Things this brief deliberately does NOT assume

- That `copilot_internal/user` or `x-quota-snapshot-*` changed shape (no evidence either way; parse defensively).
- That the CLI stdin payload exposes spend (it exposes context-window fullness, not cumulative billing).
- Any specific new field name, allowance constant, or PRU conversion ratio (all OD-gated and/or [unsourced]).
