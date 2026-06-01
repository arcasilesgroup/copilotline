# Compatibility Review — copilotline

> This is the **initial release (v0.1.0, single commit)** — no prior shipped
> version to break. The lens is reframed to: cross-platform correctness,
> external-contract stability (Copilot status JSON, `~/.copilot/settings.json`,
> GitHub API), runtime/toolchain baselines, and release/installer parity.

**Health score: 80/100** (start 100; −6 Medium ×3 [version-sync drift, internal GitHub endpoint, sqlite3 silent gap] = −18; −2 Low ×1 [hardcoded header version] = −2; the settings.json comment-destruction is reframed as **not_applicable** for this lens — see Self-challenge. 100 − 18 − 2 = 80.)

**Verdict:** Cross-platform and installer/release plumbing are correct and defensively coded; the real residual risks are version-sync drift (`src/version.ts` is never validated against the release tag) and silent dependence on two fragile external contracts (the undocumented `/copilot_internal/user` endpoint and the optional `sqlite3` CLI).

## Findings

| # | Severity | Location | Issue | Recommendation |
|---|----------|----------|-------|----------------|
| 1 | Medium | `.github/workflows/release.yml:32-39` + `src/version.ts:1` | Release validates `package.json` version against the tag but **never** validates `src/version.ts`, which feeds `--version`, `HELP`, and `doctor`. A version bump that forgets `version.ts` ships binaries reporting a stale version. | Add a release-gate step asserting `src/version.ts` `VERSION` equals the tag, or derive `VERSION` from `package.json` at build time. |
| 2 | Medium | `src/infrastructure/copilot-usage.ts:17,96` | Hard dependency on undocumented internal endpoint `GET /copilot_internal/user`. GitHub can change/remove it with no notice, silently zeroing the usage statusline for all users. | Already gated behind cache + `COPILOTLINE_USAGE`; add a `doctor` probe that surfaces a non-200 from this endpoint, and document its unofficial status. |
| 3 | Medium | `src/infrastructure/copilot-account.ts:331-363` | VS Code account detection shells out to the `sqlite3` CLI. On minimal Linux/CI/Windows hosts without it, `spawnSync` sets `result.error` → returns `[]` silently. Detection degrades with no signal. | Handling is safe (no crash). Add a `doctor` line reporting `sqlite3` presence/absence; mention the dependency in README. |
| 4 | Low | `src/infrastructure/copilot-usage.ts:101-102` | `Editor-Version`/`Editor-Plugin-Version` headers are hardcoded `copilotline/0.1.0` (decoupled from `VERSION`). Goes stale every release; if GitHub ever min-version-gates these, requests break. | Interpolate `VERSION` from `src/version.ts` into the header string. |

## Detail (each High)

No High findings. The two candidate Highs from the pre-review brief were investigated and downgraded:

- **install.sh SHA-tool mismatch → FALSE POSITIVE.** `scripts/install.sh:40-48` selects `sha256sum` if present, else falls back to `shasum -a 256`, else errors out. The release workflow (`release.yml:83-95`) emits the matching format on every OS: `shasum -a 256` on Unix and a lowercased `Get-FileHash` with two-space separator on Windows — both consumable by `sha256sum --check` / `shasum --check` (`install.sh:103`). Tool selection and checksum format are correct and per-OS-aware.

- **settings.json JSONC comment destruction → not_applicable for this release.** The behavior is real (`copilot-settings-file.ts:22,43,93-145`) but it is not a *compatibility regression* in a v0.1.0 initial release; flagging it here would be cross-domain (correctness/UX), and the correctness reviewer already owns it as the Critical.

## Cross-platform matrix (concern → win/mac/linux status)

| Concern | Windows | macOS | Linux |
|---------|---------|-------|-------|
| Config dir resolution (`copilotline-config.ts:62-79`) | OK — `APPDATA`/Roaming fallback | OK — `Library/Application Support` | OK — `XDG_CONFIG_HOME`/`.config` |
| Cache dir resolution (`copilot-usage.ts:456-472`) | OK — `LOCALAPPDATA` fallback | OK — `Library/Caches` | OK — `XDG_CACHE_HOME`/`.cache` |
| VS Code state-db paths (`copilot-account.ts:365-389`) | OK — `APPDATA` layout | OK — `Library/Application Support` | OK — `.config` layout |
| Executable resolution (`command-tools.ts:34`) | OK — appends `.exe/.cmd/.bat` | OK — bare | OK — bare |
| `chmod`/private-mode (`copilot-usage.ts:479-490`) | OK — skipped on win32 | OK | OK (best-effort, try/catch) |
| `sqlite3` CLI dependency (`copilot-account.ts:333`) | DEGRADES silently if absent | usually present | DEGRADES silently if absent (Finding 3) |
| `gh` CLI discovery (`copilot-usage.ts:410-432`) | OK — PATH lookup | OK | OK |
| Installer coverage (`install.sh:50-80`) | **Not covered by shell installer** (exits 2 → directs to npm / `.exe` asset; documented) | OK (arm64/x64) | OK (arm64/x64) |
| Release binaries (`release.yml:64-68`) | OK — `copilotline-windows-x64.exe` built | OK (arm64+x64) | OK (x64+arm64) |
| Smoke test (`ci.yml:37-48`) | OK — pwsh variant | OK | OK |

