import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import {
  buildStatusSnapshot,
  formatStatusLine,
  renderStatusLine,
} from "./application/render-status-line.js";
import {
  installStatusLineMutations,
  uninstallStatusLineMutations,
  type SettingsMutation,
} from "./application/configure-status-line.js";
import { runDoctor } from "./application/run-doctor.js";
import {
  applySettingsMutations,
  backupSettingsFile,
  defaultCopilotHome,
  defaultSettingsPath,
  parseSettings,
  readSettingsText,
  rewriteSettings,
  SettingsEditConflict,
  writeSettingsText,
} from "./infrastructure/copilot-settings-file.js";
import { isCommandAvailable } from "./infrastructure/command-tools.js";
import {
  quotaForRender,
  readCachedCopilotUsage,
  refreshCopilotUsageCache,
  refreshCopilotUsageInBackground,
  usageCachePath,
} from "./infrastructure/copilot-usage.js";
import {
  detectCopilotAccounts,
  displayAccount,
  selectCopilotAccount,
  sourceLabel,
  tokenStatusForAccount,
  type AccountIdentity,
} from "./infrastructure/copilot-account.js";
import {
  defaultCopilotlineConfigPath,
  writeCopilotlineConfig,
} from "./infrastructure/copilotline-config.js";
import { getGitInfo } from "./infrastructure/git-info.js";
import { printDoctorReport } from "./presentation/doctor-report.js";
import { VERSION } from "./version.js";
import { readFlagValue } from "./cli-args.js";

const HELP = `copilotline ${VERSION} - statusline companion for GitHub Copilot CLI

Usage:
  copilotline render                      Read Copilot status JSON from stdin and emit a status line
  copilotline render --json               Emit normalized JSON instead of text
  copilotline refresh                     Fetch and cache Copilot usage from GitHub
  copilotline refresh --json              Emit cached usage as JSON after refresh
  copilotline account                     Configure the Copilot account interactively
  copilotline account --json              Emit account detection details as JSON
  copilotline account --auto              Follow the active Copilot account
  copilotline account --set <login>       Pin quota lookup to a GitHub login
  copilotline install                     Wire copilotline into ~/.copilot/settings.json
  copilotline uninstall                   Remove statusLine from ~/.copilot/settings.json
  copilotline doctor                      Run read-only diagnostics
  copilotline doctor --json               Emit structured diagnostic JSON
  copilotline --help                      Show this help
  copilotline --version                   Show version
`;

