---
id: spec-004
slug: render-empty-stdin-pii
title: Guard render against empty/invalid stdin leaking the real account
status: approved-pending
created: 2026-06-02
refs: []
---

# Guard render against empty/invalid stdin leaking the real account

## Summary

`copilotline render` reads a Copilot status payload from stdin. When stdin is
**empty** or **not valid JSON**, `safeParse` silently returns `{}`
(`src/cli.ts:735-745`) and `runRender` then proceeds **unconditionally** to:
detect the host's real Copilot account (`selectCopilotAccount({})` →
`~/.copilot/config.json`, VS Code `sqlite3`, `gh auth status`,
`src/cli.ts:137` / `src/infrastructure/copilot-account.ts:59-94`), read that
account's cached quota (`quotaForRender(account)`, `src/cli.ts:138`), and start a
background refresh (`src/cli.ts:139`). The snapshot is built from `{}`, so the
model label falls back to the literal `"Copilot"`
(`src/application/render-status-line.ts:681`) and the live host quota flows in
via the `hasQuotaData` ternary (`render-status-line.ts:162`). Net effect:

```
echo '' | copilotline render
Copilot · 💸 <real-login> chat ●○○○○○○○ 3% 6/200 ⟳ …
```

This is a **PII leak** — any caller that pipes nothing (or garbage) gets the
host's real account login and quota rendered to stdout — plus an unnecessary
**side-effect** (spawning `gh` / `sqlite3` on every such call). It was masked in
the demo tooling and only surfaced because the demos pipe through VHS; it is a
latent privacy bug in the shipped CLI. This spec makes `render` treat
empty/invalid stdin as "no trustworthy payload": render a neutral placeholder,
read **nothing** from the host, exit 0.

## Goals

1. `copilotline render` with **empty** stdin never detects or reads the host
   Copilot account or quota, and never spawns `gh`/`sqlite3` for account
   detection. It emits a neutral, account-free placeholder and exits 0.
2. `copilotline render` with **invalid JSON** behaves the same on stdout (neutral
   placeholder, no host data, exit 0) and additionally emits a short diagnostic
   to **stderr** so the malformed input is observable.
3. A **valid** payload renders exactly as today (full ribbon, account, quota) —
   no regression to the host-invoked happy path.
4. `render --json` on empty/invalid stdin emits neutral JSON with **no** host
   account/quota fields populated, exit 0 (same stderr diagnostic on invalid).
5. The bare `copilotline` non-TTY invocation (which routes to `runRender`) shares
   the same guard.
6. Regression tests assert the empty/invalid paths leak no real account **without**
   relying on `COPILOTLINE_ACCOUNT=0` / `COPILOTLINE_USAGE=0` to mask detection.

## Non-Goals

- **No change to the valid-payload render.** Model, context, git, session, and
  quota segments for a real Copilot payload stay byte-for-byte as today.
- **The `"Copilot"` model-label fallback for a valid payload that lacks a model
  name** (`render-status-line.ts:681`) is out of scope — it is cosmetic and only
  reachable now via the bug. The no-payload placeholder (Goal 1) is a distinct,
  whole-line label.
- **Not** reworking how `COPILOTLINE_USAGE=0` interacts with account detection
  for valid payloads (it suppresses quota but not detection). That is a separate
  hardening; this spec's payload-presence guard already prevents the empty-stdin
  leak regardless.
- **No** new redaction framework, no changes to the quota/account model, no new
  runtime dependencies.
- **No** change to exit codes for the happy path; empty/invalid must stay exit 0
  so the Copilot CLI statusLine integration never surfaces an error.

## Decisions

- **D-004-01 — `safeParse` becomes a discriminated result.** Replace the
  `unknown`-returning `safeParse` (`src/cli.ts:735-745`) with a result that
  distinguishes the three cases: a non-empty parseable payload, **empty** stdin,
  and **invalid** JSON. `runRender` branches on this instead of being blind to a
  collapsed `{}`. *Rationale:* the leak exists precisely because empty and
  garbage both became `{}`; the fix must restore that distinction at the
  boundary, not deep in the domain.
- **D-004-02 — No host reads without a payload.** On the empty/invalid branches,
  `runRender` must **not** call `selectCopilotAccount`, `quotaForRender`, or
  `refreshCopilotUsageInBackground`. No account detection, no cache read, no
  background refresh, no `gh`/`sqlite3` spawn. *Rationale:* this is the actual
  PII + side-effect fix; gating display alone is insufficient because detection
  already ran at `cli.ts:137`.
