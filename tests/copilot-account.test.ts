import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  accountFromCopilotConfig,
  accountFromPayload,
  resolveTokenForAccount,
  selectCopilotAccount,
  type AccountIdentity,
} from "../src/infrastructure/copilot-account.js";
import { cleanupTempDir, createTempDir } from "./helpers.js";

describe("copilot account", () => {
  test("detects account from Copilot status payload", () => {
    expect(
      accountFromPayload({
        account: { login: "work-account", host: "https://github.com" },
      }),
    ).toEqual({
      login: "work-account",
      host: "github.com",
      source: "payload",
    });
  });

  test("detects account from Copilot CLI JSONC config", () => {
    const tempDir = createTempDir();
    try {
      writeFileSync(
        join(tempDir, "config.json"),
        `// Copilot CLI config
{
  "lastLoggedInUser": {
    "host": "https://github.com",
    "login": "work-account"
  },
}
`,
        "utf-8",
      );

      expect(accountFromCopilotConfig({ COPILOT_HOME: tempDir })).toEqual({
        login: "work-account",
        host: "github.com",
        source: "copilot-config",
      });
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test("payload account wins over gh fallback in auto selection", () => {
    const original = process.env["COPILOTLINE_ACCOUNT"];
    delete process.env["COPILOTLINE_ACCOUNT"];
    const tempDir = createTempDir();
    process.env["COPILOT_HOME"] = tempDir;
    process.env["COPILOTLINE_VSCODE_STATE_DB"] = join(tempDir, "missing.vscdb");

    try {
      const selection = selectCopilotAccount({
        account: { login: "work-account" },
      });
      expect(selection.selected?.login).toBe("work-account");
      expect(selection.selected?.source).toBe("payload");
    } finally {
      cleanupTempDir(tempDir);
      if (original === undefined) {
        delete process.env["COPILOTLINE_ACCOUNT"];
      } else {
        process.env["COPILOTLINE_ACCOUNT"] = original;
      }
      delete process.env["COPILOT_HOME"];
      delete process.env["COPILOTLINE_VSCODE_STATE_DB"];
    }
  });

  test("resolves only tokens matching the selected login", async () => {
    const account: AccountIdentity = {
      login: "work-account",
      host: "github.com",
      source: "copilot-config",
    };
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      const token = String((init?.headers as Record<string, string>)?.Authorization ?? "");
      const login = token.includes("matching-token") ? "work-account" : "personal-account";
      return new Response(JSON.stringify({ login }), { status: 200 });
    };

    const missing = await resolveTokenForAccount(account, {
      env: { COPILOTLINE_GITHUB_TOKEN: "wrong-token" },
      fetchImpl,
    });
    expect(missing).toBeNull();

    const matching = await resolveTokenForAccount(account, {
      env: { COPILOTLINE_GITHUB_TOKEN_WORK_ACCOUNT: "matching-token" },
      fetchImpl,
    });
    expect(matching?.source).toBe("COPILOTLINE_GITHUB_TOKEN_WORK_ACCOUNT");
    expect(matching?.login).toBe("work-account");
  });
});
