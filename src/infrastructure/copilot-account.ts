import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { defaultCopilotHome, parseSettings } from "./copilot-settings-file.js";
import { normalizeHost, usageApiBaseForHost } from "./host-policy.js";
import {
  defaultCopilotlineConfig,
  readCopilotlineConfig,
  type AccountMode,
} from "./copilotline-config.js";
import { asRecord, pickString } from "./value-reader.js";

export type AccountSource = "payload" | "manual" | "copilot-config" | "vscode" | "gh";

export interface AccountIdentity {
  login: string;
  host: string;
  source: AccountSource;
}

export interface AccountSelection {
  mode: AccountMode;
  selected: AccountIdentity | null;
  system: AccountIdentity | null;
  override: AccountIdentity | null;
  candidates: AccountIdentity[];
}

export interface TokenResolution {
  token: string;
  login: string;
  host: string;
  source: string;
}

export interface TokenResolutionStatus {
  available: boolean;
  source: string | null;
  error: string | null;
}

/**
 * Structural shape of `fetch` the tool depends on. Decoupled from the
 * runtime's concrete `typeof fetch` (Bun's includes a static `preconnect`),
 * so test doubles only need to satisfy the call signature.
 */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type FetchImpl = FetchLike;

export interface ResolveTokenOptions {
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export function selectCopilotAccount(input?: unknown): AccountSelection {
  const config = safeReadCopilotlineConfig();
  if (accountDetectionDisabled()) {
    return {
      mode: config.account.mode,
      selected: null,
      system: null,
      override: null,
      candidates: [],
    };
  }

  const candidates = uniqueAccounts([
    accountFromPayload(input),
    accountFromCopilotConfig(),
    ...accountsFromVSCode(),
    accountFromGitHubCli(),
  ]);
  const system = candidates.find((account) => account.source !== "manual") ?? null;
  const override =
    config.account.mode === "manual" && config.account.login
      ? {
          login: config.account.login,
          host: normalizeHost(config.account.host ?? system?.host ?? "github.com"),
          source: "manual" as const,
        }
      : null;

  return {
    mode: config.account.mode,
    selected: override ?? system,
    system,
    override,
    candidates: uniqueAccounts([override, ...candidates]),
  };
}

export function detectCopilotAccounts(input?: unknown): AccountIdentity[] {
  return selectCopilotAccount(input).candidates;
}

export async function resolveTokenForAccount(
  account: AccountIdentity,
  options: ResolveTokenOptions = {},
): Promise<TokenResolution | null> {
  const env = options.env ?? process.env;
  const envCandidates: Array<[string, string | undefined]> = [
    [`COPILOTLINE_GITHUB_TOKEN_${normalizeLoginForEnv(account.login)}`, env[`COPILOTLINE_GITHUB_TOKEN_${normalizeLoginForEnv(account.login)}`]],
    ["COPILOTLINE_GITHUB_TOKEN", env["COPILOTLINE_GITHUB_TOKEN"]],
    ["COPILOT_GITHUB_TOKEN", env["COPILOT_GITHUB_TOKEN"]],
    ["GH_TOKEN", env["GH_TOKEN"]],
    ["GITHUB_TOKEN", env["GITHUB_TOKEN"]],
  ];

  for (const [source, value] of envCandidates) {
    const token = cleanToken(value);
    if (!token) {
      continue;
    }

    const login = await loginForToken(token, account.host, options);
    if (login && sameLogin(login, account.login)) {
      return { token, login, host: account.host, source };
    }
  }

  const ghToken = readGitHubCliToken(account);
  if (!ghToken) {
    return null;
  }

  const login = await loginForToken(ghToken, account.host, options);
  if (!login || !sameLogin(login, account.login)) {
    return null;
  }

  return {
    token: ghToken,
    login,
    host: account.host,
    source: `gh auth token --user ${account.login}`,
  };
}

export async function tokenStatusForAccount(
  account: AccountIdentity,
  options: ResolveTokenOptions = {},
): Promise<TokenResolutionStatus> {
  try {
    const token = await resolveTokenForAccount(account, options);
    return token
      ? { available: true, source: token.source, error: null }
      : { available: false, source: null, error: `No token available for ${account.login}` };
  } catch (error) {
    return {
      available: false,
      source: null,
      error: error instanceof Error ? error.message : `Failed to resolve token for ${account.login}`,
    };
  }
}

export function accountFromPayload(input: unknown): AccountIdentity | null {
  const login =
    pickString(
      input,
      ["account", "login"],
      ["account", "username"],
      ["account", "name"],
      ["github", "login"],
      ["github", "user", "login"],
      ["user", "login"],
      ["user", "username"],
      ["authentication", "login"],
      ["authentication", "user", "login"],
      ["copilot", "account", "login"],
      ["copilot", "user", "login"],
    ) ?? null;

  if (!login) {
    return null;
  }

  const host =
    pickString(
      input,
      ["account", "host"],
      ["account", "hostname"],
      ["github", "host"],
      ["github", "hostname"],
      ["authentication", "host"],
      ["authentication", "hostname"],
    ) ?? "github.com";

  return { login, host: normalizeHost(host), source: "payload" };
}

export function accountFromCopilotConfig(env: NodeJS.ProcessEnv = process.env): AccountIdentity | null {
  const path = join(defaultCopilotHome(env), "config.json");
  if (!existsSync(path)) {
    return null;
  }

  try {
    const config = parseSettings(readFileSync(path, "utf-8"));
    const lastUser = asRecord(config["lastLoggedInUser"]);
    const login = readString(lastUser?.["login"]);
    const host = readString(lastUser?.["host"]) ?? "github.com";
    if (login) {
      return { login, host: normalizeHost(host), source: "copilot-config" };
    }

    const users = Array.isArray(config["loggedInUsers"]) ? config["loggedInUsers"] : [];
    for (const user of users) {
      const record = asRecord(user);
      const listedLogin = readString(record?.["login"]);
      if (listedLogin) {
        return {
          login: listedLogin,
          host: normalizeHost(readString(record?.["host"]) ?? "github.com"),
          source: "copilot-config",
        };
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function accountsFromVSCode(env: NodeJS.ProcessEnv = process.env): AccountIdentity[] {
  const candidates: AccountIdentity[] = [];
  for (const stateDb of vscodeStateDbPaths(env)) {
    if (!existsSync(stateDb)) {
      continue;
    }

    for (const row of readVSCodeStateRows(stateDb)) {
      if (row.key === "GitHub.copilot-chat") {
        const account = accountFromVSCodeCopilotState(row.value);
        if (account) {
          candidates.push(account);
        }
        continue;
      }

      const match = row.key.match(/^__GitHub\.copilot-chat-(.+)$/);
      if (match?.[1]) {
        candidates.push({ login: match[1], host: "github.com", source: "vscode" });
      }
    }
  }

  return uniqueAccounts(candidates);
}

export function accountFromGitHubCli(): AccountIdentity | null {
  const result = spawnSync("gh", ["auth", "status"], {
    encoding: "utf-8",
    timeout: 2_000,
    maxBuffer: 64 * 1024,
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  const lines = `${result.stdout}\n${result.stderr}`.split(/\r?\n/);
  let currentHost = "github.com";
  let currentLogin: string | null = null;

  for (const line of lines) {
    const hostLine = line.match(/^([A-Za-z0-9.-]+)$/);
    if (hostLine?.[1]) {
      currentHost = hostLine[1];
      currentLogin = null;
      continue;
    }

    const loginLine = line.match(/Logged in to [^ ]+ account ([^ ]+)/);
    if (loginLine?.[1]) {
      currentLogin = loginLine[1];
      continue;
    }

    if (currentLogin && line.includes("Active account: true")) {
      return { login: currentLogin, host: normalizeHost(currentHost), source: "gh" };
    }
  }

  return null;
}

export { normalizeHost, usageApiBaseForHost };

export function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function safeAccountFilePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

function safeReadCopilotlineConfig() {
  try {
    return readCopilotlineConfig();
  } catch {
    return defaultCopilotlineConfig();
  }
}

function accountDetectionDisabled(): boolean {
  const value = process.env["COPILOTLINE_ACCOUNT"]?.trim().toLowerCase();
  return value === "0" || value === "false" || value === "off";
}

function accountFromVSCodeCopilotState(value: string): AccountIdentity | null {
  try {
    const state = asRecord(JSON.parse(value) as unknown);
    const lastUser = asRecord(state?.["lastLoggedInUser"]);
    const login = readString(lastUser?.["login"]);
    if (!login) {
      return null;
    }

    return {
      login,
      host: normalizeHost(readString(lastUser?.["host"]) ?? "github.com"),
      source: "vscode",
    };
  } catch {
    return null;
  }
}

function readVSCodeStateRows(path: string): Array<{ key: string; value: string }> {
  const result = spawnSync(
    "sqlite3",
    [
      "-json",
      path,
      "SELECT key, value FROM ItemTable WHERE key = 'GitHub.copilot-chat' OR key LIKE '__GitHub.copilot-chat-%';",
    ],
    {
      encoding: "utf-8",
      timeout: 2_000,
      maxBuffer: 256 * 1024,
    },
  );

  if (result.error || result.status !== 0 || result.stdout.trim() === "") {
    return [];
  }

  try {
    const rows = JSON.parse(result.stdout) as unknown;
    return Array.isArray(rows)
      ? rows.flatMap((row) => {
          const record = asRecord(row);
          const key = readString(record?.["key"]);
          const value = readString(record?.["value"]);
          return key && value ? [{ key, value }] : [];
        })
      : [];
  } catch {
    return [];
  }
}

function vscodeStateDbPaths(env: NodeJS.ProcessEnv): string[] {
  const home = homedir();
  const explicit = env["COPILOTLINE_VSCODE_STATE_DB"];
  if (explicit?.trim()) {
    return [explicit.trim()];
  }

  if (platform() === "darwin") {
    return vscodeProducts().map((product) =>
      join(home, "Library", "Application Support", product, "User", "globalStorage", "state.vscdb"),
    );
  }

  if (platform() === "win32") {
    const appData = env["APPDATA"]?.trim() || join(home, "AppData", "Roaming");
    return vscodeProducts().map((product) => join(appData, product, "User", "globalStorage", "state.vscdb"));
  }

  const configHome = env["XDG_CONFIG_HOME"]?.trim() || join(home, ".config");
  return vscodeProducts().map((product) => join(configHome, product, "User", "globalStorage", "state.vscdb"));
}

function vscodeProducts(): string[] {
  return ["Code", "Code - Insiders", "VSCodium", "Cursor", "Windsurf"];
}

function readGitHubCliToken(account: AccountIdentity): string | null {
  const result = spawnSync(
    "gh",
    ["auth", "token", "--hostname", account.host, "--user", account.login],
    {
      encoding: "utf-8",
      timeout: 3_000,
      maxBuffer: 64 * 1024,
    },
  );

  if (result.error || result.status !== 0) {
    return null;
  }

  return cleanToken(result.stdout);
}

async function loginForToken(
  token: string,
  host: string,
  options: ResolveTokenOptions,
): Promise<string | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);

  try {
    const response = await fetchImpl(`${usageApiBaseForHost(host)}/user`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `token ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "copilotline",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const record = asRecord(await response.json());
    return readString(record?.["login"]);
  } finally {
    clearTimeout(timeout);
  }
}

function uniqueAccounts(accounts: Array<AccountIdentity | null>): AccountIdentity[] {
  const seen = new Set<string>();
  const unique: AccountIdentity[] = [];

  for (const account of accounts) {
    if (!account) {
      continue;
    }

    const key = `${normalizeHost(account.host).toLowerCase()}/${account.login.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push({ ...account, host: normalizeHost(account.host) });
  }

  return unique;
}

function normalizeLoginForEnv(login: string): string {
  return login.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function cleanToken(token: string | undefined): string | null {
  const trimmed = token?.trim();
  return trimmed ? trimmed : null;
}

export function displayAccount(account: AccountIdentity | null): string {
  if (!account) {
    return "none";
  }

  const host = normalizeHost(account.host);
  return host === "github.com" ? account.login : `${account.login}@${host}`;
}

export function cacheAccountKey(account: AccountIdentity): string {
  return `${safeAccountFilePart(normalizeHost(account.host))}-${safeAccountFilePart(account.login)}`;
}

export function sourceLabel(source: AccountSource): string {
  switch (source) {
    case "copilot-config":
      return "Copilot CLI config";
    case "vscode":
      return "VS Code";
    case "payload":
      return "Copilot payload";
    case "manual":
      return "manual override";
    case "gh":
      return "GitHub CLI";
  }
}
