import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import type { QuotaSnapshot } from "../domain/status-line.js";
import { shouldRefreshBillingCache } from "./copilot-billing.js";
import { asRecord } from "./value-reader.js";
import {
  cacheAccountKey,
  displayAccount,
  resolveTokenForAccount,
  selectCopilotAccount,
  usageApiBaseForHost,
  type AccountIdentity,
  type FetchLike,
  type TokenResolution,
} from "./copilot-account.js";

const COPILOT_USAGE_URL = "https://api.github.com/copilot_internal/user";
const API_VERSION = "2025-04-01";
const CACHE_TTL_MS = 60_000;
const REFRESH_DEBOUNCE_MS = 30_000;
const CACHE_FILE = "usage-cache.json";
const REFRESH_MARKER_FILE = "usage-refresh.marker";

export interface UsageCache {
  fetchedAt: string;
  account: AccountIdentity | null;
  tokenSource: string | null;
  quota: QuotaSnapshot;
}

export interface UsageCacheWithAge {
  cache: UsageCache;
  ageMs: number;
}

export interface FetchCopilotUsageOptions {
  token: string;
  host?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
}

export function copilotUsageEnabled(): boolean {
  const value = process.env["COPILOTLINE_USAGE"]?.trim().toLowerCase();
  return value !== "0" && value !== "false" && value !== "off";
}

export function usageCachePath(account?: AccountIdentity | null): string {
  const explicit = process.env["COPILOTLINE_CACHE_DIR"];
  const cacheRoot = explicit && explicit.trim() !== "" ? explicit : defaultCacheDir();
  return join(cacheRoot, account ? `${cacheAccountKey(account)}.${CACHE_FILE}` : CACHE_FILE);
}

export function readCachedCopilotUsage(
  account?: AccountIdentity | null,
  now: () => number = Date.now,
): UsageCacheWithAge | null {
  const path = usageCachePath(account);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const text = readFileSync(path, "utf-8");
    const parsed = parseUsageCache(JSON.parse(text) as unknown);
    if (!parsed) {
      return null;
    }

    const fetchedMs = Date.parse(parsed.fetchedAt);
    const ageMs = Number.isFinite(fetchedMs) ? Math.max(0, now() - fetchedMs) : Number.POSITIVE_INFINITY;
    return { cache: parsed, ageMs };
  } catch {
    return null;
  }
}

export function writeCachedCopilotUsage(cache: UsageCache): void {
  const path = usageCachePath(cache.account);
  ensurePrivateDirectory(dirname(path));
  writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  setPrivateMode(path, 0o600);
}

export async function fetchCopilotUsage(options: FetchCopilotUsageOptions): Promise<QuotaSnapshot> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${usageApiBaseForHost(options.host ?? "github.com")}/copilot_internal/user`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `token ${options.token.trim()}`,
        "Editor-Version": "copilotline/0.1.0",
        "Editor-Plugin-Version": "copilotline/0.1.0",
        "User-Agent": "copilotline",
        "X-GitHub-Api-Version": API_VERSION,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`GitHub Copilot usage API returned HTTP ${response.status}`);
    }

    const quota = parseCopilotUsageResponse(await response.json());
    if (!quota) {
      throw new Error("GitHub Copilot usage API did not include usable quota data");
    }

    return quota;
  } finally {
    clearTimeout(timeout);
  }
}

export async function refreshCopilotUsageCache(
  options: {
    token?: string | null;
    login?: string | null;
    host?: string | null;
    input?: unknown;
    account?: AccountIdentity | null;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    now?: () => number;
  } = {},
): Promise<UsageCache> {
  if (!copilotUsageEnabled()) {
    throw new Error("Copilot usage display is disabled by COPILOTLINE_USAGE");
  }

  const selectedAccount =
    options.account ??
    (options.login
      ? { login: options.login, host: options.host ?? "github.com", source: "manual" as const }
      : selectCopilotAccount(options.input).selected);
  const tokenResolution = await tokenForRefresh(selectedAccount, options);
  if (!tokenResolution) {
    const accountHint = selectedAccount
      ? ` for ${displayAccount(selectedAccount)}`
      : "";
    throw new Error(
      `No GitHub token found${accountHint}. Authenticate that account with \`gh auth login\` or set a matching COPILOTLINE_GITHUB_TOKEN.`,
    );
  }

  const now = options.now ?? Date.now;
  const fetchOptions: FetchCopilotUsageOptions = {
    token: tokenResolution.token,
    host: tokenResolution.host,
  };
  if (options.fetchImpl !== undefined) {
    fetchOptions.fetchImpl = options.fetchImpl;
  }
  if (options.timeoutMs !== undefined) {
    fetchOptions.timeoutMs = options.timeoutMs;
  }

  const quota = withAccountMetadata(
    await fetchCopilotUsage(fetchOptions),
    selectedAccount,
    tokenResolution.source,
  );
  const cache = {
    fetchedAt: new Date(now()).toISOString(),
    account: selectedAccount,
    tokenSource: tokenResolution.source,
    quota,
  };
  writeCachedCopilotUsage(cache);
  return cache;
}