async function main(): Promise<number> {
  const command = process.argv[2];

  if (command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return 0;
  }

  if (command === "--version" || command === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  if (command === "install") {
    return await runInstall(process.argv.slice(3));
  }

  if (command === "uninstall") {
    return runUninstall();
  }

  if (command === "doctor") {
    return await runDoctorCommand(process.argv.slice(3));
  }

  if (command === "refresh") {
    return await runRefreshCommand(process.argv.slice(3));
  }

  if (command === "account") {
    return await runAccountCommand(process.argv.slice(3));
  }

  if (command === "accounts") {
    return await runAccountCommand([...process.argv.slice(3), "--list"]);
  }

  if (command === "use") {
    return await runUseAliasCommand(process.argv.slice(3));
  }

  if (command === undefined) {
    if (process.stdin.isTTY) {
      process.stdout.write(HELP);
      return 0;
    }

    return await runRender([]);
  }

  if (command === "render") {
    return await runRender(process.argv.slice(3));
  }

  process.stderr.write(`unknown command: ${command}\n${HELP}`);
  return 2;
}

async function runRender(args: string[]): Promise<number> {
  const asJson = args.includes("--json");
  const stdin = await readStandardInput();

  const parsed = safeParse(stdin.raw);
  // Resolve the account once for the whole render; thread it into the
  // cache-only readers so the render path never re-detects (no gh/sqlite3
  // foreground spawns).
  const account = selectCopilotAccount(parsed).selected;
  const usage = quotaForRender(account);
  refreshCopilotUsageInBackground(statusLineCommand(), account);
  const snapshot = buildStatusSnapshot(parsed, {
    now: () => Date.now(),
    getGitInfo,
    quota: usage,
  });

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify(
        {
          version: VERSION,
          generated_at: new Date().toISOString(),
          truncated_input: stdin.truncated,
          data: snapshot,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  process.stdout.write(`${formatStatusLine(snapshot)}\n`);
  return 0;
}

function applySettingsOrFallback(
  settingsPath: string,
  existing: string | undefined,
  mutations: readonly SettingsMutation[],
): string {
  try {
    return applySettingsMutations(existing, mutations);
  } catch (error) {
    if (!(error instanceof SettingsEditConflict)) {
      throw error;
    }
    const backup = backupSettingsFile(settingsPath);
    process.stderr.write(
      `copilotline: could not edit ${settingsPath} in place (${error.message}); ` +
        `${backup ? `backed up to ${backup} and ` : ""}rewrote it without comments.\n`,
    );
    return rewriteSettings(existing, mutations);
  }
}

async function runInstall(args: string[]): Promise<number> {
  const settingsPath = defaultSettingsPath();
  const next = applySettingsOrFallback(
    settingsPath,
    readSettingsText(settingsPath),
    installStatusLineMutations({
      command: statusLineCommand(),
      padding: 1,
    }),
  );
  writeSettingsText(settingsPath, next);
  process.stdout.write(`copilotline installed in ${settingsPath}\n`);
  if (shouldPromptDuringInstall(args)) {
    process.stdout.write("\n");
    await runAccountCommand(["--interactive"]);
  }
  return 0;
}

function runUninstall(): number {
  const settingsPath = defaultSettingsPath();
  const existing = readSettingsText(settingsPath);

  if (existing === undefined) {
    process.stdout.write(`copilotline not installed. ${settingsPath} does not exist.\n`);
    return 0;
  }

  const next = applySettingsOrFallback(settingsPath, existing, uninstallStatusLineMutations());
  writeSettingsText(settingsPath, next);
  process.stdout.write(`copilotline removed from ${settingsPath}\n`);
  return 0;
}

async function runDoctorCommand(args: string[]): Promise<number> {
  const settingsPath = defaultSettingsPath();
  const settingsText = readSettingsText(settingsPath);

  let parseError: string | null = null;
  let statusLineCommandValue: string | null = null;
  let customStatusVisible = false;

  if (settingsText) {
    try {
      const settings = parseSettings(settingsText);
      const statusLine = settings["statusLine"];

      if (typeof statusLine === "object" && statusLine !== null && !Array.isArray(statusLine)) {
        const command = (statusLine as { command?: unknown }).command;
        if (typeof command === "string" && command.trim() !== "") {
          statusLineCommandValue = command;
        }
      }

      const footer = settings["footer"];
      if (typeof footer === "object" && footer !== null && !Array.isArray(footer)) {
        const showCustom = (footer as { showCustom?: unknown }).showCustom;
        if (typeof showCustom === "boolean") {
          customStatusVisible = showCustom;
        }
      }
    } catch (error) {
      parseError = (error as Error).message;
    }
  }

  const configuredCommandAvailable = statusLineCommandValue
    ? isCommandAvailable(statusLineCommandValue)
    : null;
  const copilotVersion = readCopilotVersion();

  const renderPreview = renderStatusLine(
    {
      model: { displayName: "GPT-5.4" },
      cwd: process.cwd(),
      contextWindow: { usedPercent: 42 },
      session: { startedAt: new Date(Date.now() - 65 * 60 * 1000).toISOString() },
      agent: { name: "task" },
      quota: {
        login: "copilot-user",
        host: "github.com",
        label: "premium",
        usedPercent: 7,
        entitlement: 1_000,
        remaining: 930,
        reset_at: "2026-06-01T00:00:00Z",
        accountSource: "copilot-config",
        tokenSource: null,
      },
    },
    { now: () => Date.now(), getGitInfo },
  );

  const accountSelection = selectCopilotAccount();
  const tokenStatus = accountSelection.selected
    ? await tokenStatusForAccount(accountSelection.selected)
    : { available: false, source: null, error: "No Copilot account detected" };

  const report = runDoctor({
    version: VERSION,
    generatedAt: new Date().toISOString(),
    copilotCommandAvailable: isCommandAvailable("copilot"),
    copilotVersion,
    copilotHome: defaultCopilotHome(),
    settingsPath,
    settingsExists: settingsText !== undefined,
    settingsParseError: parseError,
    statusLineCommand: statusLineCommandValue,
    customStatusVisible,
    statusLineCommandAvailable: configuredCommandAvailable,
    recommendedCommand: statusLineCommand(),
    binaryAvailable: isCommandAvailable("copilotline"),
    gitAvailable: isCommandAvailable("git"),
    renderPreview,
    nodeVersion: process.versions.node,
    selectedAccount: accountSelection.selected,
    systemAccount: accountSelection.system,
    accountMode: accountSelection.mode,
    accountOverride: accountSelection.override,
    tokenAvailableForSelectedAccount: tokenStatus.available,
    tokenSourceForSelectedAccount: tokenStatus.source,
    tokenErrorForSelectedAccount: tokenStatus.error,
  });

  if (args.includes("--json")) {
    process.stdout.write(
      `${JSON.stringify(
        {
          version: report.version,
          generated_at: report.generatedAt,
          sections: report.sections,
          summary: report.summary,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  process.stdout.write(`${printDoctorReport(report)}\n`);
  return 0;
}

async function runRefreshCommand(args: string[]): Promise<number> {
  const asJson = args.includes("--json");
  const quiet = args.includes("--quiet");
  const login = readFlagValue(args, "--login") ?? null;
  const host = readFlagValue(args, "--host") ?? null;

  try {
    const cache = await refreshCopilotUsageCache({ login, host });
    if (asJson) {
      process.stdout.write(`${JSON.stringify(cache, null, 2)}\n`);
    } else if (!quiet) {
      process.stdout.write(`copilotline usage cache refreshed in ${usageCachePath(cache.account)}\n`);
    }
    return 0;
  } catch (error) {
    if (asJson) {
      process.stdout.write(
        `${JSON.stringify(
          {
            error: error instanceof Error ? error.message : "Failed to refresh Copilot usage",
            cached: readCachedCopilotUsage(selectCopilotAccount().selected)?.cache ?? null,
          },
          null,
          2,
        )}\n`,
      );
    } else if (!quiet) {
      process.stderr.write(
        `copilotline refresh failed: ${
          error instanceof Error ? error.message : "Failed to refresh Copilot usage"
        }\n`,
      );
    }
    return 1;
  }
}

interface EnrichedAccount extends AccountIdentity {
  selected: boolean;
  system: boolean;
  token: {
    available: boolean;
    source: string | null;
    error: string | null;
  };
  cache: {
    path: string;
    ageMs: number;
    fetchedAt: string;
    quota: unknown;
  } | null;
}

async function runAccountCommand(args: string[]): Promise<number> {
  const asJson = args.includes("--json");
  const forceInteractive = args.includes("--interactive");
  const listOnly = args.includes("--list");
  const setLogin = readFlagValue(args, "--set");
  const setHost = readFlagValue(args, "--host") ?? "github.com";

  if (args.includes("--auto")) {
    setAccountAuto();
    return 0;
  }

  if (setLogin) {
    setAccountManual(setLogin, setHost);
    return 0;
  }

  const selection = selectCopilotAccount();
  const enriched = await enrichAccounts(detectCopilotAccounts(), selection);

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: selection.mode,
          selected: selection.selected,
          system: selection.system,
          override: selection.override,
          accounts: enriched,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  if ((forceInteractive || isInteractiveTerminal()) && !listOnly) {
    return await runInteractiveAccountSetup(selection, enriched);
  }

  process.stdout.write(`${formatAccountList(selection, enriched)}\n`);
  return 0;
}

async function enrichAccounts(
  accounts: AccountIdentity[],
  selection = selectCopilotAccount(),
): Promise<EnrichedAccount[]> {
  const enriched: EnrichedAccount[] = [];

  for (const account of accounts) {
    const token = await tokenStatusForAccount(account);
    const cached = readCachedCopilotUsage(account);
    enriched.push({
      ...account,
      selected: sameAccount(account, selection.selected),
      system: sameAccount(account, selection.system),
      token: {
        available: token.available,
        source: token.source,
        error: token.error,
      },
      cache: cached
        ? {
            path: usageCachePath(account),
            ageMs: cached.ageMs,
            fetchedAt: cached.cache.fetchedAt,
            quota: cached.cache.quota,
          }
        : null,
    });
  }

  return enriched;
}

function formatAccountList(selection: ReturnType<typeof selectCopilotAccount>, enriched: EnrichedAccount[]): string {
  const lines = [
    `mode: ${selection.mode}`,
    `system: ${displayAccount(selection.system)}`,
    `selected: ${displayAccount(selection.selected)}`,
    "",
  ];

  if (enriched.length === 0) {
    lines.push("No GitHub/Copilot accounts detected.");
  } else {
    for (const account of enriched) {
      const marks = [
        account.selected ? "selected" : null,
        account.system ? "system" : null,
      ].filter(Boolean).join(", ");
      const token = account.token.available
        ? `token: ${account.token.source}`
        : `token: missing`;
      const cache = account.cache ? `cache: ${account.cache.fetchedAt}` : "cache: none";
      lines.push(
        `${displayAccount(account)} (${sourceLabel(account.source)}${marks ? `, ${marks}` : ""}) - ${token}; ${cache}`,
      );
    }
  }

  return lines.join("\n");
}

async function runInteractiveAccountSetup(
  selection: ReturnType<typeof selectCopilotAccount>,
  accounts: EnrichedAccount[],
): Promise<number> {
  printAccountHeader(selection);

  if (accounts.length === 0) {
    process.stdout.write(`${style("No GitHub/Copilot accounts detected.", "yellow")}\n`);
    process.stdout.write("Run `copilot login` or `gh auth login`, then run `copilotline account` again.\n");
    return 1;
  }

  const options = [
    {
      label: `Auto - follow active Copilot account (${displayAccount(selection.system)})`,
      kind: "auto" as const,
      account: null,
      selected: selection.mode === "auto",
      tokenAvailable: selection.selected
        ? accounts.find((account) => sameAccount(account, selection.selected))?.token.available ?? false
        : false,
    },
    ...accounts.map((account) => ({
      label: `${displayAccount(account)} (${sourceLabel(account.source)}${account.system ? ", system" : ""})`,
      kind: "manual" as const,
      account,
      selected: selection.mode === "manual" && account.selected,
      tokenAvailable: account.token.available,
    })),
  ];

  process.stdout.write(`${style("Choose quota account", "cyan")}\n\n`);
  options.forEach((option, index) => {
    const marker = option.selected ? style("●", "green") : "○";
    const token = option.tokenAvailable ? style("token ok", "green") : style("token missing", "yellow");
    process.stdout.write(`  ${style(String(index + 1).padStart(2), "dim")}. ${marker} ${option.label} ${style("·", "dim")} ${token}\n`);
  });
  process.stdout.write("\n");

  const answer = await prompt(`Select [1-${options.length}] (Enter keeps current): `);
  const trimmed = answer.trim();
  if (trimmed === "") {
    process.stdout.write(`${style("Keeping current account configuration.", "dim")}\n`);
    return 0;
  }

  const index = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(index) || index < 1 || index > options.length) {
    process.stderr.write(`Invalid selection: ${trimmed}\n`);
    return 2;
  }

  const option = options[index - 1];
  if (!option) {
    process.stderr.write(`Invalid selection: ${trimmed}\n`);
    return 2;
  }

  if (option.kind === "auto") {
    setAccountAuto();
    return 0;
  }

  if (option.account) {
    setAccountManual(option.account.login, option.account.host);
    if (!option.tokenAvailable) {
      process.stdout.write(
        `${style("Warning:", "yellow")} no token is available for ${displayAccount(option.account)}. Run \`gh auth login\` for that account or set a matching COPILOTLINE_GITHUB_TOKEN.\n`,
      );
    }
  }

  return 0;
}

function printAccountHeader(selection: ReturnType<typeof selectCopilotAccount>): void {
  process.stdout.write(`${style("┌─ copilotline account", "cyan")}\n`);
  process.stdout.write(`${style("│", "cyan")} mode     ${selection.mode}\n`);
  process.stdout.write(`${style("│", "cyan")} system   ${displayAccount(selection.system)}\n`);
  process.stdout.write(`${style("│", "cyan")} selected ${displayAccount(selection.selected)}\n`);
  process.stdout.write(`${style("└────────────────────", "cyan")}\n\n`);
}

async function runUseAliasCommand(args: string[]): Promise<number> {
  const login = args[0];
  if (!login) {
    process.stderr.write("usage: copilotline account --auto | copilotline account --set <login>\n");
    return 2;
  }

  if (login === "auto") {
    return runAccountCommand(["--auto"]);
  }

  const host = readFlagValue(args, "--host") ?? "github.com";
  return runAccountCommand(["--set", login, "--host", host]);
}

function setAccountAuto(): void {
  writeCopilotlineConfig({
    account: { mode: "auto", login: null, host: null },
  });
  process.stdout.write(`${style("✓", "green")} copilotline will follow the active Copilot account (${defaultCopilotlineConfigPath()})\n`);
}

function setAccountManual(login: string, host: string): void {
  writeCopilotlineConfig({
    account: { mode: "manual", login, host },
  });
  process.stdout.write(`${style("✓", "green")} copilotline pinned to ${login} (${defaultCopilotlineConfigPath()})\n`);
}

function shouldPromptDuringInstall(args: string[]): boolean {
  return !args.includes("--no-account") && isInteractiveTerminal();
}

function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

function style(text: string, name: "cyan" | "green" | "yellow" | "dim"): string {
  if (process.env["NO_COLOR"] !== undefined || process.env["TERM"] === "dumb") {
    return text;
  }

  const codes: Record<typeof name, string> = {
    cyan: "\x1b[38;2;86;182;194m",
    green: "\x1b[38;2;0;175;80m",
    yellow: "\x1b[38;2;230;200;0m",
    dim: "\x1b[2m",
  };
  return `${codes[name]}${text}\x1b[0m`;
}

function statusLineCommand(): string {
  return fileURLToPath(import.meta.url);
}

function readCopilotVersion(): string | null {
  const result = spawnSync("copilot", ["--version"], {
    encoding: "utf-8",
    timeout: 2_000,
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  const match = `${result.stdout}\n${result.stderr}`.match(
    /GitHub Copilot CLI\s+(\d+\.\d+\.\d+(?:-\d+)?)/,
  );
  return match?.[1] ?? null;
}

function sameAccount(a: AccountIdentity | null, b: AccountIdentity | null): boolean {
  return Boolean(
    a &&
    b &&
    a.login.toLowerCase() === b.login.toLowerCase() &&
    a.host.toLowerCase() === b.host.toLowerCase(),
  );
}

function safeParse(raw: string): unknown {
  if (raw.trim() === "") {
    return {};
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

async function readStandardInput(
  maxBytes: number = 2_000_000,
): Promise<{ raw: string; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    if (size > maxBytes) {
      return { raw: "", truncated: true };
    }

    chunks.push(buffer);
  }

  return { raw: Buffer.concat(chunks).toString("utf-8"), truncated: false };
}

try {
  const exitCode = await main();
  process.exit(exitCode);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`copilotline: ${message}\n`);
  process.exit(1);
}
