import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { asRecord } from "./value-reader.js";

export type AccountMode = "auto" | "manual";

export interface CopilotlineConfig {
  account: {
    mode: AccountMode;
    login: string | null;
    host: string | null;
  };
}

export function defaultCopilotlineConfigPath(): string {
  return join(defaultConfigDir(), "config.json");
}

export function readCopilotlineConfig(path: string = defaultCopilotlineConfigPath()): CopilotlineConfig {
  if (!existsSync(path)) {
    return defaultCopilotlineConfig();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    // A malformed config must never crash the render path; fall back to
    // defaults (auto account detection).
    return defaultCopilotlineConfig();
  }

  const record = asRecord(parsed);
  const account = asRecord(record?.["account"]);
  const mode = account?.["mode"] === "manual" ? "manual" : "auto";
  const login = readString(account?.["login"]);
  const host = readString(account?.["host"]);

  return {
    account: {
      mode,
      login,
      host,
    },
  };
}

export function writeCopilotlineConfig(
  config: CopilotlineConfig,
  path: string = defaultCopilotlineConfigPath(),
): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const tempPath = join(directory, `.config.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, path);
}

export function defaultCopilotlineConfig(): CopilotlineConfig {
  return {
    account: {
      mode: "auto",
      login: null,
      host: null,
    },
  };
}

function defaultConfigDir(): string {
  const explicit = process.env["COPILOTLINE_CONFIG_DIR"];
  if (explicit?.trim()) {
    return explicit.trim();
  }

  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "copilotline");
  }

  if (platform() === "win32") {
    const appData = process.env["APPDATA"];
    return join(appData?.trim() || join(homedir(), "AppData", "Roaming"), "copilotline");
  }

  const xdg = process.env["XDG_CONFIG_HOME"];
  return join(xdg?.trim() || join(homedir(), ".config"), "copilotline");
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