export function quotaForRender(input?: unknown, now: () => number = Date.now): QuotaSnapshot | null {
  if (!copilotUsageEnabled()) {
    return null;
  }

  const account = selectCopilotAccount(input).selected;
  return readCachedCopilotUsage(account, now)?.cache.quota ?? null;
}

export function shouldRefreshUsageCache(input?: unknown, now: () => number = Date.now): boolean {
  if (!copilotUsageEnabled()) {
    return false;
  }

  const account = selectCopilotAccount(input).selected;
  const cached = readCachedCopilotUsage(account, now);
  return cached === null || cached.ageMs >= CACHE_TTL_MS;
}

export function refreshCopilotUsageInBackground(
  commandPath: string,
  input?: unknown,
  now: () => number = Date.now,
): void {
  const account = selectCopilotAccount(input).selected;
  const usageStale = shouldRefreshUsageCache(input, now);
  const billingStale = shouldRefreshBillingCache(input, now);
  if ((!usageStale && !billingStale) || refreshRecentlyStarted(account, now)) {
    return;
  }

  markRefreshStarted(account, now);
  const args = [commandPath, "refresh", "--quiet"];
  if (account) {
    args.push("--login", account.login, "--host", account.host);
  }
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}

export function parseCopilotUsageResponse(data: unknown): QuotaSnapshot | null {
  const record = asRecord(data);
  const snapshots = asRecord(record?.["quota_snapshots"]);
  if (!snapshots) {
    return null;
  }

  const candidates: Array<[string, string]> = [
    ["premium_models", "premium"],
    ["premium_interactions", "premium"],
    ["chat", "chat"],
    ["completions", "completions"],
  ];
  const resetAt = readString(record?.["quota_reset_date"]);

  for (const [source, label] of candidates) {
    const snapshot = asRecord(snapshots[source]);
    if (!snapshot) {
      continue;
    }

    const quota = quotaFromSnapshot(snapshot, label, source, resetAt);
    if (quota) {
      return quota;
    }
  }

  return null;
}

