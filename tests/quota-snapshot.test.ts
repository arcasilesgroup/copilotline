import { describe, expect, test } from "bun:test";
import { parseCopilotUsageResponse } from "../src/infrastructure/copilot-usage.js";

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
});
