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
        if (String(url).endsWith("/premium_request/usage")) {
          return new Response("{}", { status: 404 });
        }
        return new Response(
          JSON.stringify({
            usageItems: [
              {
                product: "copilot_ai",
                sku: "copilot_ai_credit",
                netQuantity: 43.5,
                netAmount: { amount: 0.44, currency: "USD" },
              },
            ],
          }),
          { status: 200 },
        );
      },
    });

    expect(seenUrls).toEqual([
      "https://api.github.com/users/work-account/settings/billing/ai_credit/usage",
      "https://api.github.com/users/work-account/settings/billing/premium_request/usage",
    ]);
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
      fetchImpl: async (url) =>
        String(url).endsWith("/premium_request/usage")
          ? new Response("{}", { status: 404 })
          : new Response(
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

  test("uses a configured organization billing owner on the current AI billing routes", async () => {
    const prevOwner = process.env["COPILOTLINE_BILLING_OWNER"];
    const prevOwnerType = process.env["COPILOTLINE_BILLING_OWNER_TYPE"];
    const seenUrls: string[] = [];

    try {
      process.env["COPILOTLINE_BILLING_OWNER"] = "acme-inc";
      process.env["COPILOTLINE_BILLING_OWNER_TYPE"] = "organization";

      const billing = await fetchCopilotBilling({
        account,
        token: "test-token",
        fetchImpl: async (url) => {
          seenUrls.push(String(url));
          if (String(url).endsWith("/premium_request/usage")) {
            return new Response("{}", { status: 404 });
          }
          return new Response(
            JSON.stringify({
              usageItems: [
                {
                  product: "copilot_ai",
                  sku: "copilot_ai_credit",
                  netQuantity: 43.5,
                  netAmount: { amount: 0.44, currency: "USD" },
                },
              ],
            }),
            { status: 200 },
          );
        },
      });

      expect(seenUrls).toEqual([
        "https://api.github.com/organizations/acme-inc/settings/billing/ai_credit/usage",
        "https://api.github.com/organizations/acme-inc/settings/billing/premium_request/usage",
      ]);
      expect(billing).toMatchObject({
        state: "exact",
        label: "credits",
        monthlyCredits: 43.5,
        monthlySpendUsd: 0.44,
      });
    } finally {
      if (prevOwner === undefined) {
        delete process.env["COPILOTLINE_BILLING_OWNER"];
      } else {
        process.env["COPILOTLINE_BILLING_OWNER"] = prevOwner;
      }
      if (prevOwnerType === undefined) {
        delete process.env["COPILOTLINE_BILLING_OWNER_TYPE"];
      } else {
        process.env["COPILOTLINE_BILLING_OWNER_TYPE"] = prevOwnerType;
      }
    }
  });

  test("sums spend across AI credit and premium-request reports but drops an ambiguous quantity", async () => {
    const billing = await fetchCopilotBilling({
      account,
      token: "test-token",
      fetchImpl: async (url) =>
        String(url).endsWith("/ai_credit/usage")
          ? new Response(
              JSON.stringify({
                usageItems: [
                  {
                    product: "copilot_ai",
                    netQuantity: 43.5,
                    netAmount: { amount: 0.44, currency: "USD" },
                  },
                ],
              }),
              { status: 200 },
            )
          : new Response(
              JSON.stringify({
                usageItems: [
                  {
                    product: "copilot_premium",
                    netQuantity: 12,
                    netAmount: { amount: 1.20, currency: "USD" },
                  },
                ],
              }),
              { status: 200 },
            ),
    });

    expect(billing).toMatchObject({
      state: "exact",
      label: "spend",
      monthlyCredits: null,
      monthlySpendUsd: 1.64,
      source: "official",
    });
  });

  test("treats an empty successful month report as exact zero spend", async () => {
    const billing = await fetchCopilotBilling({
      account,
      token: "test-token",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            timePeriod: { year: 2026, month: 6 },
            organization: "acme-inc",
            usageItems: [],
          }),
          { status: 200 },
        ),
    });

    expect(billing).toMatchObject({
      state: "exact",
      label: "spend",
      monthlyCredits: null,
      monthlySpendUsd: 0,
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
        fetchImpl: async (url) =>
          String(url).endsWith("/premium_request/usage")
            ? new Response("{}", { status: 404 })
            : new Response(
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