- **D-004-03 — Neutral placeholder on stdout.** Empty and invalid stdin both
  print a static, account-free placeholder (`copilotline`) and exit 0. It
  contains no model, account, login, quota, or git data — nothing derived from
  the host. *Rationale:* the operator chose a visible neutral marker over a blank
  line; it must carry zero host-derived data.
- **D-004-04 — Invalid JSON is distinguished on stderr only.** Invalid JSON adds
  a single short diagnostic to **stderr** (e.g. `copilotline: ignoring invalid
  status JSON on stdin`); empty stdin prints no diagnostic. stdout is identical
  (the placeholder) in both cases, and stderr never carries host data.
  *Rationale:* the operator asked to distinguish the two; the meaningful,
  PII-safe difference is an observability signal on stderr, while stdout stays
  the neutral placeholder per D-004-03.
- **D-004-05 — `--json` stays neutral too.** `render --json` on empty/invalid
  stdin emits a neutral JSON object with no host account/quota fields populated
  (exit 0; invalid adds the D-004-04 stderr diagnostic). *Rationale:* the JSON
  path shares the same snapshot and would leak the same account fields; it must
  be guarded identically.
- **D-004-06 — One guard covers every render entry.** The bare `copilotline`
  non-TTY path and `render` / `render --json` all route through the same guarded
  `runRender` branch. *Rationale:* DRY; no second leak surface.

## Approaches considered

- **A — Guard at the `runRender` boundary (chosen).** Make `safeParse`
  discriminated (D-004-01) and branch in `runRender` before any host call
  (D-004-02). Smallest blast radius, fixes both PII and side-effects, leaves the
  domain untouched. The agent-mapped root cause lives exactly here.
- **B — Gate only the display (skip the segments when fields are null).** Leaves
  `selectCopilotAccount`/`quotaForRender` running (still spawns `gh`/`sqlite3`
  and reads the cache) but drops the segments from the output. *Rejected:* the
  host reads/side-effects still happen; only the visible symptom is hidden.
- **C — Require specific payload keys (e.g. `model`) before rendering anything.**
  Stricter, but risks regressing valid-but-partial payloads the renderer
  currently tolerates. *Rejected:* over-fits; the empty/invalid discriminant
  (A) is the precise signal.

## Acceptance Criteria

1. `printf '' | copilotline render` → stdout is exactly the placeholder
   (`copilotline\n`), exit 0; output contains **no** real login, quota numbers,
   model, or git branch; **no** `gh` or `sqlite3` process is spawned.
2. `printf 'not json' | copilotline render` → stdout is the placeholder, exit 0,
   **and** stderr contains an "invalid"/"ignoring" diagnostic; no host data; no
   `gh`/`sqlite3` spawn.
3. A valid status payload (e.g. the README sample) renders the full ribbon
   exactly as before — model, context %, dir+git, session, quota — proven by an
   unchanged snapshot/golden assertion.
4. `printf '' | copilotline render --json` and `printf 'x' | copilotline render
   --json` emit neutral JSON with no host account/quota fields populated, exit 0.
5. Bare `copilotline` with empty non-TTY stdin behaves like AC-1.
6. New tests cover AC-1/AC-2/AC-4 **with account detection NOT disabled** (no
   `COPILOTLINE_ACCOUNT=0` / `COPILOTLINE_USAGE=0` masking) — e.g. by pointing
   detection at a fixture account and asserting that account never appears in the
   output. Existing tests stay green.
7. No new runtime dependency; `bun test` + `tsc --noEmit` clean.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|:---:|:---:|------------|
| A consumer relied on bare `copilotline render` (no stdin) printing their account | Low | Low | That is the bug being fixed; document the change in CHANGELOG. Normal Copilot CLI operation always pipes a valid payload, so the happy path is unaffected. |
| `render --json` empty-input shape change breaks a script parsing it | Low | Low | The old shape leaked host data (the bug); document the neutral shape in CHANGELOG. exit code stays 0. |
| Over-tightening the discriminant rejects a valid-but-minimal payload the renderer tolerated | Low | Medium | Only **empty** and **JSON-parse-failure** take the guarded branch; any successfully-parsed object (even sparse) follows the existing render path (AC-3 golden test guards this). |
| Placeholder line confuses a user who expected nothing | Low | Low | Operator explicitly chose a neutral marker; it is account-free and only appears on misuse (host always sends valid JSON). |
| Hidden side-effect (`refreshCopilotUsageInBackground`) still fires on a guarded branch | Low | Medium | D-004-02 explicitly removes all three host calls from the empty/invalid branch; a test asserts no background refresh/process spawn. |
