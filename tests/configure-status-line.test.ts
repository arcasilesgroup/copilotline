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

  test("preserves JSONC comments when installing", () => {
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

    // The user's comment must survive the write — not just the setting value.
    expect(updated).toContain("// keep me");

    const parsed = parseSettings(updated);
    expect(parsed["theme"]).toBe("dark");
    expect(parsed.statusLine?.padding).toBe(2);
    expect(parsed.footer?.showCustom).toBe(true);
  });

  test("preserves comments across an install + uninstall round-trip", () => {
    const source = `{
  // important config note
  "theme": "dark",
  "editor": { "fontSize": 14 } // trailing note
}
`;

    const installed = applySettingsMutations(
      source,
      installStatusLineMutations({ command: "copilotline", padding: 1 }),
    );
    const removed = applySettingsMutations(installed, uninstallStatusLineMutations());

    expect(removed).toContain("// important config note");
    expect(removed).toContain("// trailing note");

    const parsed = parseSettings(removed);
    expect(parsed["theme"]).toBe("dark");
    expect((parsed["editor"] as { fontSize?: number }).fontSize).toBe(14);
    expect(parsed.statusLine).toBeUndefined();
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
