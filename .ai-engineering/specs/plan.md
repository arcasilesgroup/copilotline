---
execution_route:
  version: 1
  spec: spec-002
  executor: autopilot
  automation: autonomous
  concern_count: 7
  estimated_files: 20
  reason: "Full M0-M5 scope spanning 7 concerns (domain model, defensive parser/resolver, renderer label+units+used-only, units config+env, doctor probe, docs, demo/remotion) across ~20 files with TDD pairs — exceeds single-concern build threshold; waved autopilot delivery fits."
  safe_next_command: "/ai-autopilot"
spec: spec-002
status: approved
pipeline: full
---

# Plan — spec-002 Token-Based Billing Support for copilotline

Contract for execution. Migrate the Copilot quota statusline from
request/premium-request semantics to token/AI-credit semantics: a unit-aware
domain model, a defensive parser/resolver that degrades instead of lying,
credits-by-default display with a first-class count-only clause, units config,
a doctor probe, and the docs + demo rewrite. Derived from the approved spec
(`.ai-engineering/specs/spec.md`) and brief
(`.ai-engineering/specs/drafts/copilot-token-billing-support-brief.md`).

## Design

Design intent captured at `.ai-engineering/specs/spec-002/design-intent.md`
(auto-routed from /ai-plan because matched keyword: `ui`). Scope is bounded: it
reuses the spec-001 statusline design system; the only new visual element is the
no-allowance used-only clause (D-002-12) and the unit-derived noun (D-002-02).

design-routing: routed (matched keyword: ui) — focused design note captured (design system already shipped in spec-001)

## Architecture

Pattern: **Hexagonal / Ports-and-Adapters** (the project's existing pattern;
`architecture-patterns.md` is absent in this install — fail-open to the in-tree
convention). The migration keeps every concern in its current layer:

- **Domain** (`src/domain/status-line.ts`) owns the billing-shape-agnostic
  `QuotaSnapshot`; gains a `unit` discriminator + `costUsd` +
  `creditAllowanceSource`. Stays free of GitHub field names.
- **Infrastructure** (`copilot-usage.ts`, `quota-snapshot.ts`,
  `copilotline-config.ts`, `value-reader.ts`) absorbs upstream-shape uncertainty:
  defensive parse, unit-on-absence default, units config + env.
- **Application** (`render-status-line.ts`, `run-doctor.ts`, `cli.ts`) reads only
  the domain type: noun/units/used-only render, doctor probe, render wiring.
- **Presentation** (`doctor-report.ts`) unchanged (new probe row renders via the
  existing formatter).

No new runtime dependency. No backwards-compat shim (CLAUDE.md §13 rule 3): the
`QuotaSnapshot` field change is applied in place; absence of `unit` deserializes
to `"request"` so a stale cache renders as honest legacy data.

Dependency order: P1 (domain+parser) → P2 (resolver resilience) → P3 (renderer)
→ P4 (config) → P5 (doctor) → P6 (docs/demo) → P7 (final gate). P3 depends on
P1; P4/P5 depend on P3; P6 depends on P3+P4+P5; P2 can run alongside P1.

---

## Phase 1 — Token-aware domain model + parser foundation (spec M1)

- [ ] T-1 — Extend `QuotaSnapshot` with `unit` discriminator + `costUsd` + `creditAllowanceSource`
  - Agent: build
  - Files: src/domain/status-line.ts:31-47
  - Principles applied: §10.8 Hexagonal Architecture, §10.7 Clean Code
  - Patch (deterministic):
    ```diff
    @@ src/domain/status-line.ts: export interface QuotaSnapshot
     export interface QuotaSnapshot {
       login: string | null;
       host: string | null;
       label: string | null;
    +  unit: "request" | "credit" | "token";
       usedPercent: number | null;
       remainingPercent: number | null;
       entitlement: number | null;
       remaining: number | null;
       used: number | null;
       unlimited: boolean;
       overageUsed: number | null;
       overagePermitted: boolean | null;
    +  costUsd: number | null;
    +  creditAllowanceSource: string | null;
       resetAt: string | null;
       source: string | null;
       accountSource: string | null;
       tokenSource: string | null;
     }
    ```
  - Gate: type compiles in isolation; cascades to construction sites (T-2) — phase tsc gate after T-2.

