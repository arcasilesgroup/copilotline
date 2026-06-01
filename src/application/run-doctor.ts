import {
  summarizeReport,
  type DiagnosticSection,
  type DoctorReport,
} from "../domain/doctor.js";
import type { QuotaUnit } from "../domain/status-line.js";
import {
  displayAccount,
  sourceLabel,
  type AccountIdentity,
} from "../infrastructure/copilot-account.js";

export interface DoctorInput {
  version: string;
  generatedAt: string;
  copilotCommandAvailable: boolean;
  copilotVersion: string | null;
  copilotHome: string;
  settingsPath: string;
  settingsExists: boolean;
  settingsParseError: string | null;
  statusLineCommand: string | null;
  customStatusVisible: boolean;
  statusLineCommandAvailable: boolean | null;
  recommendedCommand: string;
  binaryAvailable: boolean;
  gitAvailable: boolean;
  renderPreview: string | null;
  nodeVersion: string;
  selectedAccount: AccountIdentity | null;
  systemAccount: AccountIdentity | null;
  accountMode: "auto" | "manual";
  accountOverride: AccountIdentity | null;
  tokenAvailableForSelectedAccount: boolean;
  tokenSourceForSelectedAccount: string | null;
  tokenErrorForSelectedAccount: string | null;
  quotaUnit: QuotaUnit | null;
}

// Reports which billing model the last cached upstream response used, so the
// day GitHub changes the quota shape is observable from `doctor` (spec-002).
function billingUnitMessage(unit: QuotaUnit | null): string {
  if (unit === "credit") {
    return "Billing unit: AI credits (token-based billing detected)";
  }
  if (unit === "token") {
    return "Billing unit: tokens (token-based billing detected)";
  }
  if (unit === "request") {
    return "Billing unit: premium requests (legacy request-count model)";
  }
  return "Billing unit: no quota snapshot cached yet";
}

