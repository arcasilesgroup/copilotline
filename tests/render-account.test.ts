import { afterEach, describe, expect, test } from "bun:test";
import {
  quotaForRender,
  shouldRefreshUsageCache,
  writeCachedCopilotUsage,
  type UsageCache,
} from "../src/infrastructure/copilot-usage.js";
import type { AccountIdentity } from "../src/infrastructure/copilot-account.js";
import type { QuotaSnapshot } from "../src/domain/status-line.js";
import { cleanupTempDir, createTempDir } from "./helpers.js";

const ACCOUNT: AccountIdentity = {
  login: "render-acct",
  host: "github.com",
  source: "copilot-config",
};

function quota(): QuotaSnapshot {
  return {
    login: "render-acct",
    host: "github.com",
    label: "premium",
    usedPercent: 42,
    remainingPercent: 58,
    entitlement: 100,
    remaining: 58,
    used: 42,
    unlimited: false,
    overageUsed: null,
    overagePermitted: null,
    resetAt: null,
    source: "premium_models",
    accountSource: "copilot-config",
    tokenSource: "test",
  };
}

describe("render path takes a pre-resolved account (no re-detection, no spawn)", () => {
  let tmp: string | null = null;
  const originalCacheDir = process.env["COPILOTLINE_CACHE_DIR"];
  const originalAccount = process.env["COPILOTLINE_ACCOUNT"];

  afterEach(() => {
    if (tmp) cleanupTempDir(tmp);
    tmp = null;
    if (originalCacheDir === undefined) delete process.env["COPILOTLINE_CACHE_DIR"];
    else process.env["COPILOTLINE_CACHE_DIR"] = originalCacheDir;
    if (originalAccount === undefined) delete process.env["COPILOTLINE_ACCOUNT"];
    else process.env["COPILOTLINE_ACCOUNT"] = originalAccount;
  });

  test("quotaForRender reads the cache of the account it is given", () => {
    tmp = createTempDir();
    process.env["COPILOTLINE_CACHE_DIR"] = tmp;
    // Detection disabled: if the function re-resolved instead of using the
    // passed account, it would read the (empty) null-account cache and miss.
    process.env["COPILOTLINE_ACCOUNT"] = "off";

    writeCachedCopilotUsage({
      fetchedAt: new Date().toISOString(),
      account: ACCOUNT,
      tokenSource: "test",
      quota: quota(),
    } satisfies UsageCache);

    expect(quotaForRender(ACCOUNT)?.usedPercent).toBe(42);
  });

  test("shouldRefreshUsageCache uses the given account's freshness", () => {
    tmp = createTempDir();
    process.env["COPILOTLINE_CACHE_DIR"] = tmp;
    process.env["COPILOTLINE_ACCOUNT"] = "off";

    writeCachedCopilotUsage({
      fetchedAt: new Date().toISOString(),
      account: ACCOUNT,
      tokenSource: "test",
      quota: quota(),
    } satisfies UsageCache);

    // A fresh cache for the given account means no refresh is due.
    expect(shouldRefreshUsageCache(ACCOUNT)).toBe(false);
  });
});
