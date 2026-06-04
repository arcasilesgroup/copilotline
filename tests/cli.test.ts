import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { writeCachedCopilotBilling } from "../src/infrastructure/copilot-billing.js";
import { cacheAccountKey } from "../src/infrastructure/copilot-account.js";
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
    env: {
      ...process.env,
      COPILOTLINE_USAGE: "0",
      COPILOTLINE_BILLING: "0",
      COPILOTLINE_ACCOUNT: "0",
      ...options.env,
    },
    input: options.stdin ?? "",
    encoding: "utf-8",
  });
}

// A fabricated account that would surface if `render` leaked the host
// Copilot identity. It is the ONLY account that can appear in the no-leak
// tests because they neutralize every other detection source.
const FIXTURE_LOGIN = "octocat";
const FIXTURE_HOST = "github.com";
const FIXTURE_CACHE_KEY = `${FIXTURE_HOST}-${FIXTURE_LOGIN}`;

// Build a temp COPILOT_HOME + cache dir seeded with the fabricated octocat
// account and a matching usage cache. Detection is pointed here, so a leak
// surfaces the fixture identity, never the real host account.
function makeLeakFixture(): {
  home: string;
  cacheDir: string;
  emptyPathDir: string;
  cleanup: () => void;
} {
  const home = createTempDir("copilotline-home-");
  const cacheDir = createTempDir("copilotline-cache-");
  const emptyPathDir = createTempDir("copilotline-path-");

  writeFileSync(
    join(home, "config.json"),
    `${JSON.stringify({
      lastLoggedInUser: { login: FIXTURE_LOGIN, host: FIXTURE_HOST },
    })}\n`,
    "utf-8",
  );

  // Mirror the UsageCache shape read by readCachedCopilotUsage/quotaForRender
  // (src/infrastructure/copilot-usage.ts): fetchedAt + account + quota.
  writeFileSync(
    join(cacheDir, `${FIXTURE_CACHE_KEY}.usage-cache.json`),
    `${JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        account: {
          login: FIXTURE_LOGIN,
          host: FIXTURE_HOST,
          source: "copilot-config",
        },
        tokenSource: "fixture",
        quota: {
          login: FIXTURE_LOGIN,
          host: FIXTURE_HOST,
          label: "credits",
          unit: "credit",
          usedPercent: 42,
          remainingPercent: 58,
          entitlement: 200,
          remaining: 116,
          used: 84,
          unlimited: false,
          source: "premium_models",
          accountSource: "copilot-config",
        },
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );

  return {
    home,
    cacheDir,
    emptyPathDir,
    cleanup: () => {
      cleanupTempDir(home);
      cleanupTempDir(cacheDir);
      cleanupTempDir(emptyPathDir);
    },
  };
}

// Spawn `render` with detection ENABLED, pointed at the fixture, and every
// other detection source neutralized: a nonexistent VS Code state DB and an
// empty dir shadowing PATH so no real `gh`/`sqlite3` can run.
function runNoLeak(
  args: string[],
  fixture: { home: string; cacheDir: string; emptyPathDir: string },
  options: { stdin?: string } = {},
) {
  // Resolve node by absolute path so a deliberately-empty PATH (which shadows
  // any real `gh`/`sqlite3`) does not also break the node lookup itself.
  return spawnSync(process.execPath, [dist, ...args], {
    cwd: root,
    env: {
      ...process.env,
      COPILOTLINE_ACCOUNT: "1",
      COPILOTLINE_USAGE: "1",
      COPILOT_HOME: fixture.home,
      COPILOTLINE_CACHE_DIR: fixture.cacheDir,
  COPILOTLINE_VSCODE_STATE_DB: join(
    fixture.emptyPathDir,
    "does-not-exist.vscdb",
  ),
  PATH: fixture.emptyPathDir,
},
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
    const result = run(["render", "--json"], {
      stdin: JSON.stringify({
        model: { displayName: "GPT-5.4" },
        cwd: "/tmp/demo",
        contextWindow: { usedPercent: 12 },
      }),
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: {
        model: { label: string | null };
        context: { usedPercent: number | null };
      };
    };
    expect(parsed.data.model.label).toBe("GPT-5.4");
    expect(parsed.data.context.usedPercent).toBe(12);
  });

  test("render --json includes cached billing data", () => {
    const tempDir = createTempDir();
    const originalCacheDir = process.env["COPILOTLINE_CACHE_DIR"];

    try {
      process.env["COPILOTLINE_CACHE_DIR"] = tempDir;
      writeCachedCopilotBilling({
        fetchedAt: "2026-05-07T15:00:00.000Z",
        account: { login: "work-account", host: "github.com", source: "payload" },
        tokenSource: "explicit token",
        billing: {
          login: "work-account",
          host: "github.com",
          state: "exact",
          label: "credits",
          monthlyCredits: 43.5,
          monthlySpendUsd: 0.44,
          period: "month",
          source: "official",
          tokenSource: "explicit token",
        },
      });

      const result = run(
        ["render", "--json"],
        {
          stdin: JSON.stringify({
            account: { login: "work-account", host: "github.com" },
            model: { displayName: "GPT-5.4" },
          }),
          env: {
            COPILOTLINE_ACCOUNT: "1",
            COPILOTLINE_BILLING: "1",
            COPILOTLINE_CACHE_DIR: tempDir,
            COPILOTLINE_CONFIG_DIR: tempDir,
          },
        },
      );

      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        data: {
          billing: {
            state: string;
            monthlyCredits: number | null;
            monthlySpendUsd: number | null;
          } | null;
        };
      };
      expect(parsed.data.billing).toMatchObject({
        state: "exact",
        monthlyCredits: 43.5,
        monthlySpendUsd: 0.44,
      });
    } finally {
      if (originalCacheDir === undefined) {
        delete process.env["COPILOTLINE_CACHE_DIR"];
      } else {
        process.env["COPILOTLINE_CACHE_DIR"] = originalCacheDir;
      }
      cleanupTempDir(tempDir);
    }
  });

  test("render triggers a background refresh when billing is stale", () => {
    const tempDir = createTempDir();

    try {
      const result = run(
        ["render", "--json"],
        {
          stdin: JSON.stringify({
            account: { login: "work-account", host: "github.com" },
            model: { displayName: "GPT-5.4" },
          }),
          env: {
            COPILOTLINE_ACCOUNT: "1",
            COPILOTLINE_BILLING: "1",
            COPILOTLINE_CACHE_DIR: tempDir,
            COPILOTLINE_CONFIG_DIR: tempDir,
          },
        },
      );

      expect(result.status).toBe(0);
      expect(readdirSync(tempDir)).toContain(`${cacheAccountKey({ login: "work-account", host: "github.com", source: "payload" })}.usage-refresh.marker`);
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test("refresh --json returns a capability-only billing state when numeric billing is unavailable", () => {
    const tempDir = createTempDir();

    try {
      const result = run(["refresh", "--json", "--login", "work-account"], {
        env: {
          COPILOTLINE_USAGE: "0",
          COPILOTLINE_BILLING: "1",
          COPILOTLINE_ACCOUNT: "1",
          COPILOTLINE_CACHE_DIR: tempDir,
          COPILOTLINE_CONFIG_DIR: tempDir,
        },
      });

      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        billing: {
          billing: {
            state: string;
            monthlyCredits: number | null;
            monthlySpendUsd: number | null;
            source: string;
          };
        } | null;
      };
      expect(parsed.billing?.billing).toMatchObject({
        state: "capability",
        monthlyCredits: null,
        monthlySpendUsd: null,
        source: "unavailable",
      });
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

      const manualConfig = JSON.parse(
        readFileSync(join(tempDir, "config.json"), "utf-8"),
      ) as {
        account: { mode: string; login: string | null };
      };
      expect(manualConfig.account.mode).toBe("manual");
      expect(manualConfig.account.login).toBe("work-account");

      const auto = run(["account", "--auto"], {
        env: { COPILOTLINE_CONFIG_DIR: tempDir },
      });
      expect(auto.status).toBe(0);

      const autoConfig = JSON.parse(
        readFileSync(join(tempDir, "config.json"), "utf-8"),
      ) as {
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
      expect(
        parsed.summary.pass + parsed.summary.warn + parsed.summary.fail,
      ).toBeGreaterThan(0);
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

describe("render no-leak guard (spec-004)", () => {
  test("empty stdin renders neutral placeholder without leaking the account", () => {
    const fixture = makeLeakFixture();

    try {
      const result = runNoLeak(["render"], fixture, { stdin: "" });

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("copilotline");
      expect(result.stdout).not.toContain(FIXTURE_LOGIN);
      expect(result.stdout).not.toContain("credits");
      expect(result.stdout).not.toContain("(main)");
      expect(result.stdout).not.toMatch(/\d+%/);
    } finally {
      fixture.cleanup();
    }
  });

  test("invalid stdin renders neutral placeholder plus a stderr diagnostic", () => {
    const fixture = makeLeakFixture();

    try {
      const result = runNoLeak(["render"], fixture, { stdin: "not json" });

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("copilotline");
      expect(result.stdout).not.toContain(FIXTURE_LOGIN);
      expect(result.stdout).not.toContain("credits");
      expect(result.stdout).not.toContain("(main)");
      expect(result.stdout).not.toMatch(/\d+%/);
      expect(result.stderr).toMatch(/invalid/i);
    } finally {
      fixture.cleanup();
    }
  });

  test("render --json on empty stdin emits a neutral data:null envelope", () => {
    const fixture = makeLeakFixture();

    try {
      const result = runNoLeak(["render", "--json"], fixture, { stdin: "" });

      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as { data: unknown };
      expect(parsed.data).toBeNull();
      expect(result.stdout).not.toContain(FIXTURE_LOGIN);
    } finally {
      fixture.cleanup();
    }
  });

  // A successful JSON.parse of a non-object (null, array, primitive, or a
  // whitespace-padded primitive) is NOT a usable status payload. These must
  // route down the guarded branch instead of reaching selectCopilotAccount,
  // otherwise the host Copilot account + quota leak (spec-004 HIGH finding).
  test.each([
    ["null", "null"],
    ["empty array", "[]"],
    ["bare number", "5"],
    ["whitespace-padded primitive", "   5  "],
  ])(
    "non-object stdin (%s) renders neutral placeholder without leaking the account",
    (_label, stdin) => {
      const fixture = makeLeakFixture();

      try {
        const result = runNoLeak(["render"], fixture, { stdin });

        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe("copilotline");
        expect(result.stdout).not.toContain(FIXTURE_LOGIN);
        expect(result.stdout).not.toContain("credits");
        expect(result.stdout).not.toMatch(/\d+%/);
      } finally {
        fixture.cleanup();
      }
    },
  );

  test("a valid payload still renders the full ribbon (golden)", () => {
    const result = run([], {
      stdin: JSON.stringify({
        model: { displayName: "GPT-5.4" },
        contextWindow: { usedPercent: 12 },
      }),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("GPT-5.4");
    expect(result.stdout).toContain("12%");
  });
});

describe("render contentless-object no-leak guard (spec-005)", () => {
  // A successful JSON.parse of an OBJECT that carries NO recognized status key
  // (`{}`, `{"zzz":1}`, `{"foo":"bar"}`) is valid JSON but is NOT a real status
  // payload. spec-004 left these flowing to selectCopilotAccount (the `{}`
  // boundary), leaking the host Copilot account + quota. spec-005 closes it:
  // they must route down the placeholder branch with detection ENABLED.
  test.each([
    ["empty object", "{}"],
    ["unrelated single key", '{"zzz":1}'],
    ["unrelated string key", '{"foo":"bar"}'],
  ])(
    "contentless object (%s) renders neutral placeholder without leaking the account",
    (_label, stdin) => {
      const fixture = makeLeakFixture();

      try {
        const result = runNoLeak(["render"], fixture, { stdin });

        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe("copilotline");
        expect(result.stdout).not.toContain(FIXTURE_LOGIN);
        expect(result.stdout).not.toContain("credits");
        expect(result.stdout).not.toMatch(/\d+%/);
        // A contentless object is valid JSON, so it must NOT emit the
        // invalid-JSON stderr diagnostic (that stays reserved for parse
        // failures, D-005-02).
        expect(result.stderr).not.toMatch(/invalid/i);
      } finally {
        fixture.cleanup();
      }
    },
  );

  test("a single recognized top-level key is NOT rejected (positive)", () => {
    // `{"model":{...}}` carries one recognized key, so it is a real payload and
    // must render the model segment — guards against over-tightening the gate.
    const result = run([], {
      stdin: JSON.stringify({ model: { displayName: "GPT-5.4" } }),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("GPT-5.4");
  });

  // A recognized key NAME with an EMPTY value (`{"model":{}}`, `{"cwd":""}`,
  // `{"context_window":{}}`) is contentless: the name-only spec-005 check
  // accepted it, so it reached selectCopilotAccount and leaked the host
  // Copilot account + quota. The content-aware predicate must route these down
  // the placeholder branch with detection ENABLED.
  test.each([
    ["empty object model", '{"model":{}}'],
    ["empty object account", '{"account":{}}'],
    ["empty string cwd", '{"cwd":""}'],
    ["empty object context_window", '{"context_window":{}}'],
  ])(
    "recognized key with empty value (%s) renders neutral placeholder without leaking the account",
    (_label, stdin) => {
      const fixture = makeLeakFixture();

      try {
        const result = runNoLeak(["render"], fixture, { stdin });

        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe("copilotline");
        expect(result.stdout).not.toContain(FIXTURE_LOGIN);
        expect(result.stdout).not.toContain("credits");
        expect(result.stdout).not.toMatch(/\d+%/);
        // An empty-valued recognized key is valid JSON, so it must NOT emit the
        // invalid-JSON stderr diagnostic (D-005-02).
        expect(result.stderr).not.toMatch(/invalid/i);
      } finally {
        fixture.cleanup();
      }
    },
  );

  test("zero is a meaningful value: used percent 0 still renders (positive)", () => {
    // `{"context_window":{"usedPercent":0}}` carries a real, meaningful value:
    // numeric 0 must NOT be treated as contentless, or a fresh-session context
    // window would wrongly route to the placeholder branch. `usedPercent` is a
    // field normalizeContext actually reads, so the 0% segment must render.
    const result = run([], {
      stdin: JSON.stringify({ context_window: { usedPercent: 0 } }),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("0%");
  });

  // F2 (correctness): quotaFromHeaders reads the top-level `request` key
  // (request.headers) and a flat `x-quota-snapshot-*` header bag. Neither was
  // accepted by the name-only spec-005 check, so real read paths were wrongly
  // rejected as contentless → placeholder. The content-aware predicate must
  // accept both shapes and render the parsed quota.
  test.each([
    [
      "request.headers bag",
      JSON.stringify({
        request: {
          headers: {
            "x-quota-snapshot-premium_models": "unit=premium&rem=40&ent=300",
          },
        },
      }),
    ],
    [
      "flat header bag",
      JSON.stringify({
        "x-quota-snapshot-premium_models": "unit=premium&rem=40&ent=300",
      }),
    ],
  ])("header-only payload (%s) renders a quota (positive)", (_label, stdin) => {
    const result = run([], { stdin });

    expect(result.status).toBe(0);
    // quotaFromHeaderValue parses rem=40 → remainingPercent 40, so usedPercent
    // inverts to 60: the ribbon must show a real quota percentage, never the
    // bare `copilotline` placeholder.
    expect(result.stdout.trim()).not.toBe("copilotline");
    expect(result.stdout).toMatch(/\d+%/);
  });
});

describe("render interactive-TTY guard", () => {
  // `render` reads stdin until EOF. The black-box `run()` harness always pipes
  // stdin, so it can never reproduce the interactive case where stdin is a TTY
  // (no pipe → no EOF → the read blocks forever). To exercise that branch
  // portably (including Windows CI, where a real PTY is unavailable), spawn node
  // with a tiny pre-import shim that forces `process.stdin.isTTY = true` before
  // importing the built CLI, plus a hard self-kill so a regression surfaces as a
  // failing test instead of a hung suite.
  function runInteractiveRender(extraArgs: string[] = []) {
    const argvJson = JSON.stringify(["cli", "render", ...extraArgs]);
    const shim = [
      "const t = setTimeout(() => { console.error('HANG'); process.exit(99); }, 8000);",
      "t.unref && t.unref();",
      "process.stdin.isTTY = true;",
      `process.argv = [process.argv[0], ...${argvJson}];`,
      `import(${JSON.stringify(dist)});`,
    ].join("\n");

    return spawnSync(process.execPath, ["-e", shim], {
      cwd: root,
      env: {
        ...process.env,
        COPILOTLINE_USAGE: "0",
        COPILOTLINE_ACCOUNT: "0",
      },
      encoding: "utf-8",
      timeout: 15000,
    });
  }

  test("render on a TTY prints a usage hint and exits instead of hanging", () => {
    const result = runInteractiveRender();

    // Exit 0 (not the 99 self-kill code): the guard returned, it did not hang.
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("HANG");
    // The hint points the user at the real usage: it is driven by Copilot CLI,
    // and shows how to pipe a payload by hand.
    expect(result.stderr).toContain("reads Copilot status JSON from stdin");
    expect(result.stderr).toContain("statusLine.command");
    expect(result.stderr).toContain("| copilotline render");
    // Nothing renders to stdout — no statusline, no neutral placeholder.
    expect(result.stdout.trim()).toBe("");
  });

  test("render --json on a TTY also short-circuits to the hint", () => {
    const result = runInteractiveRender(["--json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("reads Copilot status JSON from stdin");
    expect(result.stdout.trim()).toBe("");
  });

  test("piped render never emits the interactive hint", () => {
    const result = run([], {
      stdin: JSON.stringify({
        model: { displayName: "GPT-5.4" },
        contextWindow: { usedPercent: 12 },
      }),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("GPT-5.4");
    expect(result.stderr).not.toContain("reads Copilot status JSON from stdin");
  });
});
