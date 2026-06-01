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
      const quota = parseQuotaSnapshot(
        { entitlement: 100, [key]: 40 },
        "premium",
        "src",
        null,
      );
      expect(quota?.remaining).toBe(40);
      expect(quota?.used).toBe(60);
      expect(quota?.usedPercent).toBe(60);
    }
  });

  test("reads the remaining percent from every alias", () => {
    for (const key of ["percent_remaining", "percentRemaining"]) {
      const quota = parseQuotaSnapshot(
        { entitlement: 100, [key]: 25 },
        "premium",
        "src",
        null,
      );
      expect(quota?.remainingPercent).toBe(25);
      expect(quota?.usedPercent).toBe(75);
    }
  });
});

describe("token/credit billing semantics (spec-002)", () => {
  test("a request-count snapshot defaults to unit:request", () => {
    const quota = parseQuotaSnapshot(
      { entitlement: 100, remaining: 40 },
      "premium",
      "src",
      null,
    );
    expect(quota?.unit).toBe("request");
  });

  test("a credit-shaped snapshot derives unit:credit and reads credit aliases", () => {
    const quota = parseQuotaSnapshot(
      { credit_entitlement: 1500, credits_remaining: 1395, cost_usd: 1.05 },
      "credits",
      "credit_usage",
      null,
    );
    expect(quota?.unit).toBe("credit");
    expect(quota?.entitlement).toBe(1500);
    expect(quota?.remaining).toBe(1395);
    expect(quota?.used).toBe(105);
    expect(quota?.costUsd).toBe(1.05);
  });

  test("a token-shaped snapshot derives unit:token", () => {
    const quota = parseQuotaSnapshot(
      { token_entitlement: 5_000_000, tokens_used: 1_200_000 },
      "tokens",
      "token_usage",
      null,
    );
    expect(quota?.unit).toBe("token");
    expect(quota?.used).toBe(1_200_000);
  });

  test("an explicit unit field wins over shape inference", () => {
    const quota = parseQuotaSnapshot(
      { unit: "credit", entitlement: 1500, remaining: 1395 },
      "credits",
      "src",
      null,
    );
    expect(quota?.unit).toBe("credit");
  });

  test("a used-only count with no allowance survives (D-002-12)", () => {
    const quota = parseQuotaSnapshot(
      { credits_used: 420 },
      "credits",
      "src",
      null,
    );
    expect(quota).not.toBeNull();
    expect(quota?.unit).toBe("credit");
    expect(quota?.used).toBe(420);
    expect(quota?.entitlement).toBeNull();
    expect(quota?.usedPercent).toBeNull();
  });

  test("entitlement:-1 is NOT unlimited for a non-request unit (D-002-10)", () => {
    const quota = parseQuotaSnapshot(
      { unit: "credit", entitlement: -1, credits_used: 50 },
      "credits",
      "src",
      null,
    );
    expect(quota?.unlimited).toBe(false);
    // a negative allowance is a sentinel, not a denominator: drop it so the
    // used-only clause renders instead of "/-1"
    expect(quota?.entitlement).toBeNull();
    expect(quota?.used).toBe(50);
    expect(quota?.usedPercent).toBeNull();
  });

  test("returns null only when nothing usable is present", () => {
    expect(
      parseQuotaSnapshot({ irrelevant: "x" }, "premium", "src", null),
    ).toBeNull();
  });
});
