import { describe, expect, test } from "bun:test";
import { parseCopilotUsageResponse } from "../src/infrastructure/copilot-usage.js";

describe("copilot usage", () => {
  test("prefers the current premium_models quota snapshot", () => {
    const quota = parseCopilotUsageResponse({
      quota_reset_date: "2026-06-01T00:00:00Z",
      quota_snapshots: {
        premium_interactions: {
          entitlement: 1_000,
          remaining: 900,
          percent_remaining: 90,
        },
        premium_models: {
          entitlement: 2_000,
          remaining: 760,
          percent_remaining: 38,
          overage_count: 3.5,
          overage_permitted: true,
        },
      },
    });

    expect(quota).not.toBeNull();
    expect(quota?.source).toBe("premium_models");
    expect(quota?.usedPercent).toBe(62);
    expect(quota?.used).toBe(1240);
    expect(quota?.remaining).toBe(760);
    expect(quota?.entitlement).toBe(2000);
    expect(quota?.resetAt).toBe("2026-06-01T00:00:00Z");
    expect(quota?.overageUsed).toBe(3.5);
    expect(quota?.overagePermitted).toBe(true);
  });

  test("falls back to premium_interactions for older API payloads", () => {
    const quota = parseCopilotUsageResponse({
      quota_reset_date: "2026-06-01T00:00:00Z",
      quota_snapshots: {
        premium_interactions: {
          entitlement: "1000",
          remaining: "380",
          percent_remaining: "38",
        },
      },
    });

    expect(quota?.source).toBe("premium_interactions");
    expect(quota?.usedPercent).toBe(62);
    expect(quota?.used).toBe(620);
  });

  test("returns null when the response has no usable quota", () => {
    expect(parseCopilotUsageResponse({ quota_snapshots: {} })).toBeNull();
  });
});