export function runDoctor(input: DoctorInput): DoctorReport {
  const sections: DiagnosticSection[] = [
    {
      title: "Environment",
      lines: [
        {
          status: "pass",
          message: `Copilot home: ${input.copilotHome}`,
        },
        {
          status: "pass",
          message: `Node: ${input.nodeVersion}`,
        },
        {
          status: input.binaryAvailable ? "pass" : "warn",
          message: input.binaryAvailable
            ? `copilotline command available on PATH`
            : `copilotline command not found on PATH`,
          fix: input.binaryAvailable
            ? undefined
            : `Install the package globally or keep using the built dist/cli.js directly.`,
        },
        {
          status: input.copilotCommandAvailable ? "pass" : "warn",
          message: input.copilotCommandAvailable
            ? input.copilotVersion
              ? `copilot command available (${input.copilotVersion})`
              : `copilot command available, but version could not be detected`
            : `copilot command not found on PATH`,
          fix: input.copilotCommandAvailable
            ? undefined
            : `Install GitHub Copilot CLI to test the statusLine.command integration.`,
        },
        {
          status: input.gitAvailable ? "pass" : "warn",
          message: input.gitAvailable
            ? `git command available`
            : `git command not found`,
          fix: input.gitAvailable
            ? undefined
            : `Install git to enable branch, dirty-state, and worktree segments.`,
        },
      ],
    },
    {
      title: "Configuration",
      lines: [
        {
          status: input.settingsExists ? "pass" : "warn",
          message: input.settingsExists
            ? `Settings file found: ${input.settingsPath}`
            : `Settings file not found: ${input.settingsPath}`,
          fix: input.settingsExists
            ? undefined
            : `Run copilotline install to create the statusLine entry.`,
        },
        {
          status:
            input.settingsParseError !== null
              ? "fail"
              : input.statusLineCommand === null
                ? "warn"
                : input.statusLineCommandAvailable === false
                  ? "warn"
                  : "pass",
          message:
            input.settingsParseError !== null
              ? `settings.json could not be parsed: ${input.settingsParseError}`
              : input.statusLineCommand === null
                ? `statusLine.command is not configured`
                : input.statusLineCommandAvailable === false
                  ? `statusLine.command points to ${input.statusLineCommand}, but that executable was not found`
                  : input.statusLineCommand === input.recommendedCommand
                    ? `statusLine.command is wired to ${input.recommendedCommand}`
                    : `statusLine.command points to ${input.statusLineCommand}`,
          fix:
            input.settingsParseError !== null
              ? `Fix the JSONC syntax in settings.json before running install again.`
              : input.statusLineCommand === null
                ? `Run copilotline install to create the statusLine entry.`
                : input.statusLineCommandAvailable === false
                  ? `Install the configured executable or run copilotline install to point statusLine.command to ${input.recommendedCommand}.`
                  : undefined,
        },
        {
          status:
            input.settingsParseError !== null
              ? "fail"
              : input.customStatusVisible
                ? "pass"
                : "warn",
          message:
            input.settingsParseError !== null
              ? `settings.json could not be parsed: ${input.settingsParseError}`
              : input.customStatusVisible
                ? `footer.showCustom is enabled`
                : `footer.showCustom is disabled, so the custom statusLine.command is hidden`,
          fix:
            input.settingsParseError !== null
              ? `Fix the JSONC syntax in settings.json before running install again.`
              : input.customStatusVisible
                ? undefined
                : `Run copilotline install or enable Custom in /statusline.`,
        },
      ],
    },
    {
      title: "Account",
      lines: [
        {
          status: input.systemAccount ? "pass" : "warn",
          message: input.systemAccount
            ? `Active Copilot account: ${displayAccount(input.systemAccount)} (${sourceLabel(input.systemAccount.source)})`
            : `Active Copilot account could not be detected`,
          fix: input.systemAccount
            ? undefined
            : `Run copilot login or make sure VS Code/Copilot has an active GitHub account.`,
        },
        {
          status:
            input.accountMode === "manual" &&
            input.accountOverride &&
            input.systemAccount &&
            !sameAccount(input.accountOverride, input.systemAccount)
              ? "warn"
              : "pass",
          message:
            input.accountMode === "manual" && input.accountOverride
              ? `Quota account override: ${displayAccount(input.accountOverride)}`
              : `Quota account mode: auto`,
          fix:
            input.accountMode === "manual" &&
            input.accountOverride &&
            input.systemAccount &&
            !sameAccount(input.accountOverride, input.systemAccount)
              ? `Run copilotline use auto to follow ${displayAccount(input.systemAccount)}.`
              : undefined,
        },
        {
          status: input.selectedAccount
            ? input.tokenAvailableForSelectedAccount
              ? "pass"
              : "warn"
            : "warn",
          message: input.selectedAccount
            ? input.tokenAvailableForSelectedAccount
              ? `Quota token available for ${displayAccount(input.selectedAccount)} (${input.tokenSourceForSelectedAccount})`
              : `No quota token available for ${displayAccount(input.selectedAccount)}`
            : `No quota account selected`,
          fix:
            input.selectedAccount && !input.tokenAvailableForSelectedAccount
              ? `Authenticate ${displayAccount(input.selectedAccount)} with gh auth login, or set a matching COPILOTLINE_GITHUB_TOKEN.`
              : undefined,
        },
        {
          status: "pass",
          message: billingUnitMessage(input.quotaUnit),
        },
      ],
    },
    {
      title: "Rendering",
      lines: [
        {
          status: input.renderPreview ? "pass" : "fail",
          message: input.renderPreview
            ? `Synthetic render succeeded: ${input.renderPreview}`
            : `Synthetic render failed`,
          fix: input.renderPreview
            ? undefined
            : `Inspect render logic and payload normalization.`,
        },
      ],
    },
  ];

  return {
    version: input.version,
    generatedAt: input.generatedAt,
    sections,
    summary: summarizeReport(sections),
  };
}

function sameAccount(a: AccountIdentity, b: AccountIdentity): boolean {
  return (
    a.login.toLowerCase() === b.login.toLowerCase() &&
    a.host.toLowerCase() === b.host.toLowerCase()
  );
}
