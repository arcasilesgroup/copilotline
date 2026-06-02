---
execution_route:
  version: 1
  spec: spec-005
  executor: build
  automation: autonomous
  concern_count: 2
  estimated_files: 10
  reason: "Two cohesive concerns: a small security hardening at the runRender boundary (src/cli.ts + tests) and an install-wizard demo (VHS tape + harness + offline /user mock + README/DEMOS/CHANGELOG). No DAG, no parallel waves, all in-env (vhs+node installed; the token-ok mock has an in-build honest fallback). Under the autopilot threshold."
  safe_next_command: "/ai-build"
spec: spec-005
slug: harden-empty-object-and-install-demo
title: Harden render against contentless objects + install-wizard demo — execution plan
status: approved
pipeline: full
created: 2026-06-02
---

# Plan — spec-005 harden `{}` + install demo

## Code facts (read-only, 2026-06-02, post spec-004)

- `runRender` guard — `src/cli.ts:139`: `if (parsed.kind !== "payload") { …
  placeholder … return 0; }`. The contentless-object leak: a parsed object is
  `{kind:"payload"}` (`safeParse` `:771-784`, already gated by `asRecord`), so
  `{}`/`{"zzz":1}` skip the guard and reach `selectCopilotAccount(payload)` (`:168`).
- `asRecord` imported at `cli.ts:48`. The stderr diagnostic is gated on
  `parsed.kind === "invalid"` (`:140`), so a contentless *object* (kind=payload)
  naturally stays silent — D-005-02 needs no extra code there.
- Token "token ok" path: `resolveTokenForAccount` → `loginForToken(token, host,
  options)` → `options.fetchImpl ?? fetch` GET `${usageApiBaseForHost(host)}/user`
  (`copilot-account.ts:413-423`). The live CLI uses global `fetch`; the bundle is
  `bun build --target=node` run under Node, so `node --import <mock>.mjs` can
  patch global fetch/undici to answer `/user` offline → enables "token ok" with
  fabricated tokens, no network. (`fetchImpl` injection confirms the seam exists.)
- Demo harness: `docs/fixtures/render-demos.sh` (outside-VHS wrapper, exports
  `$CL_DEMO`, sources `$CL_DEMO/env.sh` in the tape), `seed-demo-shell.sh`
  (assembles the octocat env + writes env.sh; its `copilotline` shim appends
  `--no-account` to install — which SKIPS the picker, so the install demo needs a
  shim WITHOUT `--no-account`). Install picker enumerates accounts from
  `detectCopilotAccounts()` (Copilot config + VS Code sqlite3 + gh).

## Design (`--skip-design`)

No UI surface. Output contracts already decided in spec-005:
- Hardening: contentless object → silent `copilotline` placeholder (exit 0),
  like empty stdin; only JSON-parse failures keep the stderr diagnostic.
- Install demo: `copilotline install` → installed line → account box → "Choose
  quota account" with dummy octocat/monalisa/hubot → a typed `Select` answer →
  confirmation. "token ok" via offline `/user` mock; fallback "token missing".

## Architecture

`ad-hoc` — guard clause at the CLI boundary (`runRender`) + demo tooling. Domain
untouched; no production token-verification change (mock is `node --import`,
demo-only).

## TDD

T-1 (RED contentless-object no-leak tests) precedes T-2 (GREEN predicate).

---

## Phase 1 — Hardening (TDD)

### T-1 — RED: contentless objects must not leak the account
- Agent: build
- Files: `tests/cli.test.ts` (extend the spec-004 `runNoLeak` octocat-fixture harness)
- Principles applied: §10.5 TDD, §10.7 Clean Code
- Patch (deterministic): — (judgment: new cases)
- Detail: reuse the detection-ENABLED octocat fixture (`COPILOTLINE_ACCOUNT:"1"`,
  `COPILOTLINE_USAGE:"1"`, fixture `COPILOT_HOME`, empty PATH, nonexistent VS Code
  DB). Add cases asserting `stdout.trim()==="copilotline"`, no `octocat`/`credits`/`/\d+%/`,
  exit 0 for: `{}`, `{"zzz":1}`, `{"foo":"bar"}`, `[]` already covered. Add a POSITIVE
  case: `{"model":{"displayName":"GPT-5.4"}}` (single recognized key, masked `run()` ok)
  still renders `GPT-5.4` — guards against over-tightening.
- Gate: the contentless-object cases FAIL against current `src/cli.ts` (leak octocat);
  the positive + spec-004 golden pass.

