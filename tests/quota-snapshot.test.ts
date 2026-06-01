import { describe, expect, test } from "bun:test";
import { parseCopilotUsageResponse } from "../src/infrastructure/copilot-usage.js";
import { parseQuotaSnapshot } from "../src/infrastructure/quota-snapshot.js";

describe("quota parser parity (live vs cache/payload)", () => {
  test("treats entitlement:-1 as unlimited and reads the quota_remaining alias", () => {
    const live = parseCopilotUsageResponse({
      quota_reset_date: "",
      quota_snapshots: {
        premium_models: { entitlement: -1, quota_remaining: 5 },
      },
    });

    expect(live?.unlimited).toBe(true);
    expect(live?.remaining).toBe(5);
  });

  test("reads the remaining count from every alias", () => {
    for (const key of ["remaining", "quota_remaining", "quotaRemaining"]) {
      const quota = parseQuotaSnapshot({ entitlement: 100, [key]: 40 }, "premium", "src", null);
      expect(quota?.remaining).toBe(40);
      expect(quota?.used).toBe(60);
      expect(quota?.usedPercent).toBe(60);
    }
  });

  test("reads the remaining percent from every alias", () => {
    for (const key of ["percent_remaining", "percentRemaining"]) {
      const quota = parseQuotaSnapshot({ entitlement: 100, [key]: 25 }, "premium", "src", null);
      expect(quota?.remainingPercent).toBe(25);
      expect(quota?.usedPercent).toBe(75);
    }
  });
});
