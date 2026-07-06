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
import {
  readCopilotlineConfig,
  type BillingOwnerType,
} from "./copilotline-config.js";

const API_VERSION = "2026-03-10";
const CACHE_FILE = "billing-cache.json";
const CACHE_TTL_MS = 15 * 60_000;

type BillingEndpointKind = "ai_credit" | "premium_request";

interface BillingOwner {
  login: string;
  host: string;
  type: BillingOwnerType;
}

export interface BillingCache {
  fetchedAt: string;
  account: AccountIdentity | null;
  tokenSource: string | null;
  billing: BillingSnapshot;
  owner?: BillingOwner | null;
}

export interface BillingCacheWithAge {
  cache: BillingCache;
  ageMs: number;
}

export interface FetchCopilotBillingOptions {
  token: string;
  account: AccountIdentity;
  owner?: BillingOwner | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export function copilotBillingEnabled(): boolean {
  const value = process.env["COPILOTLINE_BILLING"]?.trim().toLowerCase();
  return value !== "0" && value !== "false" && value !== "off";
}

export function billingCachePath(account?: AccountIdentity | null): string {
  return billingCachePathFor(
    account ?? null,
    resolveBillingOwner(account ?? null),
  );
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
  const path = billingCachePathFor(
    cache.account,
    cache.owner ?? resolveBillingOwner(cache.account),
  );
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
  const owner = options.owner ?? resolveBillingOwner(options.account);
  if (!owner) {
    return capabilityBilling(options.account, "unavailable");
  }
  const baseUrl = usageApiBaseForHost(owner.host);
  const routes = billingRoutes(owner, baseUrl);
  const exactResults: ParsedBillingUsage[] = [];

  try {
    for (const route of routes) {
      const response = await fetchImpl(route.url, {
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
        const parsed = parseCopilotBillingResponse(
          await response.json(),
          route.kind,
        );
        if (parsed) {
          exactResults.push(parsed);
        }
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        return capabilityBilling(options.account, "unauthorized");
      }

      if (response.status === 404 || response.status === 422) {
        continue;
      }

      return capabilityBilling(options.account, "unavailable");
    }
  } catch {
    return capabilityBilling(options.account, "unavailable");
  } finally {
    clearTimeout(timeout);
  }

  return (
    combineExactBilling(options.account, exactResults) ??
    capabilityBilling(options.account, "unsupported")
  );
}

export async function refreshCopilotBillingCache(
  options: {
    token?: string | null;
    login?: string | null;
    host?: string | null;
    input?: unknown;
    account?: AccountIdentity | null;
    owner?: BillingOwner | null;
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
  const billingOwner = options.owner ?? resolveBillingOwner(selectedAccount);

  const tokenResolution = await tokenForRefresh(selectedAccount, options);
  const billing = selectedAccount
    ? tokenResolution
    ? withTokenSource(
        await fetchCopilotBilling({
          account: selectedAccount,
          owner: billingOwner,
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
    owner: billingOwner,
  };
  writeCachedCopilotBilling(cache);
  return cache;
}

export function billingForRender(
  account: AccountIdentity | null,
  now: () => number = Date.now,
): BillingSnapshot | null {
  if (!copilotBillingEnabled()) {
    return null;
  }
  return readCachedCopilotBilling(account, now)?.cache.billing ?? null;
}

export function shouldRefreshBillingCache(
  account: AccountIdentity | null,
  now: () => number = Date.now,
): boolean {
  if (!copilotBillingEnabled()) {
    return false;
  }
  const cached = readCachedCopilotBilling(account, now);
  return cached === null || cached.ageMs >= CACHE_TTL_MS;
}

export function parseCopilotBillingResponse(
  data: unknown,
  kind: BillingEndpointKind,
): ParsedBillingUsage | null {
  const record = asRecord(data);
  if (!record) {
    return null;
  }

  const directTotals = aggregateExactTotals([
    extractExactTotals(record),
    extractExactTotals(asRecord(record["month"])),
    extractExactTotals(asRecord(asRecord(record["totals"])?.["month"])),
    extractExactTotals(asRecord(asRecord(record["usage"])?.["month"])),
  ]);
  if (directTotals) {
    return {
      label: kind === "ai_credit" ? "credits" : "premium",
      ...directTotals,
    };
  }

  const items = itemCollections(record).flatMap((value) => value);
  if (hasUsageCollection(record) && items.length === 0) {
    return {
      label: kind === "ai_credit" ? "credits" : "premium",
      monthlyCredits: 0,
      monthlySpendUsd: 0,
    };
  }
  const exactItems = items
    .map(extractExactTotals)
    .filter((item): item is ExactTotals => item !== null);
  const totals = aggregateExactTotals(exactItems);
  if (!totals) {
    return null;
  }

  return {
    label: kind === "ai_credit" ? "credits" : "premium",
    ...totals,
  };
}

interface ExactTotals {
  monthlyCredits: number | null;
  monthlySpendUsd: number | null;
}

interface ParsedBillingUsage extends ExactTotals {
  label: string;
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

function exactBilling(
  account: AccountIdentity,
  label: string,
  monthlyCredits: number | null,
  monthlySpendUsd: number | null,
): BillingSnapshot {
  return {
    login: account.login,
    host: account.host,
    state: "exact",
    label,
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
    readNumber(record["netQuantity"]) ??
    readNumber(record["net_quantity"]) ??
    readNumber(record["grossQuantity"]) ??
    readNumber(record["gross_quantity"]) ??
    readNumber(record["quantity"]) ??
    readNumber(record["usage_quantity"]);
  const monthlySpendUsd =
    readMoneyUsd(record["monthlySpendUsd"]) ??
    readMoneyUsd(record["monthly_spend_usd"]) ??
    readMoneyUsd(record["spendUsd"]) ??
    readMoneyUsd(record["spend_usd"]) ??
    readMoneyUsd(record["netAmount"]) ??
    readMoneyUsd(record["net_amount"]) ??
    readMoneyUsd(record["amountUsd"]) ??
    readMoneyUsd(record["amount_usd"]) ??
    readMoneyUsd(record["grossAmount"]) ??
    readMoneyUsd(record["gross_amount"]) ??
    readMoneyUsd(record["amount"]) ??
    readMoneyUsd(record["spend"]) ??
    readMoneyUsd(record["cost"]);

  if (monthlyCredits === null && monthlySpendUsd === null) {
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

function hasUsageCollection(record: Record<string, unknown>): boolean {
  return [
    record["usageItems"],
    record["usage_items"],
    record["items"],
    record["line_items"],
    record["products"],
    asRecord(record["usage"])?.["items"],
  ].some((candidate) => Array.isArray(candidate));
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
  const ownerRecord = asRecord(record?.["owner"]);
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
    owner: parseBillingOwner(ownerRecord),
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

function billingRoutes(
  owner: BillingOwner,
  baseUrl: string,
): Array<{ kind: BillingEndpointKind; url: string }> {
  const ownerPath =
    owner.type === "organization" ? "organizations" : "users";
  const prefix = `${baseUrl}/${ownerPath}/${encodeURIComponent(owner.login)}/settings/billing`;
  return [
    {
      kind: "ai_credit",
      url: `${prefix}/ai_credit/usage`,
    },
    {
      kind: "premium_request",
      url: `${prefix}/premium_request/usage`,
    },
  ];
}

function resolveBillingOwner(account: AccountIdentity | null): BillingOwner | null {
  const config = readCopilotlineConfig().billing;
  if (config.owner) {
    return {
      login: config.owner,
      host: account?.host ?? "github.com",
      type: config.ownerType,
    };
  }
  if (!account) {
    return null;
  }
  return {
    login: account.login,
    host: account.host,
    type: "user",
  };
}

function billingCachePathFor(
  account: AccountIdentity | null,
  owner: BillingOwner | null,
): string {
  const explicit = process.env["COPILOTLINE_CACHE_DIR"];
  const cacheRoot = explicit && explicit.trim() !== "" ? explicit : defaultCacheDir();
  const cacheKey = billingCacheKey(account, owner);
  return join(cacheRoot, cacheKey ? `${cacheKey}.${CACHE_FILE}` : CACHE_FILE);
}

function billingCacheKey(
  account: AccountIdentity | null,
  owner: BillingOwner | null,
): string | null {
  if (owner) {
    return `${owner.type}-${cacheAccountKey({
      login: owner.login,
      host: owner.host,
      source: "manual",
    })}`;
  }
  return account ? cacheAccountKey(account) : null;
}

function combineExactBilling(
  account: AccountIdentity,
  usages: ParsedBillingUsage[],
): BillingSnapshot | null {
  const present = usages.filter(
    (usage) =>
      usage.monthlyCredits !== null || usage.monthlySpendUsd !== null,
  );
  if (present.length === 0) {
    return null;
  }

  const quantified = present.filter(
    (usage) => usage.monthlyCredits !== null,
  );
  const [onlyQuantified] = quantified;
  const [onlyPresent] = present;
  const label =
    quantified.length === 1 && onlyQuantified
      ? onlyQuantified.label
      : quantified.length === 0 && present.length === 1 && onlyPresent
        ? onlyPresent.label
        : "spend";

  return exactBilling(
    account,
    label,
    quantified.length === 1 && onlyQuantified
      ? onlyQuantified.monthlyCredits
      : null,
    sumNullable(present.map((usage) => usage.monthlySpendUsd)),
  );
}

function aggregateExactTotals(items: Array<ExactTotals | null>): ExactTotals | null {
  const present = items.filter((item): item is ExactTotals => item !== null);
  if (present.length === 0) {
    return null;
  }

  return {
    monthlyCredits: sumNullable(present.map((item) => item.monthlyCredits)),
    monthlySpendUsd: sumNullable(
      present.map((item) => item.monthlySpendUsd),
    ),
  };
}

function sumNullable(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0
    ? null
    : present.reduce((sum, value) => sum + value, 0);
}

function parseBillingOwner(
  record: Record<string, unknown> | null | undefined,
): BillingOwner | null {
  if (!record) {
    return null;
  }

  const login = readString(record["login"]);
  const host = readString(record["host"]) ?? "github.com";
  const type =
    record["type"] === "organization" ? "organization" : record["type"] === "user" ? "user" : null;
  if (!login || !type) {
    return null;
  }

  return { login, host, type };
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