### T-2 — GREEN: recognized-payload predicate
- Agent: build
- Files: `src/cli.ts` (near `safeParse` ~`:786`, and the guard `:139`)
- Principles applied: §10.3 SOLID, §10.7 Clean Code
- Patch (deterministic):
  ```diff
  +const RECOGNIZED_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  +  // Authoritative union of every top-level key read by buildStatusSnapshot,
  +  // normalizeModel/Context/Quota/Session, quotaFromSnapshots/Headers,
  +  // accountLoginFromInput, and selectCopilotAccount. UPDATE this whenever a new
  +  // top-level read path is added to render-status-line.ts / copilot-account.ts.
  +  "model", "previewModel", "effort", "effort_level", "effortLevel", "reasoning",
  +  "agent", "mode", "task", "session", "session_id", "sessionId", "cost",
  +  "context_window", "contextWindow", "context", "cwd", "workingDirectory",
  +  "workspace", "quota_snapshots", "quotaSnapshots", "copilot_quota_snapshots",
  +  "copilotQuotaSnapshots", "usage", "response", "event", "headers",
  +  "quota_headers", "quotaHeaders", "quota", "quota_window", "quotaWindow",
  +  "quota_reset_date", "quotaResetDate", "quota_reset_date_utc",
  +  "quotaResetDateUtc", "account", "github", "user", "authentication", "copilot",
  +]);
  +
  +function isRecognizedPayload(value: unknown): boolean {
  +  const record = asRecord(value);
  +  if (record === undefined) {
  +    return false;
  +  }
  +  for (const key of Object.keys(record)) {
  +    if (RECOGNIZED_PAYLOAD_KEYS.has(key)) {
  +      return true;
  +    }
  +  }
  +  return false;
  +}
  ```
  and the guard:
  ```diff
  -  if (parsed.kind !== "payload") {
  +  // A parsed object with NO recognized status key (e.g. `{}`, `{"zzz":1}`) is
  +  // not a real payload — treat it like empty stdin and never read the host
  +  // account. (spec-005 — closes the spec-004 `{}` boundary.)
  +  if (parsed.kind !== "payload" || !isRecognizedPayload(parsed.value)) {
  ```
- Gate: T-1 contentless cases now PASS; positive + golden pass; `tsc --noEmit` clean.
  (`bun run build` to refresh dist for the spawnSync tests.)

## Phase 2 — Install demo

### T-3 — Offline `/user` mock for "token ok"
- Agent: build
- Files: `docs/fixtures/github-user-mock.mjs` (new)
- Principles applied: §10.2 YAGNI, §10.7 Clean Code
- Patch (deterministic): — (judgment: undici intercept)
- Detail: a `node --import`-able ESM that intercepts `GET https://api.github.com/user`
  (and `*.ghe.com` if needed) and replies `{ "login": <derived> }` based on the
  Authorization bearer token, so fabricated per-login tokens verify offline.
  Map convention: token `demo-<login>` → `{login:"<login>"}` (so `demo-octocat` →
  octocat). Use undici `MockAgent` + `setGlobalDispatcher` (Node global fetch is
  undici). Demo-only — never imported by `src/`.
- Gate: `node --import docs/fixtures/github-user-mock.mjs -e "const r=await fetch('https://api.github.com/user',{headers:{authorization:'Bearer demo-octocat'}}); console.log((await r.json()).login)"`
  prints `octocat` with no network.

### T-4 — Install-demo seeding + tape
- Agent: build
- Files: `docs/fixtures/seed-demo-shell.sh` (extend with an install mode, OR new `seed-install-shell.sh`), `docs/demo-install.tape` (new)
- Principles applied: §10.4 DRY, §10.7 Clean Code, §10.6 SDD
- Patch (deterministic): — (judgment)
- Detail: seed an isolated env that makes `detectCopilotAccounts()` list THREE
  fabricated accounts: `COPILOT_HOME/config.json` → octocat; a VS Code
  `state.vscdb` (via `sqlite3`) with `__GitHub.copilot-chat-monalisa` +
  `__GitHub.copilot-chat-hubot` rows; a `gh` stub exiting 1; `COPILOTLINE_CONFIG_DIR`
  → temp. Set per-login tokens `COPILOTLINE_GITHUB_TOKEN_{OCTOCAT,MONALISA,HUBOT}=demo-<login>`.
  The `copilotline` shim runs `node --import <repo>/docs/fixtures/github-user-mock.mjs $DEMO/cli.js "$@"`
  and does NOT append `--no-account` (so `install` shows the picker). `env.sh`
  exports all of it. The tape: `source $CL_DEMO/env.sh`, then `Type "copilotline install"` Enter,
  Sleep for the box+picker, `Type "1"` (or Enter to keep) at the `Select` prompt,
  Sleep, 5s hold. Pixel-tight canvas via the `magick -trim` loop. `Output "docs/demo-install.gif"`.
  If the mock fails to yield "token ok", proceed with honest "token missing" markers.
- Gate: `vhs validate` passes; the rendered final frame shows the picker with
  octocat/monalisa/hubot and a selection confirmation; only fabricated logins +
  `/tmp` paths appear.

### T-5 — Render + wire into the regen wrapper
- Agent: build
- Files: `docs/fixtures/render-demos.sh` (add a `render_one "docs/demo-install.tape" "/tmp/copilotline-demo-install"`), `docs/demo-install.gif` (new, generated)
- Principles applied: §10.4 DRY
- Patch (deterministic): — (judgment: bash wiring)
- Detail: extend the wrapper to seed (install mode) + render the install demo.
  Run it to produce `docs/demo-install.gif`. Verify non-trivial size + PII-free.
