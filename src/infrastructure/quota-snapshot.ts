import type { QuotaSnapshot, QuotaUnit } from "../domain/status-line.js";

// Single source of truth for turning a GitHub quota snapshot object into a
// QuotaSnapshot. Consumed by both the live API path (copilot-usage) and the
// stdin-payload render path (render-status-line) so the same response renders
// identically whether it arrives live or from cache.
//
// Token-based billing (GitHub AI Credits, 2026-06-01) replaced the request /
// premium-request model. GitHub has NOT documented the new field names, so this
// parser keys on SHAPE, not a guessed name: it reads request/credit/token
// aliases generically, derives a `unit` discriminator, and defaults to the
// legacy `"request"` unit when no token/credit signal is present. A usable `used`
// count with no allowance survives (no fabricated denominator); only the legacy
// request unit treats `entitlement === -1` as unlimited.
const ENTITLEMENT_KEYS = [
  "entitlement",
  "credit_entitlement",
  "creditEntitlement",
  "token_entitlement",
  "tokenEntitlement",
  "allowance",
  "credit_allowance",
  "creditAllowance",
  "token_allowance",
  "tokenAllowance",
  "quota_entitlement",
];
const REMAINING_KEYS = [
  "remaining",
  "quota_remaining",
  "quotaRemaining",
  "credits_remaining",
  "creditsRemaining",
  "credit_remaining",
  "tokens_remaining",
  "tokensRemaining",
  "token_remaining",
];
const USED_KEYS = [
  "used",
  "credits_used",
  "creditsUsed",
  "credit_used",
  "tokens_used",
  "tokensUsed",
  "token_used",
  "quota_used",
];
const PERCENT_REMAINING_KEYS = ["percent_remaining", "percentRemaining"];
const COST_USD_KEYS = [
  "cost_usd",
  "costUsd",
  "gross_amount_usd",
  "grossAmountUsd",
];
const ALLOWANCE_SOURCE_KEYS = [
  "allowance_source",
  "allowanceSource",
  "credit_allowance_source",
  "creditAllowanceSource",
];
const CREDIT_KEYS = [
  "credits",
  "credit",
  "credits_used",
  "creditsUsed",
  "credits_remaining",
  "creditsRemaining",
  "credit_entitlement",
  "creditEntitlement",
  "credit_allowance",
  "creditAllowance",
  "credit_balance",
  "creditBalance",
];
const TOKEN_KEYS = [
  "tokens",
  "token",
  "tokens_used",
  "tokensUsed",
  "tokens_remaining",
  "tokensRemaining",
  "token_entitlement",
  "tokenEntitlement",
  "token_allowance",
  "tokenAllowance",
];

export function parseQuotaSnapshot(
  snapshot: Record<string, unknown>,
  label: string,
  source: string,
  resetAt: string | null,
): QuotaSnapshot | null {
  const unit = deriveQuotaUnit(snapshot);
  const entitlement = readNumberAlias(snapshot, ENTITLEMENT_KEYS);
  // D-002-10: only the legacy request unit treats entitlement === -1 as unlimited;
  // a credit/token count of -1 is not a sentinel.
  const unlimited =
    readBoolean(snapshot["unlimited"]) ??
    (unit === "request" && entitlement === -1);
  const remaining = readNumberAlias(snapshot, REMAINING_KEYS);
  const remainingPercent = clampPercent(
    readNumberAlias(snapshot, PERCENT_REMAINING_KEYS),
  );
  const used =
    readNumberAlias(snapshot, USED_KEYS) ??
    computeUsedQuota(entitlement, remaining);
  const usedPercent = unlimited
    ? 0
    : (invertPercent(remainingPercent) ??
      (entitlement !== null && entitlement > 0 && used !== null
        ? clampPercent((used / entitlement) * 100)
        : null));

  // D-002-12: a usable `used` count alone (no allowance) must survive so the
  // renderer can show a used-only clause. Discard only when nothing is usable.
  if (
    !unlimited &&
    usedPercent === null &&
    entitlement === null &&
    remaining === null &&
    used === null
  ) {
    return null;
  }

  return {
    login: null,
    host: null,
    label,
    unit,
    usedPercent,
    remainingPercent,
    entitlement,
    remaining,
    used,
    unlimited,
    overageUsed: readNumberAlias(snapshot, ["overage_count", "overageCount"]),
    overagePermitted:
      readBoolean(snapshot["overage_permitted"]) ??
      readBoolean(snapshot["overagePermitted"]),
    costUsd: readNumberAlias(snapshot, COST_USD_KEYS),
    creditAllowanceSource: readStringAlias(snapshot, ALLOWANCE_SOURCE_KEYS),
    resetAt:
      readString(snapshot["reset_date"]) ??
      readString(snapshot["resetDate"]) ??
      readString(snapshot["quota_reset_date"]) ??
      resetAt,
    source,
    accountSource: null,
    tokenSource: null,
  };
}

// Derive the billing unit from the snapshot shape. An explicit `unit`/`type`
// field wins; otherwise the presence of credit-family keys implies credits,
// token-family keys imply tokens, and the legacy request-count shape defaults
// to "request".
export function deriveQuotaUnit(snapshot: Record<string, unknown>): QuotaUnit {
  const explicit = normalizeQuotaUnit(
    readString(snapshot["unit"]) ?? readString(snapshot["type"]),
  );
  if (explicit) {
    return explicit;
  }
  if (hasAnyKey(snapshot, CREDIT_KEYS)) {
    return "credit";
  }
  if (hasAnyKey(snapshot, TOKEN_KEYS)) {
    return "token";
  }
  return "request";
}

export function normalizeQuotaUnit(
  value: string | null | undefined,
): QuotaUnit | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "request" ||
    normalized === "requests" ||
    normalized === "premium"
  ) {
    return "request";
  }
  if (
    normalized === "credit" ||
    normalized === "credits" ||
    normalized === "ai_credit" ||
    normalized === "ai_credits" ||
    normalized === "usd"
  ) {
    return "credit";
  }
  if (normalized === "token" || normalized === "tokens") {
    return "token";
  }
  return null;
}

function hasAnyKey(
  snapshot: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.some(
    (key) => snapshot[key] !== undefined && snapshot[key] !== null,
  );
}

function readNumberAlias(
  snapshot: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = readNumber(snapshot[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function readStringAlias(
  snapshot: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = readString(snapshot[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function clampPercent(value: number | null): number | null {
  return value === null ? null : Math.max(0, Math.min(100, value));
}

function computeUsedQuota(
  entitlement: number | null,
  remaining: number | null,
): number | null {
  if (entitlement === null || remaining === null) {
    return null;
  }
  return Math.max(0, entitlement - remaining);
}

function invertPercent(percent: number | null): number | null {
  return percent === null ? null : clampPercent(100 - percent);
}
