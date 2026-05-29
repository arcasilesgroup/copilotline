// Single allowlist boundary for every GitHub host the tool will send a
// token-bearing request to. The two token-bearing fetches in the codebase
// (account verification and Copilot usage) both build their base URL through
// `usageApiBaseForHost`, so enforcing the allowlist here closes the
// token-exfiltration path at one reviewable chokepoint.
//
// Policy (spec-001 D-001-03): GitHub.com and GHEC tenancy hosts
// (`<tenant>.ghe.com`) are allowed; everything else fails closed to
// github.com. GHES (`api.enterprise.githubcopilot.com`) is intentionally not
// allowlisted in this scope. Mirrors cli/go-gh `NormalizeHostname`/`IsTenancy`.

const GITHUB_DOTCOM = "github.com";
const GHE_COM_SUFFIX = ".ghe.com";

/** Strip scheme and trailing slash; default to github.com. Syntactic only. */
export function normalizeHost(host: string): string {
  return host.replace(/^https?:\/\//, "").replace(/\/$/, "") || GITHUB_DOTCOM;
}

/**
 * If `normalized` is a GHEC tenancy host, return its canonical
 * `<tenant>.ghe.com` form (collapsing any deeper subdomain, e.g.
 * `api.acme.ghe.com` -> `acme.ghe.com`). Returns null when it is not a
 * tenancy host.
 */
function tenancyHost(normalized: string): string | null {
  const lower = normalized.toLowerCase();
  if (!lower.endsWith(GHE_COM_SUFFIX)) {
    return null;
  }

  const labels = lower.slice(0, -GHE_COM_SUFFIX.length).split(".").filter(Boolean);
  const tenant = labels[labels.length - 1];
  return tenant ? `${tenant}${GHE_COM_SUFFIX}` : null;
}

/** True when the host is github.com or a GHEC tenancy host. */
export function isAllowedHost(host: string): boolean {
  const normalized = normalizeHost(host).toLowerCase();
  return normalized === GITHUB_DOTCOM || tenancyHost(normalized) !== null;
}

/**
 * Resolve `host` to an allowlisted host, failing closed to github.com for any
 * non-allowlisted input. A token bound to a non-allowlisted host therefore
 * goes to api.github.com (the user's own GitHub), where the login-match check
 * rejects the mismatched account — never to an attacker-controlled host.
 */
export function resolveAllowedHost(host: string): string {
  const normalized = normalizeHost(host);
  if (normalized.toLowerCase() === GITHUB_DOTCOM) {
    return GITHUB_DOTCOM;
  }
  return tenancyHost(normalized) ?? GITHUB_DOTCOM;
}

/** Build the API base URL for a host, after allowlist resolution. */
export function usageApiBaseForHost(host: string): string {
  const allowed = resolveAllowedHost(host);
  return allowed === GITHUB_DOTCOM ? "https://api.github.com" : `https://api.${allowed}`;
}
