import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  installStatusLineMutations,
  uninstallStatusLineMutations,
} from "../src/application/configure-status-line.js";
import {
  applySettingsMutations,
  backupSettingsFile,
  parseSettings,
  rewriteSettings,
  SettingsEditConflict,
} from "../src/infrastructure/copilot-settings-file.js";
import { cleanupTempDir, createTempDir } from "./helpers.js";

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

describe("settings edit fallback (.bak + rewrite on parse ambiguity)", () => {
  const install = installStatusLineMutations({ command: "copilotline", padding: 1 });
  // footer is present but is an array, so the surgical editor cannot set
  // footer.showCustom in place — the documented ambiguity that triggers fallback.
  const ambiguous = `{
  // note
  "footer": [1, 2]
}
`;

  test("surgical editor throws SettingsEditConflict on a member it cannot edit", () => {
    expect(() => applySettingsMutations(ambiguous, install)).toThrow(SettingsEditConflict);
  });

  test("rewriteSettings fallback succeeds where the surgical edit fails", () => {
    const rewritten = rewriteSettings(ambiguous, install);
    const parsed = parseSettings(rewritten);
    expect(parsed.statusLine?.command).toBe("copilotline");
    expect(parsed.footer?.showCustom).toBe(true);
    // The fallback rewrites the whole document, so comments are not preserved.
    expect(rewritten).not.toContain("// note");
  });

  test("backupSettingsFile writes a .bak copy of the original", () => {
    const dir = createTempDir();
    try {
      const path = join(dir, "settings.json");
      const original = `{
  // keep
  "theme": "dark"
}
`;
      writeFileSync(path, original, "utf-8");

      const backup = backupSettingsFile(path);
      expect(backup).toBe(`${path}.bak`);
      expect(readFileSync(`${path}.bak`, "utf-8")).toBe(original);
    } finally {
      cleanupTempDir(dir);
    }
  });
});