- [ ] T-2 — Populate `unit`/`costUsd`/`creditAllowanceSource` at EVERY typed `QuotaSnapshot` construction site (src AND tests; default `unit:"request"`, others `null`)
  - Agent: build
  - Files: src/application/render-status-line.ts:319-344 (normalizeQuota return), :485-501 (quotaFromHeaderValue), :632-650 (emptyQuota); src/infrastructure/quota-snapshot.ts:36-57 (parseQuotaSnapshot return); src/infrastructure/copilot-usage.ts:357-373 (parseUsageCache), :331-375 (cache absent `unit` → "request"); **tests/render-account.test.ts:18-36 (the `quota()` factory — typed `QuotaSnapshot`)**, **tests/render-status-line.test.ts:136-152 (the typed `deps.quota` literal)**
  - Principles applied: §10.4 DRY, §10.7 Clean Code
  - Patch (deterministic): omitted — judgment: each site sets `unit:"request"`, `costUsd:null`, `creditAllowanceSource:null` (behavioral unit-derivation lands later in T-4/T-8). The two TYPED test literals MUST be included or `tsc` (tsconfig `include` covers `tests/**`) fails tree-wide; the loose `Record<string,unknown>` test inputs do not typecheck against `QuotaSnapshot` and need no change here.
  - Gate: `bun run lint` (tsc strict) green across the WHOLE tree (src + tests) — this is the Phase 1 compile gate.

- [ ] T-3 — RED: parser tests for unit derivation + unit-on-absence default + token/credit field mapping
  - Agent: build
  - Files: tests/quota-snapshot.test.ts:1-34, tests/copilot-usage.test.ts:1-55
  - Principles applied: §10.5 TDD
  - Patch (deterministic): omitted — judgment: add cases asserting (a) a request-count payload yields `unit:"request"`; (b) a credit/token-shaped snapshot yields `unit:"credit"|"token"`; (c) a cache entry lacking `unit` parses to `"request"`.
  - Gate: new tests present and RED before T-4.

- [ ] T-4 — GREEN: `parseQuotaSnapshot` maps any recognized numeric token/credit field generically; derive `unit`; relax the null guard so a used-only datum survives
  - Agent: build
  - Files: src/infrastructure/quota-snapshot.ts:9-58 (drop the `entitlement===null && remaining===null` discard for a usable `used`/token field), :83-88 (computeUsedQuota tolerant); src/infrastructure/copilot-usage.ts:229-257 (parseCopilotUsageResponse carries unit/costUsd)
  - Principles applied: §10.5 TDD, §10.2 YAGNI (key on shape, not guessed names)
  - Patch (deterministic): omitted — judgment (defensive parse, D-002-05).
  - Gate: T-3 tests GREEN; `bun test tests/quota-snapshot.test.ts tests/copilot-usage.test.ts`.

## Phase 2 — Resilient resolver / defensive parsing (spec M2) — parallelizable with P1

- [ ] T-5 — RED: degradation edge fixtures (empty `quota_snapshots`, unknown key, missing headers, zeroed counts, count-only-no-allowance) assert no-throw + correct degrade
  - Agent: build
  - Files: tests/copilot-usage.test.ts, tests/render-status-line.test.ts
  - Principles applied: §10.5 TDD
  - Patch (deterministic): omitted — judgment.
  - Gate: edge tests present and RED before T-6.

- [ ] T-6 — GREEN: defensive tolerances — unknown `quota_snapshots` keys map generically, absent `x-quota-snapshot-*` headers degrade, malformed payload never throws into the host prompt
  - Agent: build
  - Files: src/infrastructure/copilot-usage.ts:229-257; src/application/render-status-line.ts:347-392 (quotaFromSnapshots), :394-436 (quotaFromHeaders)
  - Principles applied: §10.5 TDD, §10.1 KISS
  - Patch (deterministic): omitted — judgment.
  - Gate: T-5 fixtures GREEN; no exception escapes the render path.

## Phase 3 — Renderer: noun/units, used-only clause, eligibility, unlimited gating (spec M0 + M2)

- [ ] T-7 — RED: renderer tests — noun from `unit` (credits/tokens/premium), used-only clause (no bar/no %/no denominator), `hasQuotaData` accepts token/credit + used-only, unlimited gated on `unit`, empty payload renders nothing
  - Agent: build
  - Files: tests/render-status-line.test.ts:15-197, tests/render-account.test.ts:18-36 (migrate the `quota()` factory)
  - Principles applied: §10.5 TDD
  - Patch (deterministic): omitted — judgment (migrate the request-count/premium assertions to token/credit + add the used-only and empty cases).
  - Gate: new renderer tests present and RED before T-8.

