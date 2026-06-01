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
      JSON.stringify({ account: { mode: "manual", login: "octocat", host: "github.com" } }),
      "utf-8",
    );

    expect(readCopilotlineConfig(path).account).toEqual({
      mode: "manual",
      login: "octocat",
      host: "github.com",
    });
  });
});