export function readGitHubToken(): string | null {
  const envToken =
    cleanToken(process.env["COPILOTLINE_GITHUB_TOKEN"]) ??
    cleanToken(process.env["GH_TOKEN"]) ??
    cleanToken(process.env["GITHUB_TOKEN"]);
  if (envToken) {
    return envToken;
  }

  const gh = findGhCommand();
  if (!gh) {
    return null;
  }

  const result = spawnSync(gh, ["auth", "token"], {
    encoding: "utf-8",
    timeout: 3_000,
    maxBuffer: 64 * 1024,
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return cleanToken(result.stdout);
}

async function tokenForRefresh(
  account: AccountIdentity | null,
  options: {
    token?: string | null;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  },
): Promise<TokenResolution | null> {
  if (options.token?.trim()) {
    return {
      token: options.token.trim(),
      login: account?.login ?? "unknown",
      host: account?.host ?? "github.com",
      source: "explicit token",
    };
  }

  if (!account) {
    return null;
  }

  const resolveOptions: {
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  } = {};
  if (options.fetchImpl) {
    resolveOptions.fetchImpl = options.fetchImpl;
  }
  if (options.timeoutMs !== undefined) {
    resolveOptions.timeoutMs = options.timeoutMs;
  }

  return await resolveTokenForAccount(account, resolveOptions);
}

function withAccountMetadata(
  quota: QuotaSnapshot,
  account: AccountIdentity | null,
  tokenSource: string | null,
): QuotaSnapshot {
  return {
    ...quota,
    login: account?.login ?? quota.login,
    host: account?.host ?? quota.host,
    accountSource: account?.source ?? quota.accountSource,
    tokenSource,
  };
}

function quotaFromSnapshot(
  snapshot: Record<string, unknown>,
  label: string,
  source: string,
  resetAt: string | null,
): QuotaSnapshot | null {
  const unlimited = readBoolean(snapshot["unlimited"]) ?? false;
  const entitlement = readNumber(snapshot["entitlement"]);
  const remaining = readNumber(snapshot["remaining"]);
  const remainingPercent = clampPercent(readNumber(snapshot["percent_remaining"]));
  const used = entitlement !== null && remaining !== null ? Math.max(0, entitlement - remaining) : null;
  const usedPercent = unlimited
    ? 0
    : remainingPercent !== null
      ? 100 - remainingPercent
      : entitlement !== null && entitlement > 0 && used !== null
        ? clampPercent((used / entitlement) * 100)
        : null;

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
    overageUsed: readNumber(snapshot["overage_count"]),
    overagePermitted: readBoolean(snapshot["overage_permitted"]),
    resetAt: readString(snapshot["reset_date"]) ?? resetAt,
    source,
    accountSource: null,
    tokenSource: null,
  };
}

function parseUsageCache(value: unknown): UsageCache | null {
  const record = asRecord(value);
  const fetchedAt = readString(record?.["fetchedAt"]);
  const quotaRecord = asRecord(record?.["quota"]);

  if (!fetchedAt || !quotaRecord) {
    return null;
  }

  const label = readString(quotaRecord["label"]);
  const source = readString(quotaRecord["source"]);
  const accountRecord = asRecord(record?.["account"]);
  const login = readString(accountRecord?.["login"]) ?? readString(quotaRecord["login"]);
  const host = readString(accountRecord?.["host"]) ?? readString(quotaRecord["host"]);
  const accountSource = readString(accountRecord?.["source"]) ?? readString(quotaRecord["accountSource"]);
  const account = login
    ? {
        login,
        host: host ?? "github.com",
        source: accountSource === "manual" ? "manual" as const : "copilot-config" as const,
      }
    : null;
  return {
    fetchedAt,
    account,
    tokenSource: readString(record?.["tokenSource"]) ?? readString(quotaRecord["tokenSource"]),
    quota: {
      login,
      host,
      label,
      usedPercent: readNumber(quotaRecord["usedPercent"]),
      remainingPercent: readNumber(quotaRecord["remainingPercent"]),
      entitlement: readNumber(quotaRecord["entitlement"]),
      remaining: readNumber(quotaRecord["remaining"]),
      used: readNumber(quotaRecord["used"]),
      unlimited: readBoolean(quotaRecord["unlimited"]) ?? false,
      overageUsed: readNumber(quotaRecord["overageUsed"]),
      overagePermitted: readBoolean(quotaRecord["overagePermitted"]),
      resetAt: readString(quotaRecord["resetAt"]),
      source,
      accountSource,
      tokenSource: readString(quotaRecord["tokenSource"]),
    },
  };
}

function findGhCommand(): string | null {
  const candidates = [process.env["GH_PATH"], "/opt/homebrew/bin/gh", "/usr/local/bin/gh", "gh"];
  for (const candidate of candidates) {
    if (!candidate || candidate.trim() === "") {
      continue;
    }

    if (candidate.includes("/") && !existsSync(candidate)) {
      continue;
    }

    const result = spawnSync(candidate, ["--version"], {
      encoding: "utf-8",
      timeout: 1_000,
      stdio: "ignore",
    });
    if (!result.error && result.status === 0) {
      return candidate;
    }
  }

  return null;
}

function refreshRecentlyStarted(account: AccountIdentity | null, now: () => number): boolean {
  const markerPath = refreshMarkerPath(account);
  try {
    const marker = statSync(markerPath);
    return now() - marker.mtimeMs < REFRESH_DEBOUNCE_MS;
  } catch {
    return false;
  }
}

function markRefreshStarted(account: AccountIdentity | null, now: () => number): void {
  const markerPath = refreshMarkerPath(account);
  ensurePrivateDirectory(dirname(markerPath));
  writeFileSync(markerPath, String(now()), { encoding: "utf-8", mode: 0o600 });
  setPrivateMode(markerPath, 0o600);
}

function refreshMarkerPath(account: AccountIdentity | null): string {
  const markerFile = account ? `${cacheAccountKey(account)}.${REFRESH_MARKER_FILE}` : REFRESH_MARKER_FILE;
  return join(dirname(usageCachePath(account)), markerFile);
}

function defaultCacheDir(): string {
  const xdg = process.env["XDG_CACHE_HOME"];
  if (xdg && xdg.trim() !== "") {
    return join(xdg, "copilotline");
  }

  if (platform() === "darwin") {
    return join(homedir(), "Library", "Caches", "copilotline");
  }

  if (platform() === "win32") {
    const localAppData = process.env["LOCALAPPDATA"];
    return join(localAppData && localAppData.trim() !== "" ? localAppData : join(homedir(), "AppData", "Local"), "copilotline");
  }

  return join(homedir(), ".cache", "copilotline");
}

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  setPrivateMode(path, 0o700);
}

function setPrivateMode(path: string, mode: number): void {
  if (platform() === "win32") {
    return;
  }

  try {
    chmodSync(path, mode);
  } catch {
    // Best effort only: chmod can fail on unusual filesystems, but cache
    // contents never include credentials or raw Copilot payloads.
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
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

function clampPercent(value: number | null): number | null {
  return value === null ? null : Math.max(0, Math.min(100, value));
}

function cleanToken(token: string | undefined): string | null {
  const trimmed = token?.trim();
  return trimmed ? trimmed : null;
}