- [ ] T-8 — GREEN: `quotaSegment` noun mapping + native-unit fallback (D-002-02); first-class used-only clause (D-002-12); widen `hasQuotaData`; used-only path in `formatQuotaCounts`; gate `unlimited` on `unit` (D-002-10)
  - Agent: build
  - Files: src/application/render-status-line.ts:597-620 (quotaSegment), :622-630 (hasQuotaData), :744-755 (formatQuotaCounts), :599-605 (noun), :255-345 (normalizeQuota derives `unit` from a stdin `unit`/token-field signal so the synthetic demo literal T-13 and live stdin both render their true unit); src/infrastructure/quota-snapshot.ts:15-16 (unlimited gating)
  - Principles applied: §10.7 Clean Code, §10.8 Hexagonal Architecture
  - Patch (deterministic): omitted — judgment; see `.ai-engineering/specs/spec-002/design-intent.md` render shapes 1-4. Note: without the `normalizeQuota` `unit`-read, T-13's `label:"credits"` synthetic literal would still render the request-path noun.
  - Gate: T-7 GREEN incl. used-only + token-unit + empty-payload; `bun test tests/render-status-line.test.ts tests/render-account.test.ts`.

## Phase 4 — Units/cost config + env override (spec M3)

- [ ] T-9 — RED: config tests — `usage.units` (`credit|token|usd`) + `usage.showCost` parse + defaults + malformed-fallback; `COPILOTLINE_USAGE_UNITS` override
  - Agent: build
  - Files: tests/copilotline-config.test.ts
  - Principles applied: §10.5 TDD
  - Patch (deterministic): omitted — judgment.
  - Gate: config tests present and RED before T-10.

- [ ] T-10 — GREEN: extend `CopilotlineConfig` with an optional `usage` block (units default `credit`, showCost default `false`); read `COPILOTLINE_USAGE_UNITS`; thread units/showCost into the render path
  - Agent: build
  - Files: src/infrastructure/copilotline-config.ts:9-15 (type), :21-48 (read + fail-safe), :61-69 (default); src/infrastructure/copilot-usage.ts:46-49 (env-read sibling for `COPILOTLINE_USAGE_UNITS`); src/cli.ts:128-163 (read config, pass `usage` into the render path); src/application/render-status-line.ts:164-185 (extend `formatStatusLine`/`renderStatusLine` + `quotaSegment` to accept a `usage` option — they take no config today, so this is a deliberate signature change so `usage.units`/`showCost` reach `quotaSegment`)
  - Principles applied: §10.7 Clean Code, §10.1 KISS
  - Patch (deterministic): omitted — judgment.
  - Gate: T-9 GREEN; malformed config still falls back to defaults; `quotaSegment` honors `usage.units` (selecting only among units the payload exposes) and `usage.showCost`.

## Phase 5 — Doctor observability probe (spec M4)

- [ ] T-11 — RED: doctor test — a probe reports whether the upstream response carried token/credit vs legacy request-count fields; update the 4 inline `DoctorInput` literals
  - Agent: build
  - Files: tests/run-doctor.test.ts:27-29,59-61,91-93,123-125 (the 4 inline literals must gain the new field or compile breaks)
  - Principles applied: §10.5 TDD
  - Patch (deterministic): omitted — judgment.
  - Gate: doctor test present and RED before T-12; all 4 literals updated.

- [ ] T-12 — GREEN: add a `DoctorInput` field for the resolved upstream `unit` (+ token/credit-field presence) and emit an Account `DiagnosticLine`; populate it in `runDoctorCommand`
  - Agent: build
  - Files: src/application/run-doctor.ts:8-32 (DoctorInput), :132-180 (Account section line); src/cli.ts:299-323 (populate from the cached/parsed snapshot `unit`)
  - Principles applied: §10.8 Hexagonal Architecture (no domain change — a new `DiagnosticLine`), §10.7 Clean Code
  - Patch (deterministic): omitted — judgment (doctor.ts domain types unchanged; reuses `DiagnosticLine`).
  - Gate: T-11 GREEN; `bun test tests/run-doctor.test.ts`; tsc strict.

## Phase 6 — Docs + demo + synthetic literal (spec M5)

- [ ] T-13 — Update the doctor synthetic-render quota literal to credit semantics
  - Agent: build
  - Files: src/cli.ts:279-289
  - Principles applied: §10.7 Clean Code
  - Patch (deterministic):
    ```diff
    @@ src/cli.ts: runDoctorCommand renderPreview quota
           quota: {
             login: "copilot-user",
             host: "github.com",
    -        label: "premium",
    +        label: "credits",
    +        unit: "credit",
             usedPercent: 7,
    -        entitlement: 1_000,
    -        remaining: 930,
    +        entitlement: 1_500,
    +        remaining: 1_395,
             reset_at: "2026-06-01T00:00:00Z",
             accountSource: "copilot-config",
             tokenSource: null,
           },
    ```
  - Gate: doctor render preview shows credit semantics; tsc strict.

