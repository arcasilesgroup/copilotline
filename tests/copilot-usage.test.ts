import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  parseCopilotUsageResponse,
  readCachedCopilotUsage,
  usageCachePath,
} from "../src/infrastructure/copilot-usage.js";
import { cleanupTempDir, createTempDir } from "./helpers.js";

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

  test("skips a zero-entitlement premium snapshot on free accounts and falls through (D-002-13)", () => {
    // Free-tier payload: premium_interactions carries no allowance
    // (`has_quota: false`, entitlement 0, percent_remaining 0). It must NOT
    // render as a misleading 100%-consumed bar; selection falls through to a
    // unit the account actually holds.
    const quota = parseCopilotUsageResponse({
      quota_reset_date: "2026-07-01T00:00:00Z",
      quota_snapshots: {
        premium_interactions: {
          entitlement: 0,
          remaining: 0,
          percent_remaining: 0,
          has_quota: false,
          unlimited: false,
        },
        chat: {
          entitlement: 200,
          remaining: 200,
          percent_remaining: 100,
          has_quota: false,
        },
      },
    });

    expect(quota?.source).toBe("chat");
    expect(quota?.entitlement).toBe(200);
    expect(quota?.usedPercent).toBe(0);
  });

  test("returns null when the only snapshot is a free-tier zero-allowance unit (D-002-13)", () => {
    expect(
      parseCopilotUsageResponse({
        quota_snapshots: {
          premium_interactions: {
            entitlement: 0,
            remaining: 0,
            percent_remaining: 0,
            has_quota: false,
            unlimited: false,
          },
        },
      }),
    ).toBeNull();
  });

  test("parses an unknown token/credit snapshot key and prefers it (D-002-05)", () => {
    const quota = parseCopilotUsageResponse({
      quota_reset_date: "2026-07-01T00:00:00Z",
      quota_snapshots: {
        // legacy request key still present, but a new credit key should win
        premium_models: { entitlement: 1_000, remaining: 900 },
        credit_usage: { credit_entitlement: 1500, credits_remaining: 1395 },
      },
    });

    expect(quota?.unit).toBe("credit");
    expect(quota?.entitlement).toBe(1500);
    expect(quota?.remaining).toBe(1395);
  });

  test("degrades to null without throwing on malformed input", () => {
    expect(parseCopilotUsageResponse(null)).toBeNull();
    expect(parseCopilotUsageResponse("nonsense")).toBeNull();
    expect(parseCopilotUsageResponse({ quota_snapshots: "bad" })).toBeNull();
    expect(
      parseCopilotUsageResponse({ quota_snapshots: { premium_models: 5 } }),
    ).toBeNull();
    expect(
      parseCopilotUsageResponse({
        quota_snapshots: { weird_key: { nothing: true } },
      }),
    ).toBeNull();
  });
});

describe("usage cache migration (spec-002 D-002-01)", () => {
  let tmp: string | null = null;
  const prevCacheDir = process.env["COPILOTLINE_CACHE_DIR"];

  afterEach(() => {
    if (tmp) cleanupTempDir(tmp);
    tmp = null;
    if (prevCacheDir === undefined) delete process.env["COPILOTLINE_CACHE_DIR"];
    else process.env["COPILOTLINE_CACHE_DIR"] = prevCacheDir;
  });

  test("a pre-migration cache entry without `unit` deserializes as request", () => {
    tmp = createTempDir();
    process.env["COPILOTLINE_CACHE_DIR"] = tmp;
    const account = {
      login: "octocat",
      host: "github.com",
      source: "manual" as const,
    };
    const path = usageCachePath(account);
    mkdirSync(dirname(path), { recursive: true });
    // Shape written by an older build: a quota object with NO `unit` field.
    writeFileSync(
      path,
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        account,
        tokenSource: null,
        quota: {
          label: "premium",
          entitlement: 1000,
          remaining: 900,
          usedPercent: 10,
        },
      }),
      "utf-8",
    );

    const cached = readCachedCopilotUsage(account);
    expect(cached?.cache.quota.unit).toBe("request");
  });
});
