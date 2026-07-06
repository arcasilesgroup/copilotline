import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  defaultCopilotlineConfig,
  readCopilotlineConfig,
} from "../src/infrastructure/copilotline-config.js";
import { cleanupTempDir, createTempDir } from "./helpers.js";

describe("readCopilotlineConfig", () => {
  let tmp: string | null = null;

  afterEach(() => {
    if (tmp) cleanupTempDir(tmp);
    tmp = null;
  });

  test("returns defaults for a malformed config instead of throwing", () => {
    tmp = createTempDir();
    const path = join(tmp, "config.json");
    writeFileSync(path, "{ not valid json", "utf-8");

    expect(() => readCopilotlineConfig(path)).not.toThrow();
    expect(readCopilotlineConfig(path)).toEqual(defaultCopilotlineConfig());
  });

  test("reads a manual account from valid config", () => {
    tmp = createTempDir();
    const path = join(tmp, "config.json");
    writeFileSync(
      path,
      JSON.stringify({
        account: { mode: "manual", login: "octocat", host: "github.com" },
      }),
      "utf-8",
    );

    expect(readCopilotlineConfig(path).account).toEqual({
      mode: "manual",
      login: "octocat",
      host: "github.com",
    });
  });

  test("reads usage units and showCost from config; units default to credit", () => {
    tmp = createTempDir();
    const path = join(tmp, "config.json");
    const prev = process.env["COPILOTLINE_USAGE_UNITS"];
    try {
      delete process.env["COPILOTLINE_USAGE_UNITS"];
      writeFileSync(
        path,
        JSON.stringify({ usage: { showCost: true } }),
        "utf-8",
      );
      expect(readCopilotlineConfig(path).usage).toEqual({
        units: "credit",
        showCost: true,
      });

      writeFileSync(
        path,
        JSON.stringify({ usage: { units: "token" } }),
        "utf-8",
      );
      expect(readCopilotlineConfig(path).usage).toEqual({
        units: "token",
        showCost: false,
      });
    } finally {
      if (prev === undefined) delete process.env["COPILOTLINE_USAGE_UNITS"];
      else process.env["COPILOTLINE_USAGE_UNITS"] = prev;
    }
  });

  test("COPILOTLINE_USAGE_UNITS overrides the config file units", () => {
    tmp = createTempDir();
    const path = join(tmp, "config.json");
    writeFileSync(
      path,
      JSON.stringify({ usage: { units: "token", showCost: true } }),
      "utf-8",
    );
    const prev = process.env["COPILOTLINE_USAGE_UNITS"];
    try {
      process.env["COPILOTLINE_USAGE_UNITS"] = "usd";
      const cfg = readCopilotlineConfig(path);
      expect(cfg.usage.units).toBe("usd");
      expect(cfg.usage.showCost).toBe(true);
    } finally {
      if (prev === undefined) delete process.env["COPILOTLINE_USAGE_UNITS"];
      else process.env["COPILOTLINE_USAGE_UNITS"] = prev;
    }
  });

  test("reads a billing owner from config and lets env override it", () => {
    tmp = createTempDir();
    const path = join(tmp, "config.json");
    writeFileSync(
      path,
      JSON.stringify({
        billing: { owner: "acme-inc", ownerType: "organization" },
      }),
      "utf-8",
    );

    const prevOwner = process.env["COPILOTLINE_BILLING_OWNER"];
    const prevOwnerType = process.env["COPILOTLINE_BILLING_OWNER_TYPE"];
    try {
      expect(readCopilotlineConfig(path).billing).toEqual({
        owner: "acme-inc",
        ownerType: "organization",
      });

      process.env["COPILOTLINE_BILLING_OWNER"] = "octocat";
      process.env["COPILOTLINE_BILLING_OWNER_TYPE"] = "user";
      expect(readCopilotlineConfig(path).billing).toEqual({
        owner: "octocat",
        ownerType: "user",
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
});
