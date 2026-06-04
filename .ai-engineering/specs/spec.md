---
id: spec-005
slug: harden-empty-object-and-install-demo
title: Harden render against contentless objects + add an install-wizard demo with dummy accounts
status: approved-pending
created: 2026-06-02
refs: []
---

# Harden render against contentless objects + install-wizard demo

## Summary

Two follow-ups to the copilotline render/demo work:

1. **Close the `{}` boundary (security).** spec-004 stopped empty/invalid/non-object
   stdin from leaking the host Copilot account, but deliberately left a known
   boundary: a *parsed object* is always treated as a payload, so `echo '{}' |
   copilotline render` (and any contentless/unrelated object like `{"zzz":1}`)
   still flows to `selectCopilotAccount` and renders the real host account +
   quota (`src/cli.ts` payload branch → `copilot-account.ts:59-94`). This spec
   closes that boundary: an object is only a real status payload if it carries at
   least one **recognized** top-level key.

2. **Add the missing install demo.** The README has no demo of `copilotline
   install`. The real install runs an interactive account picker ("Choose quota
   account") that lists the detected accounts and lets the user select which
   Copilot account's quota to follow. Add a faithful demo GIF that shows this
   flow with **multiple dummy example accounts** to choose from (no real PII).

### Current-state evidence (spec-005 research)

- Render `{}` path: `safeParse("{}")` → `asRecord({})` ok → `{kind:"payload"}` →
  `runRender` calls `selectCopilotAccount({})` (`cli.ts:168`) which reads
  `~/.copilot/config.json`, VS Code `state.vscdb`, and `gh auth status` → host
  account; then `quotaForRender` reads its cache. The 41 top-level keys the
  renderer + account/quota resolvers actually read are enumerable (model,
  context_window/contextWindow, cwd, session, quota_snapshots, account, agent,
  …); `{}` and `{"zzz":1}` contain none.
- Install picker: `runInstall` → `shouldPromptDuringInstall` (true when
  `--no-account` absent AND stdin+stdout are a TTY) → `runAccountCommand(["--interactive"])`
  → `runInteractiveAccountSetup` prints the account box + `Choose quota account`
  + numbered options (`1. ● Auto … · token ok` / `2. ○ <login> … · token ok`) +
  `Select [1-N]` (`cli.ts:554-639`). Candidates come from `detectCopilotAccounts()`
  (Copilot config + VS Code sqlite3 + `gh`). Under a real TTY (VHS), `install`
  shows the picker inline. The `token ok` marker requires a token that verifies
  against `api.github.com/user` (`copilot-account.ts:413-442`) — so dummy
  accounts show `token missing` offline unless that endpoint is mocked.

## Goals

1. `copilotline render` reads/renders the host account **only** when stdin is a
   real status payload (an object with ≥1 recognized top-level key). `{}` and any
   contentless/unrelated object emit the neutral `copilotline` placeholder
   (exit 0), with no account detection and no `gh`/`sqlite3` spawn.
2. A legitimate minimal real payload (e.g. `{"model":{…}}` or
   `{"context_window":{…}}`) still renders fully — no regression.
3. A new `docs/demo-install.gif` shows the real `copilotline install` flow:
   install → account box → "Choose quota account" listing **multiple dummy
   example accounts** → a selection → confirmation. PII-free, reproducible.
4. The README surfaces the install demo; the other demos and the static hero stay.

## Non-Goals

- **No change to production token verification.** The demo's "token ok" comes
  from a demo-only, offline mock of `api.github.com/user`; the live CLI keeps
  verifying tokens for real. No production env/flag is added to bypass it.
- **No change to the valid-payload render** beyond the recognized-key gate.
- **Not** narrowing the recognized-key set to a small "known real" subset
  (over-fitting risk); the predicate is the broad union of every top-level key
  the code reads (any one suffices).
- **Not** removing or restyling the statusline/doctor demos or the static hero.
- **No** new runtime dependency.

## Decisions

- **D-005-01 — Recognized-payload predicate.** Add `isRecognizedPayload(value)`:
  `asRecord(value)` is a record AND at least one of the recognized top-level keys
  is present. The recognized set is the **union** of every first-segment key read
  by `buildStatusSnapshot` / `normalizeModel|Context|Quota|Session` /
  `quotaFromSnapshots|Headers` / `accountLoginFromInput` / `selectCopilotAccount`
  (model, previewModel, effort, effort_level, effortLevel, reasoning, agent, mode,
  task, session, session_id, sessionId, cost, context_window, contextWindow,
  context, cwd, workingDirectory, workspace, quota_snapshots, quotaSnapshots,
  copilot_quota_snapshots, copilotQuotaSnapshots, usage, response, event, headers,
  quota_headers, quotaHeaders, quota, quota_window, quotaWindow, quota_reset_date,
  quotaResetDate, quota_reset_date_utc, quotaResetDateUtc, account, github, user,
  authentication, copilot). *Rationale:* a union keeps the false-rejection risk
  minimal while closing the contentless-object leak; extends (does not contradict)
  spec-004 D-004-01, which deferred this boundary.
- **D-005-02 — Apply at the `runRender` payload branch; treat contentless object
  like empty.** Rebrand the guard: `if (parsed.kind !== "payload" ||
  !isRecognizedPayload(parsed.value))` → placeholder branch. Do NOT change the
  `ParsedStdin` union. A contentless object is **valid JSON** but not a status
  payload, so it takes the **empty**-style silent placeholder path (no stderr
  diagnostic — that stays reserved for JSON-parse failures, D-004-04).
- **D-005-03 — The recognized-key set is authoritative + drift-guarded.** Keep it
  as a single named constant with a comment that it must be updated whenever a new
  top-level read path is added to `render-status-line.ts` / `copilot-account.ts`;
  a test pins the contentless-object behavior so a regression is caught.
- **D-005-04 — Install demo GIF (`docs/demo-install.gif`).** Show the real flow:
  `copilotline install` → `copilotline installed in …` → the account box (mode /
  system / selected) → `Choose quota account` listing **multiple dummy accounts**
  → a `Select [1-N]` choice typed → the confirmation line. Rendered via VHS
  through the deterministic outside-VHS harness; the picker runs inline (no
  `--no-account`).
- **D-005-05 — Dummy accounts, PII-free, offline.** Seed an isolated env so the
  picker lists the GitHub mascot logins **octocat / monalisa / hubot** (all
  fabricated): `COPILOT_HOME` config → octocat; a VS Code `state.vscdb` with
  `__GitHub.copilot-chat-monalisa` + `__GitHub.copilot-chat-hubot` rows; a `gh`
  stub that exits 1 (no host leak); `COPILOTLINE_CONFIG_DIR` → temp. "token ok"
  (green) is achieved by a **demo-only** offline mock of `api.github.com/user`
  (a node `--import` preload that returns the matching login for each fabricated
  per-login token) — no real token, no network, no production code touched. If the
  mock cannot intercept the bundled CLI's `fetch`, fall back to honest "token
  missing" markers (the multi-account picker is still demonstrated).
- **D-005-06 — Docs.** README references `docs/demo-install.gif` (Install/Demo
  section); `docs/DEMOS.md` documents regenerating it. The static hero and the
  statusline/doctor GIFs are unchanged.

## Approaches considered

- **A — Recognized-key union predicate at the render boundary (chosen).** Closes
  `{}` + all contentless objects with negligible false-rejection risk; localized
  to `src/cli.ts`. 
- **B — Require a small fixed key subset (e.g. only `model`/`context_window`).**
  Rejected: over-fits the undocumented payload; a valid integration variant could
  be wrongly rejected.
- **C — Demo via `copilotline account --interactive` piped selection instead of
  inline `install`.** Viable but less faithful; the inline `install` picker under
  VHS's TTY is the real first-run experience, so D-005-04 uses that.

## Acceptance Criteria

1. `printf '{}' | copilotline render`, `printf '{"zzz":1}' | …`, `printf
   '{"foo":"bar"}' | …` → stdout exactly `copilotline`, exit 0, NO host
   login/quota/model, NO `gh`/`sqlite3` spawn.
2. `printf '{"model":{"displayName":"GPT-5.4"}}' | copilotline render` renders the
   model segment (recognized key → real payload, not rejected); the spec-004
   golden (`model`+`contextWindow`) still renders `GPT-5.4` + `12%`.
3. New no-leak tests for contentless objects run with detection ENABLED against
   the fabricated octocat fixture (no `COPILOTLINE_ACCOUNT=0` masking) and assert
   the account never appears; a test pins that a single recognized key passes.
4. `docs/demo-install.gif` exists and shows: `copilotline install` → installed
   line → account box → `Choose quota account` with **≥3 dummy accounts**
   (octocat/monalisa/hubot) → a `Select` choice → confirmation. It is PII-free
   (only mascot logins + `/tmp/...` paths; no real login/token/machine path) and
   regenerable via the documented harness.
5. README references the install demo; `docs/DEMOS.md` documents its regeneration;
   static hero + statusline/doctor GIFs unchanged.
6. `bun test` green (incl. new tests), `tsc --noEmit` clean, `gitleaks` clean, no
   new runtime dependency.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|:---:|:---:|------------|
| Recognized-key set drifts (a future Copilot payload uses a new top-level key not in the set → wrongly rejected) | Low | Medium | Broad union of all current read paths; documented as authoritative + update-on-change (D-005-03); a future key change to the renderer would also touch this constant |
| Over-tightening rejects a real minimal payload | Low | Medium | Union (any one key) — minimal real shapes (`model`/`context_window`) pass; AC-2 golden guards it |
| Offline "token ok" mock can't intercept the bundled CLI's `fetch` | Medium | Low | Demo-only; fall back to honest "token missing" markers — the multi-account picker (the actual ask) still renders |
| Install-picker demo non-determinism under VHS (prompt + select) | Medium | Low | Reuse the proven outside-VHS harness; type/pipe the `Select` answer deterministically; hold on the final frame |
| Demo leaks a real account if seeding is incomplete | Low | Critical | `gh` stub exits 1, nonexistent VS Code DB for real path, isolated `COPILOT_HOME`/`COPILOTLINE_CONFIG_DIR`; PII grep + `strings` gate on the GIF (only octocat/monalisa/hubot allowed) |
| Mock preload adds a demo backdoor risk | Low | Medium | The mock lives only in `docs/fixtures/` and is invoked solely by the demo harness via `node --import`; production code path is untouched (Non-Goal) |
