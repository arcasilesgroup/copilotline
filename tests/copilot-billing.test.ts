import { describe, expect, test } from "bun:test";
import type { AccountIdentity } from "../src/infrastructure/copilot-account.js";
import {
  billingForRender,
  fetchCopilotBilling,
  readCachedCopilotBilling,
  refreshCopilotBillingCache,
  shouldRefreshBillingCache,
} from "../src/infrastructure/copilot-billing.js";
import { cleanupTempDir, createTempDir } from "./helpers.js";

const account: AccountIdentity = {
  login: "work-account",
  host: "github.com",
  source: "payload",
};

describe("copilot billing", () => {
  test("reads official monthly AI credit totals when the billing endpoint is available", async () => {
    const seenUrls: string[] = [];
    const billing = await fetchCopilotBilling({
      account,
      token: "test-token",
      fetchImpl: async (url) => {
        seenUrls.push(String(url));
        return new Response(
          JSON.stringify({
            usageItems: [
              {
                product: "copilot_ai",
                sku: "copilot_ai_credit",
                quantity: 43.5,
                grossAmount: { amount: 0.44, currency: "USD" },
              },
              {
                product: "actions",
                quantity: 999,
                grossAmount: { amount: 10, currency: "USD" },
              },
            ],
          }),
          { status: 200 },
        );
      },
    });

    expect(seenUrls).toEqual(["https://api.github.com/users/work-account/settings/billing/usage"]);
    expect(billing).toMatchObject({
      login: "work-account",
      host: "github.com",
      state: "exact",
      monthlyCredits: 43.5,
      monthlySpendUsd: 0.44,
      source: "official",
    });
  });

  test("falls back to a capability-only state when billing usage is unsupported", async () => {
    const billing = await fetchCopilotBilling({
      account,
      token: "test-token",
      fetchImpl: async () => new Response("{}", { status: 404 }),
    });

    expect(billing).toMatchObject({
      login: "work-account",
      host: "github.com",
      state: "capability",
      monthlyCredits: null,
      monthlySpendUsd: null,
      source: "unsupported",
    });
  });

  test("reads direct month totals and USD strings from the official billing payload", async () => {
    const billing = await fetchCopilotBilling({
      account,
      token: "test-token",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            month: {
              monthly_credits: "43.5",
              grossAmount: { amount: "0.44", currency: "USD" },
            },
          }),
          { status: 200 },
        ),
    });

    expect(billing).toMatchObject({
      login: "work-account",
      host: "github.com",
      state: "exact",
      monthlyCredits: 43.5,
      monthlySpendUsd: 0.44,
      source: "official",
    });
  });

  test("caches an unauthorized billing response as a non-numeric capability state", async () => {
    const tempDir = createTempDir();
    const originalCacheDir = process.env["COPILOTLINE_CACHE_DIR"];
    process.env["COPILOTLINE_CACHE_DIR"] = tempDir;

    try {
      const cache = await refreshCopilotBillingCache({
        account,
        token: "test-token",
        now: () => new Date("2026-05-07T15:00:00Z").getTime(),
        fetchImpl: async () => new Response("{}", { status: 403 }),
      });

      expect(cache.tokenSource).toBe("explicit token");
      expect(cache.billing).toMatchObject({
        state: "capability",
        monthlyCredits: null,
        monthlySpendUsd: null,
        source: "unauthorized",
      });

      const cached = readCachedCopilotBilling(account, () => new Date("2026-05-07T15:00:10Z").getTime());
      expect(cached?.cache.billing).toMatchObject({
        state: "capability",
        source: "unauthorized",
      });
    } finally {
      if (originalCacheDir === undefined) {
        delete process.env["COPILOTLINE_CACHE_DIR"];
      } else {
        process.env["COPILOTLINE_CACHE_DIR"] = originalCacheDir;
      }
      cleanupTempDir(tempDir);
    }
  });

  test("reads cached billing for the supplied account and refreshes once the TTL expires", async () => {
    const tempDir = createTempDir();
    const originalCacheDir = process.env["COPILOTLINE_CACHE_DIR"];
    const originalBilling = process.env["COPILOTLINE_BILLING"];
    process.env["COPILOTLINE_CACHE_DIR"] = tempDir;
    delete process.env["COPILOTLINE_BILLING"];

    const fetchedAt = new Date("2026-05-07T15:00:00Z").getTime();
    try {
      await refreshCopilotBillingCache({
        account,
        token: "test-token",
        now: () => fetchedAt,
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              month: {
                monthlyCredits: 43.5,
                monthlySpendUsd: 0.44,
              },
            }),
            { status: 200 },
          ),
      });

      expect(billingForRender(account, () => fetchedAt + 10_000)).toMatchObject({
        state: "exact",
        monthlyCredits: 43.5,
        monthlySpendUsd: 0.44,
      });
      expect(shouldRefreshBillingCache(account, () => fetchedAt + 14 * 60_000)).toBe(false);
      expect(shouldRefreshBillingCache(account, () => fetchedAt + 16 * 60_000)).toBe(true);
    } finally {
      if (originalCacheDir === undefined) {
        delete process.env["COPILOTLINE_CACHE_DIR"];
      } else {
        process.env["COPILOTLINE_CACHE_DIR"] = originalCacheDir;
      }
      if (originalBilling === undefined) {
        delete process.env["COPILOTLINE_BILLING"];
      } else {
        process.env["COPILOTLINE_BILLING"] = originalBilling;
      }
      cleanupTempDir(tempDir);
    }
  });

  test("disables billing helpers cleanly when billing is turned off or no account is available", async () => {
    const tempDir = createTempDir();
    const originalCacheDir = process.env["COPILOTLINE_CACHE_DIR"];
    const originalBilling = process.env["COPILOTLINE_BILLING"];
    const originalAccount = process.env["COPILOTLINE_ACCOUNT"];
    process.env["COPILOTLINE_CACHE_DIR"] = tempDir;

    try {
      process.env["COPILOTLINE_ACCOUNT"] = "off";
      const cache = await refreshCopilotBillingCache({
        account: null,
        now: () => new Date("2026-05-07T15:00:00Z").getTime(),
      });

      expect(cache.account).toBeNull();
      expect(cache.tokenSource).toBeNull();
      expect(cache.billing).toMatchObject({
        login: null,
        host: null,
        state: "capability",
        source: "unavailable",
      });

      process.env["COPILOTLINE_BILLING"] = "off";
      expect(billingForRender(account)).toBeNull();
      expect(shouldRefreshBillingCache(account)).toBe(false);
    } finally {
      if (originalCacheDir === undefined) {
        delete process.env["COPILOTLINE_CACHE_DIR"];
      } else {
        process.env["COPILOTLINE_CACHE_DIR"] = originalCacheDir;
      }
      if (originalBilling === undefined) {
        delete process.env["COPILOTLINE_BILLING"];
      } else {
        process.env["COPILOTLINE_BILLING"] = originalBilling;
      }
      if (originalAccount === undefined) {
        delete process.env["COPILOTLINE_ACCOUNT"];
      } else {
        process.env["COPILOTLINE_ACCOUNT"] = originalAccount;
      }
      cleanupTempDir(tempDir);
    }
  });
});
