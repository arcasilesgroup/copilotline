import type { QuotaSnapshot } from "../domain/status-line.js";

// Single source of truth for turning a GitHub quota snapshot object into a
// QuotaSnapshot. Consumed by both the live API path (copilot-usage) and the
// stdin-payload render path (render-status-line) so the same response renders
// identically whether it arrives live or from cache. Superset semantics:
// entitlement === -1 means unlimited, and the remaining count is read from the
// `remaining` / `quota_remaining` / `quotaRemaining` aliases.
export function parseQuotaSnapshot(
  snapshot: Record<string, unknown>,
  label: string,
  source: string,
  resetAt: string | null,
): QuotaSnapshot | null {
  const entitlement = readNumber(snapshot["entitlement"]);
  const unlimited = readBoolean(snapshot["unlimited"]) ?? entitlement === -1;
  const remaining =
    readNumber(snapshot["remaining"]) ??
    readNumber(snapshot["quota_remaining"]) ??
    readNumber(snapshot["quotaRemaining"]);
  const remainingPercent = clampPercent(
    readNumber(snapshot["percent_remaining"]) ?? readNumber(snapshot["percentRemaining"]),
  );
  const used = computeUsedQuota(entitlement, remaining);
  const usedPercent = unlimited
    ? 0
    : invertPercent(remainingPercent) ??
      (entitlement !== null && entitlement > 0 && used !== null
        ? clampPercent((used / entitlement) * 100)
        : null);

  if (!unlimited && usedPercent === null && entitlement === null && remaining === null) {
    return null;
  }

  return {
    login: null,
    host: null,
    label,
    usedPercent,
    remainingPercent,
    entitlement,
    remaining,
    used,
    unlimited,
    overageUsed: readNumber(snapshot["overage_count"]) ?? readNumber(snapshot["overageCount"]),
    overagePermitted:
      readBoolean(snapshot["overage_permitted"]) ?? readBoolean(snapshot["overagePermitted"]),
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

function computeUsedQuota(entitlement: number | null, remaining: number | null): number | null {
  if (entitlement === null || remaining === null) {
    return null;
  }
  return Math.max(0, entitlement - remaining);
}

function invertPercent(percent: number | null): number | null {
  return percent === null ? null : clampPercent(100 - percent);
}