- Gate: `bash docs/fixtures/render-demos.sh` produces all three GIFs; install gif exists.

### T-6 — README + DEMOS.md
- Agent: build
- Files: `README.md`, `docs/DEMOS.md`
- Principles applied: §10.7 Clean Code
- Patch (deterministic): — (judgment: docs prose)
- Detail: reference `docs/demo-install.gif` in the README (Install or Demo section)
  with a caption ("first-run account picker"). Document regenerating it in
  `docs/DEMOS.md` (incl. the `github-user-mock.mjs` + multi-account seeding + the
  honest-fallback note). Hero + statusline/doctor demos unchanged.
- Gate: links resolve; README command parity preserved; no `--capture`.

## Phase 3 — Document + verify

### T-7 — CHANGELOG
- Agent: build
- Files: `CHANGELOG.md`
- Principles applied: §10.7 Clean Code
- Patch (deterministic): — (judgment)
- Detail: `## [Unreleased]` — `Fixed`/`Security`: render no longer reads the host
  account for a contentless/unrecognized JSON object (closes the spec-004 `{}`
  boundary). `Added`/`Changed`: install-wizard demo GIF.
- Gate: parses.

### T-8 — Terminal verification
- Agent: verify
- Files: repo (read-only)
- Principles applied: §10.5 TDD, §10.6 SDD
- Patch (deterministic): —
- Detail: `bun test` green (incl. contentless-object no-leak + positive); `tsc
  --noEmit` clean; `gitleaks detect --no-git --source docs` clean; `strings
  docs/demo-install.gif | grep -iE 'soydachi|/Users/|ghp_(?!octocat)|token'`
  shows only fabricated octocat/monalisa/hubot; manual repro `printf '{}' | node
  dist/cli.js render` → `copilotline` (NEVER a real account); `printf
  '{"model":{"displayName":"GPT-5.4"}}' | …` → renders. Maps AC-1..AC-6.
- Gate: all pass; report evidence.

---

## Phase ordering

T-1 (RED) → T-2 (GREEN) → T-3 (mock) → T-4 (seed+tape) → T-5 (render) → T-6 (docs)
→ T-7 (CHANGELOG) → T-8 (verify). T-3 before T-4 (tape needs the mock). All
automatable by `/ai-build`; no manual steps (mock has an honest in-build fallback).

## Quality Remediation

used: true
max_attempts: 1
Quality loop: verify 98/100 PASS + review PASS (0 blocker/critical/high), but 2
MEDIUM. Electing to close both (F1 is the same host-account leak class the user
asked to harden; shipping it would miss intent — a deliberate content-aware
refinement of D-005-01 Approach A):
- F1 (security): a recognized key with an EMPTY value (`{"model":{}}`,
  `{"account":{}}`, `{"cwd":""}`) passed the name-only predicate and still read
  the host account. Fix: predicate requires ≥1 recognized key with a MEANINGFUL
  value (non-null; object/array non-empty; string non-blank; number/boolean ok).
- F2 (correctness): add top-level `request` to the key set and accept a flat
  `x-quota-snapshot-*` header bag, so real header-only payloads aren't wrongly
  rejected. Update the constant's comment to stop overclaiming completeness.
Plus tests pinning: empty-valued recognized keys → placeholder/no-leak;
`{"context_window":{"used_percent":0}}` / `{"request":{"headers":{…}}}` →
render (no over-tightening).

## Quality Outcome

Initial assessment: verify 98/100 PASS + review PASS, with 2 MEDIUM (F1 empty-valued
recognized key still leaked; F2 `request`/`x-quota-snapshot-*` wrongly rejected).
One bounded remediation pass made `isRecognizedPayload` content-aware
(`isMeaningfulValue` + header-bag pattern + `request` key).
**Final reassessment → 0 blockers / 0 criticals / 0 highs → PASS.**
- Re-review (built + empirical): F1 closed (`{"model":{}}`/`{"account":{}}`/`{"cwd":""}`/
  `{}`/`{"zzz":1}` → placeholder, no host read); NO over-tightening (model/0%/header-bag/
  session/cwd minimal payloads all render); caller-supplied `{"account":{"login":"x"}}`
  does NOT leak the host account; demo+mock unaffected.
- Deterministic: `bun test` 104 pass / 0 fail; `tsc --noEmit` clean; gitleaks clean;
  source scope = `src/cli.ts` only; only `docs/demo-install.gif` added among gifs.
- By-design (not a finding): a REAL payload (recognized key with content, no account
  field) still surfaces the host quota — that is the core enrichment feature, identical
  to main; only contentless/empty inputs are guarded.

final_reassessment: pass

## Acceptance criteria mapping

AC-1/AC-3 → T-1+T-2. AC-2 → T-1 positive + spec-004 golden. AC-4 → T-3/T-4/T-5.
AC-5 → T-6. AC-6 → T-8.
