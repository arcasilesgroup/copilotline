import { describe, expect, test } from "bun:test";
import {
  installStatusLineMutations,
  uninstallStatusLineMutations,
} from "../src/application/configure-status-line.js";
import {
  applySettingsMutations,
  parseSettings,
} from "../src/infrastructure/copilot-settings-file.js";

describe("configure statusLine", () => {
  test("installs statusLine into an empty document", () => {
    const updated = applySettingsMutations(
      undefined,
      installStatusLineMutations({
        command: "copilotline",
        padding: 1,
      }),
    );

    const parsed = parseSettings(updated);
    expect(parsed.statusLine?.type).toBe("command");
    expect(parsed.statusLine?.command).toBe("copilotline");
    expect(parsed.statusLine?.padding).toBe(1);
    expect(parsed.footer?.showCustom).toBe(true);
  });

  test("accepts JSONC comments and keeps unrelated settings", () => {
    const updated = applySettingsMutations(
     `{
  // keep me
  "theme": "dark"
}
`,
      installStatusLineMutations({
        command: "copilotline",
        padding: 2,
      }),
    );

    const parsed = parseSettings(updated);
    expect(parsed["theme"]).toBe("dark");
    expect(parsed.statusLine?.padding).toBe(2);
    expect(parsed.footer?.showCustom).toBe(true);
  });

  test("removes statusLine without touching other settings", () => {
    const updated = applySettingsMutations(
      `{
  "theme": "dark",
  "statusLine": {
    "type": "command",
    "command": "copilotline",
    "padding": 1
  }
}
`,
      uninstallStatusLineMutations(),
    );

    const parsed = parseSettings(updated);
    expect(parsed["theme"]).toBe("dark");
    expect(parsed.statusLine).toBeUndefined();
  });
});
