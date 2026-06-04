import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import type { BillingSnapshot } from "../domain/status-line.js";
import { asRecord } from "./value-reader.js";
import {
  cacheAccountKey,
  resolveTokenForAccount,
  selectCopilotAccount,
  type AccountIdentity,
  type FetchLike,
  type TokenResolution,
  usageApiBaseForHost,
} from "./copilot-account.js";

const API_VERSION = "2022-11-28";
const CACHE_FILE = "billing-cache.json";
const CACHE_TTL_MS = 15 * 60_000;

export interface BillingCache {
  fetchedAt: string;
  account: AccountIdentity | null;
  tokenSource: string | null;
  billing: BillingSnapshot;
}

export interface BillingCacheWithAge {
  cache: BillingCache;
  ageMs: number;
}

export interface FetchCopilotBillingOptions {
  token: string;
  account: AccountIdentity;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export function copilotBillingEnabled(): boolean {
  const value = process.env["COPILOTLINE_BILLING"]?.trim().toLowerCase();
  return value !== "0" && value !== "false" && value !== "off";
}

export function billingCachePath(account?: AccountIdentity | null): string {
  const explicit = process.env["COPILOTLINE_CACHE_DIR"];
  const cacheRoot = explicit && explicit.trim() !== "" ? explicit : defaultCacheDir();
  return join(cacheRoot, account ? `${cacheAccountKey(account)}.${CACHE_FILE}` : CACHE_FILE);
}

export function readCachedCopilotBilling(
  account?: AccountIdentity | null,
  now: () => number = Date.now,
): BillingCacheWithAge | null {
  const path = billingCachePath(account);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const text = readFileSync(path, "utf-8");
    const parsed = parseBillingCache(JSON.parse(text) as unknown);
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

export function writeCachedCopilotBilling(cache: BillingCache): void {
  const path = billingCachePath(cache.account);
  ensurePrivateDirectory(dirname(path));
  writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  setPrivateMode(path, 0o600);
}

export async function fetchCopilotBilling(options: FetchCopilotBillingOptions): Promise<BillingSnapshot> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
  const baseUrl = usageApiBaseForHost(options.account.host);
  const routes = [
    `${baseUrl}/users/${encodeURIComponent(options.account.login)}/settings/billing/usage`,
    `${baseUrl}/orgs/${encodeURIComponent(options.account.login)}/settings/billing/usage`,
  ];

  try {
    for (const [index, route] of routes.entries()) {
      const response = await fetchImpl(route, {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `token ${options.token.trim()}`,
          "User-Agent": "copilotline",
          "X-GitHub-Api-Version": API_VERSION,
        },
        signal: controller.signal,
      });

      if (response.ok) {
        const parsed = parseCopilotBillingResponse(await response.json(), options.account);
        return parsed ?? capabilityBilling(options.account, "unavailable");
      }

      if (response.status === 401 || response.status === 403) {
        return capabilityBilling(options.account, "unauthorized");
      }

      if (response.status === 404 || response.status === 422) {
        if (index === routes.length - 1) {
          return capabilityBilling(options.account, "unsupported");
        }
        continue;
      }

      return capabilityBilling(options.account, "unavailable");
    }
  } catch {
    return capabilityBilling(options.account, "unavailable");
  } finally {
    clearTimeout(timeout);
  }

  return capabilityBilling(options.account, "unsupported");
}

export async function refreshCopilotBillingCache(
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
): Promise<BillingCache> {
  const selectedAccount =
    options.account ??
    (options.login
      ? { login: options.login, host: options.host ?? "github.com", source: "manual" as const }
      : selectCopilotAccount(options.input).selected);

  const tokenResolution = await tokenForRefresh(selectedAccount, options);
  const billing = selectedAccount
    ? tokenResolution
      ? withTokenSource(
          await fetchCopilotBilling({
            account: selectedAccount,
            token: tokenResolution.token,
            ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
            ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
          }),
          tokenResolution.source,
        )
      : withTokenSource(capabilityBilling(selectedAccount, "unavailable"), null)
    : withTokenSource(capabilityBilling(null, "unavailable"), null);
  const now = options.now ?? Date.now;
  const cache = {
    fetchedAt: new Date(now()).toISOString(),
    account: selectedAccount,
    tokenSource: tokenResolution?.source ?? null,
    billing,
  };
  writeCachedCopilotBilling(cache);
  return cache;
}

export function billingForRender(input?: unknown, now: () => number = Date.now): BillingSnapshot | null {
  if (!copilotBillingEnabled()) {
    return null;
  }

  const account = selectCopilotAccount(input).selected;
  return readCachedCopilotBilling(account, now)?.cache.billing ?? null;
}

export function shouldRefreshBillingCache(input?: unknown, now: () => number = Date.now): boolean {
  if (!copilotBillingEnabled()) {
    return false;
  }

  const account = selectCopilotAccount(input).selected;
  const cached = readCachedCopilotBilling(account, now);
  return cached === null || cached.ageMs >= CACHE_TTL_MS;
}

export function parseCopilotBillingResponse(
  data: unknown,
  account: AccountIdentity,
): BillingSnapshot | null {
  const record = asRecord(data);
  if (!record) {
    return null;
  }

  const directTotals =
    extractExactTotals(record) ??
    extractExactTotals(asRecord(record["month"])) ??
    extractExactTotals(asRecord(asRecord(record["totals"])?.["month"])) ??
    extractExactTotals(asRecord(asRecord(record["usage"])?.["month"]));
  if (directTotals) {
    return exactBilling(account, directTotals.monthlyCredits, directTotals.monthlySpendUsd);
  }

  const items = itemCollections(record).flatMap((value) => value);
  const exactItems = items
    .filter((item) => isAiBillingItem(item) || items.length === 1)
    .map(extractExactTotals)
    .filter((item): item is ExactTotals => item !== null);
  if (exactItems.length === 0) {
    return null;
  }

  return exactBilling(
    account,
    exactItems.reduce((sum, item) => sum + item.monthlyCredits, 0),
    exactItems.reduce((sum, item) => sum + item.monthlySpendUsd, 0),
  );
}