- [ ] T-14 — Rewrite the README "Premium usage and quota" section + quota/usage anchors for token/credit billing
  - Agent: build
  - Files: README.md:136-167 (section), :141 (example line), :147-151 (premium_models prose), :213-216 (COPILOTLINE_USAGE), :225-234 (cache table), :271-287 (troubleshooting); add `COPILOTLINE_USAGE_UNITS` + `usage.*` config docs
  - Principles applied: §10.6 SDD
  - Patch (deterministic): omitted — judgment (prose).
  - Gate: no stale "premium request" prose; env-var + config reference complete.

- [ ] T-15 — CHANGELOG breaking-change entry under `[Unreleased]`
  - Agent: build
  - Files: CHANGELOG.md:17 (### Changed), :24-26 (### Removed `**Breaking:**` convention)
  - Principles applied: §10.6 SDD, CLAUDE.md §13 rule 3 (document breakage)
  - Patch (deterministic): omitted — judgment: add a `**Breaking:**` bullet noting the quota segment now describes token/credit billing, the request-count "premium" display is retired as the default, the cache schema changed shape, and `unit`-on-absence keeps legacy caches honest.
  - Gate: CHANGELOG documents the field/display breakage.

- [ ] T-16 — SECURITY.md endpoint wording refresh
  - Agent: build
  - Files: SECURITY.md:47 (endpoint), :77 (internal quota endpoint shape)
  - Principles applied: §10.6 SDD
  - Patch (deterministic): omitted — judgment (keep best-effort framing; reflect token/credit metadata). Note (out of scope, flag only): line 51 references the removed `render --capture` flag — do NOT fix here (no scope creep); file a follow-up.
  - Gate: SECURITY accurately describes the best-effort token/credit fetch.

- [ ] T-17 — MARKETING.md premium wording
  - Agent: build
  - Files: docs/MARKETING.md:11, :18, :25
  - Principles applied: §10.6 SDD
  - Patch (deterministic): omitted — judgment (prose: "premium quota" → "token/credit usage").
  - Gate: no stale premium-request framing.

- [ ] T-18 — Remotion demo: drop the hard-coded `/300` request denominator and the `premium` label
  - Agent: build
  - Files: docs/remotion/src/Statusline.tsx:40-47 (the `* 300` used calc), :110-126 (the `premium` label + `{used}/300`)
  - Principles applied: §10.6 SDD, §10.4 DRY
  - Patch (deterministic): omitted — judgment: render a credit/token example consistent with the new render shapes (allowance-known or count-only); remove the fabricated 300 denominator.
  - Gate: remotion bundle builds; demo reflects token/credit billing.

## Phase 7 — Final verification gate (release readiness)

- [ ] T-19 — Full verification: tests, types, coverage, no-throw fuzz, host-safety
  - Agent: verify
  - Files: (read-only) entire `src/` + `tests/`
  - Principles applied: §10.5 TDD
  - Patch (deterministic): n/a (read-only).
  - Gate: `bun test` all green; `bun run lint` (tsc strict) clean; coverage floor held; malformed-input fuzz never throws; `NO_COLOR`/non-TTY/host-safety paths unchanged.

- [ ] T-20 — Governance + secrets guard
  - Agent: guard
  - Files: (advisory) staged changeset
  - Principles applied: CLAUDE.md §13 (secrets gate, no suppressions, CHANGELOG breakage)
  - Patch (deterministic): n/a (advisory).
  - Gate: token never persisted to cache or logged (grep the diff); no `# noqa`/`@ts-ignore`/etc.; CHANGELOG documents the breaking change; gitleaks clean.

---

## Definition of Done (rolls up the spec Goals)

1. Renderer never emits literal "premium" for a token/credit account; noun from `unit`.
2. `QuotaSnapshot` unit-aware in place; absent `unit` → `"request"`; no parallel type.
3. Malformed/empty/unknown payload degrades (cache → nothing); never throws.
4. Credits default with native-unit fallback; percent-of-allowance primary; USD opt-in off.
5. Used-only clause renders a count with no fabricated denominator (D-002-12).
6. Defensive resolver tolerates missing fields / unknown keys / vanished headers.
7. Token never cached or logged; cache stays `0600`.
8. `usage.units` + `usage.showCost` + `COPILOTLINE_USAGE_UNITS`; malformed config → defaults.
9. Doctor reports the upstream unit + token/credit-field presence.
10. All test suites migrated + green; degradation + count-only fixtures added.
11. README/CHANGELOG/SECURITY/MARKETING + synthetic literal + Remotion demo describe token/credit billing.
12. Zero new runtime deps; hexagonal boundaries intact.

## Risks carried from the spec

- Exact new field names / header persistence / allowance field are `[unsourced]`
  (spec Open Questions) — confirm against a live token-billed account; the
  defensive design (D-002-05/12) degrades safely if any stays unknown.
- The count-only / no-allowance path (D-002-12) is the most likely live shape —
  its fixture (T-5/T-7) is required, not optional.
