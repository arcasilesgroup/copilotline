import { describe, expect, test } from "bun:test";
import { readFlagValue } from "../src/cli-args.js";

describe("readFlagValue", () => {
  test("returns the value following a flag", () => {
    expect(readFlagValue(["--login", "octocat"], "--login")).toBe("octocat");
  });

  test("rejects a flag-shaped value instead of swallowing the next flag", () => {
    expect(readFlagValue(["--login", "--host", "github.com"], "--login")).toBeUndefined();
  });

  test("returns undefined for a missing flag or a trailing flag", () => {
    expect(readFlagValue(["render"], "--login")).toBeUndefined();
    expect(readFlagValue(["--login"], "--login")).toBeUndefined();
  });
});