interface ExactTotals {
  monthlyCredits: number;
  monthlySpendUsd: number;
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

function exactBilling(account: AccountIdentity, monthlyCredits: number, monthlySpendUsd: number): BillingSnapshot {
  return {
    login: account.login,
    host: account.host,
    state: "exact",
    label: "credits",
    monthlyCredits,
    monthlySpendUsd,
    period: "month",
    source: "official",
    tokenSource: null,
  };
}

function capabilityBilling(
  account: AccountIdentity | null,
  source: BillingSnapshot["source"],
): BillingSnapshot {
  return {
    login: account?.login ?? null,
    host: account?.host ?? null,
    state: "capability",
    label: "credits",
    monthlyCredits: null,
    monthlySpendUsd: null,
    period: "month",
    source,
    tokenSource: null,
  };
}

function withTokenSource(billing: BillingSnapshot, tokenSource: string | null): BillingSnapshot {
  return {
    ...billing,
    tokenSource,
  };
}

function extractExactTotals(record: Record<string, unknown> | undefined): ExactTotals | null {
  if (!record) {
    return null;
  }

  const monthlyCredits =
    readNumber(record["monthlyCredits"]) ??
    readNumber(record["monthly_credits"]) ??
    readNumber(record["credits"]) ??
    readNumber(record["credits_used"]) ??
    readNumber(record["quantity"]) ??
    readNumber(record["usage_quantity"]);
  const monthlySpendUsd =
    readMoneyUsd(record["monthlySpendUsd"]) ??
    readMoneyUsd(record["monthly_spend_usd"]) ??
    readMoneyUsd(record["spendUsd"]) ??
    readMoneyUsd(record["spend_usd"]) ??
    readMoneyUsd(record["amountUsd"]) ??
    readMoneyUsd(record["amount_usd"]) ??
    readMoneyUsd(record["grossAmount"]) ??
    readMoneyUsd(record["gross_amount"]) ??
    readMoneyUsd(record["netAmount"]) ??
    readMoneyUsd(record["net_amount"]) ??
    readMoneyUsd(record["amount"]) ??
    readMoneyUsd(record["spend"]) ??
    readMoneyUsd(record["cost"]);

  if (monthlyCredits === null || monthlySpendUsd === null) {
    return null;
  }

  return { monthlyCredits, monthlySpendUsd };
}

function itemCollections(record: Record<string, unknown>): Array<Record<string, unknown>[]> {
  const candidates = [
    record["usageItems"],
    record["usage_items"],
    record["items"],
    record["line_items"],
    record["products"],
    asRecord(record["usage"])?.["items"],
  ];

  return candidates.flatMap((candidate) =>
    Array.isArray(candidate)
      ? [
          candidate.flatMap((item) => {
            const entry = asRecord(item);
            return entry ? [entry] : [];
          }),
        ]
      : [],
  );
}

function isAiBillingItem(record: Record<string, unknown>): boolean {
  const markers = [
    readString(record["product"]),
    readString(record["sku"]),
    readString(record["name"]),
    readString(record["meter"]),
    readString(record["unitType"]),
    readString(record["unit_type"]),
  ]
    .filter((value): value is string => value !== null)
    .join(" ")
    .toLowerCase();

  return markers.includes("copilot") || markers.includes("ai") || markers.includes("credit");
}

function parseBillingCache(value: unknown): BillingCache | null {
  const record = asRecord(value);
  const fetchedAt = readString(record?.["fetchedAt"]);
  const billingRecord = asRecord(record?.["billing"]);

  if (!fetchedAt || !billingRecord) {
    return null;
  }

  const state = billingRecord["state"] === "exact" ? "exact" : "capability";
  const source = readBillingSource(billingRecord["source"]);
  if (!source) {
    return null;
  }

  const accountRecord = asRecord(record?.["account"]);
  const login = readString(accountRecord?.["login"]) ?? readString(billingRecord["login"]);
  const host = readString(accountRecord?.["host"]) ?? readString(billingRecord["host"]);
  const account = login
    ? {
        login,
        host: host ?? "github.com",
        source: accountRecord?.["source"] === "manual" ? ("manual" as const) : ("copilot-config" as const),
      }
    : null;

  return {
    fetchedAt,
    account,
    tokenSource: readString(record?.["tokenSource"]) ?? readString(billingRecord["tokenSource"]),
    billing: {
      login,
      host,
      state,
      label: readString(billingRecord["label"]) ?? "credits",
      monthlyCredits: readNumber(billingRecord["monthlyCredits"]),
      monthlySpendUsd: readNumber(billingRecord["monthlySpendUsd"]),
      period: "month",
      source,
      tokenSource: readString(billingRecord["tokenSource"]),
    },
  };
}

function readBillingSource(value: unknown): BillingSnapshot["source"] | null {
  switch (value) {
    case "official":
    case "unsupported":
    case "unauthorized":
    case "unavailable":
      return value;
    default:
      return null;
  }
}

function readMoneyUsd(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const currency = readString(record["currency"]) ?? "USD";
  if (currency.toUpperCase() !== "USD") {
    return null;
  }

  return readNumber(record["amount"]) ?? readNumber(record["value"]);
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
    // Best effort only for cache paths on unusual filesystems.
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
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
