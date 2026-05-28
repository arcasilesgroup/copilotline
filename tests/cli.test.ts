import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { cleanupTempDir, createTempDir } from "./helpers.js";

const root = join(import.meta.dirname, "..");
const dist = join(root, "dist", "cli.js");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as {
  version: string;
};

function run(
  args: string[],
  options: {
    stdin?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  return spawnSync("node", [dist, ...args], {
    cwd: options.cwd ?? root,
    env: { ...process.env, COPILOTLINE_USAGE: "0", COPILOTLINE_ACCOUNT: "0", ...options.env },
    input: options.stdin ?? "",
    encoding: "utf-8",
  });
}

beforeAll(() => {
  const result = spawnSync(
    "bun",
    [
      "build",
      "src/cli.ts",
      "--target=node",
      "--outfile=dist/cli.js",
      "--minify",
      "--banner=#!/usr/bin/env node",
    ],
    { cwd: root, encoding: "utf-8" },
  );

  if (result.status !== 0) {
    throw new Error(`bun build failed: ${result.stderr}`);
  }
});

describe("cli", () => {
  test("--version matches package.json", () => {
    const result = run(["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  test("--help prints usage", () => {
    const result = run(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("copilotline render");
  });

  test("defaults to render for piped statusline input", () => {
    const result = run([], {
      stdin: JSON.stringify({
        model: { displayName: "GPT-5.4" },
        contextWindow: { usedPercent: 12 },
      }),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("GPT-5.4");
    expect(result.stdout).toContain("✍️");
    expect(result.stdout).toContain("12%");
  });

  test("render --json emits normalized data", () => {
    const result = run(
      ["render", "--json"],
      {
        stdin: JSON.stringify({
          model: { displayName: "GPT-5.4" },
          cwd: "/tmp/demo",
          contextWindow: { usedPercent: 12 },
        }),
      },
    );

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: { model: { label: string | null }; context: { usedPercent: number | null } };
    };
    expect(parsed.data.model.label).toBe("GPT-5.4");
    expect(parsed.data.context.usedPercent).toBe(12);
  });

  test("render --capture persists the raw payload", () => {
    const tempDir = createTempDir();
    const capturePath = join(tempDir, "status.json");

    try {
      const payload = '{"model":{"displayName":"GPT-5.4"}}';
      const result = run(["render", "--capture", capturePath], { stdin: payload });
      expect(result.status).toBe(0);
      expect(readFileSync(capturePath, "utf-8")).toBe(payload);
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test("install and uninstall mutate COPILOT_HOME settings.json", () => {
    const tempDir = createTempDir();

    try {
      const settingsPath = join(tempDir, "settings.json");
      writeFileSync(settingsPath, '{\n  "theme": "dark"\n}\n', "utf-8");

      const installResult = run(["install"], {
        env: { COPILOT_HOME: tempDir },
      });
      expect(installResult.status).toBe(0);

      const installedText = readFileSync(settingsPath, "utf-8");
      expect(installedText).toContain('"statusLine"');
      expect(installedText).toContain('"command":');
      expect(installedText).toContain("dist/cli.js");
      expect(installedText).not.toContain('"STATUS_LINE"');
      expect(installedText).toContain('"showCustom": true');
      expect(installedText).not.toContain('"copilotline render"');

      const uninstallResult = run(["uninstall"], {
        env: { COPILOT_HOME: tempDir },
      });
      expect(uninstallResult.status).toBe(0);

      const uninstalledText = readFileSync(settingsPath, "utf-8");
      expect(uninstalledText).not.toContain('"statusLine"');
      expect(uninstalledText).toContain('"theme": "dark"');
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test("account command configures auto and manual modes", () => {
    const tempDir = createTempDir();

    try {
      const manual = run(["account", "--set", "work-account"], {
        env: { COPILOTLINE_CONFIG_DIR: tempDir },
      });
      expect(manual.status).toBe(0);

      const manualConfig = JSON.parse(readFileSync(join(tempDir, "config.json"), "utf-8")) as {
        account: { mode: string; login: string | null };
      };
      expect(manualConfig.account.mode).toBe("manual");
      expect(manualConfig.account.login).toBe("work-account");

      const auto = run(["account", "--auto"], {
        env: { COPILOTLINE_CONFIG_DIR: tempDir },
      });
      expect(auto.status).toBe(0);

      const autoConfig = JSON.parse(readFileSync(join(tempDir, "config.json"), "utf-8")) as {
        account: { mode: string; login: string | null };
      };
      expect(autoConfig.account.mode).toBe("auto");
      expect(autoConfig.account.login).toBeNull();
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test("account list is non-interactive when stdin is not a TTY", () => {
    const result = run(["account", "--list"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("mode:");
    expect(result.stdout).toContain("selected:");
  });

  test("doctor --json emits structured diagnostics", () => {
    const tempDir = createTempDir();

    try {
      const result = run(["doctor", "--json"], {
        env: { COPILOT_HOME: tempDir },
      });
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        version: string;
        sections: Array<{ title: string }>;
        summary: { pass: number; warn: number; fail: number };
      };
      expect(parsed.version).toBe(pkg.version);
      expect(parsed.sections.length).toBeGreaterThan(0);
      expect(parsed.summary.pass + parsed.summary.warn + parsed.summary.fail).toBeGreaterThan(0);
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test("doctor accepts statusLine.command values with shell-style arguments", () => {
    const tempDir = createTempDir();

    try {
      writeFileSync(
        join(tempDir, "settings.json"),
        `{
  "statusLine": {
    "type": "command",
    "command": "node --version",
    "padding": 1
  }
}
`,
        "utf-8",
      );

      const result = run(["doctor"], {
        env: { COPILOT_HOME: tempDir },
      });

      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("shell-style arguments");
      expect(result.stdout).toContain("node --version");
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test("doctor warns when footer.showCustom is disabled", () => {
    const tempDir = createTempDir();

    try {
      writeFileSync(
        join(tempDir, "settings.json"),
        `{
  "statusLine": {
    "type": "command",
    "command": "copilotline",
    "padding": 1
  },
  "footer": {
    "showCustom": false
  }
}
`,
        "utf-8",
      );

      const result = run(["doctor"], {
        env: { COPILOT_HOME: tempDir },
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("showCustom");
      expect(result.stdout).toContain("hidden");
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test("install fails cleanly when settings.json is invalid", () => {
    const tempDir = createTempDir();

    try {
      writeFileSync(join(tempDir, "settings.json"), "{ invalid jsonc", "utf-8");

      const result = run(["install"], {
        env: { COPILOT_HOME: tempDir },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("copilotline:");
    } finally {
      cleanupTempDir(tempDir);
    }
  });
});