The Windows installer "gap" is intentional and documented with npm + `.exe` asset as the migration path — not a defect.

## External-contract stability notes

- **Copilot status JSON (stdin payload):** Resilient. `accountFromPayload` and the render path use multi-path `pickString` alias lists (11 login aliases, 6 host aliases); `parseCopilotUsageResponse` probes 4 snapshot keys with graceful null fallbacks. Schema drift degrades gracefully rather than crashing. No finding.
- **`~/.copilot/settings.json` (user-owned):** `applySettingsMutations` round-trips through `parseSettings → JSON.stringify`, discarding JSONC comments and original formatting. Real and confirmed, but reframed as not a v0.1.0 compatibility regression (owned by correctness). Writes are atomic via temp-file + rename, which is correct.
- **GitHub `/user` endpoint:** Stable, documented, versioned (`X-GitHub-Api-Version: 2022-11-28`). No concern.
- **GitHub `/copilot_internal/user`:** Undocumented/internal. Finding 2 — the primary external-contract stability risk.
- **`gh auth status`/`gh auth token` text parsing:** Parses human-readable `gh` output via regex. Brittle against `gh` output changes, but failure mode is a clean null (no account), and `gh` is a user-provided tool, not a shipped contract. Below flag threshold.

## not_applicable / low_signal

- **settings.json comment destruction** — real behavior, but for an *initial* release there is no prior shipped contract to break; correctness/UX concern owned by another specialist; CONSTITUTION §13.3 forbids the backwards-compat shim that would normally remediate it.
- **install.sh SHA tool mismatch** — investigated, false positive (correct per-OS fallback).
- **Node 18 baseline vs APIs used** — verified compatible: global `fetch`, `AbortController`, `node:readline/promises` `createInterface`, async-iterated `process.stdin` are all stable on Node ≥18. No `structuredClone`/`node:sqlite`. tsconfig targets ES2022. ESM shebang injected at build via `--banner`; `"type":"module"` with `.js` import specifiers throughout — correct.
- **`bun install --frozen-lockfile`** — `bun.lock` present; zero runtime deps means the frozen install is trivially satisfiable on all three CI OSes.

## Self-challenge

1. **Is the case against flagging settings.json-comment-destruction stronger than for it?** Yes, for *this* lens — v0.1.0 is the first commit, so there is no prior consumer contract to regress. It is a genuine UX/correctness defect, correctly owned by the correctness reviewer. Demoting to not_applicable rather than double-counting.
2. **Is the Windows installer gap a finding?** No. Intentional, with a documented npm/`.exe` migration path.
3. **Are Findings 2/3 over-flagged given graceful degradation?** They do not crash (hence Medium not High) — but silent degradation of the headline feature (usage) and a core feature (multi-account detection) with zero operator-visible signal is a legitimate stability concern. The remediation is observability (a `doctor` probe).
4. **Did I confirm, not assume, the SHA tooling?** Yes — read both `install.sh:40-48,103` and `release.yml:83-95` and matched the emitted format per-OS. Downgraded the brief's suspected High to a false positive.

## Validator handoff (YAML)

```yaml
findings:
  - id: compatibility-1
    severity: medium
    file: .github/workflows/release.yml
    line: 32
    claim: "Release gate validates package.json against the tag but never validates src/version.ts, the source of CLI --version/HELP/doctor output. A bump that misses version.ts ships a stale-versioned binary."
    fix: "Add a release step asserting src/version.ts VERSION == tag, or derive VERSION from package.json at build time."
  - id: compatibility-2
    severity: medium
    file: src/infrastructure/copilot-usage.ts
    line: 96
    claim: "Hard dependency on undocumented internal endpoint /copilot_internal/user; GitHub may change/remove it silently, zeroing the usage statusline."
    fix: "Add a doctor probe that surfaces non-200 responses; document its unofficial status."
  - id: compatibility-3
    severity: medium
    file: src/infrastructure/copilot-account.ts
    line: 333
    claim: "VS Code account detection shells out to sqlite3; on hosts lacking it, detection returns [] silently with no user-visible signal."
    fix: "Add a doctor line reporting sqlite3 presence/absence; document the dependency."
  - id: compatibility-4
    severity: low
    file: src/infrastructure/copilot-usage.ts
    line: 101
    claim: "Editor-Version/Editor-Plugin-Version headers hardcoded to copilotline/0.1.0, decoupled from VERSION; goes stale every release."
    fix: "Interpolate VERSION from src/version.ts into the header strings."
```
