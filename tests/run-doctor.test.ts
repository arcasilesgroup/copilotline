import { describe, expect, test } from "bun:test";
import { runDoctor } from "../src/application/run-doctor.js";

describe("runDoctor", () => {
  test("warns when statusLine is missing", () => {
    const report = runDoctor({
      version: "0.1.0",
      generatedAt: "2026-05-07T15:00:00.000Z",
      copilotCommandAvailable: true,
      copilotVersion: "1.0.54",
      copilotHome: "/tmp/.copilot",
      settingsPath: "/tmp/.copilot/settings.json",
      settingsExists: false,
      settingsParseError: null,
      statusLineCommand: null,
      customStatusVisible: false,
      statusLineCommandAvailable: null,
      recommendedCommand: "copilotline",
      binaryAvailable: false,
      gitAvailable: true,
      renderPreview: "Copilot | ctx 42%",
      nodeVersion: "25.9.0",
      selectedAccount: null,
      systemAccount: null,
      accountMode: "auto",
      accountOverride: null,
      tokenAvailableForSelectedAccount: false,
      tokenSourceForSelectedAccount: null,
      tokenErrorForSelectedAccount: null,
    });

    expect(report.summary.warn).toBeGreaterThan(0);
    expect(report.sections[1]?.lines[1]?.message).toContain("not configured");
  });

  test("passes when the expected command is wired", () => {
    const report = runDoctor({
      version: "0.1.0",
      generatedAt: "2026-05-07T15:00:00.000Z",
      copilotCommandAvailable: true,
      copilotVersion: "1.0.54",
      copilotHome: "/tmp/.copilot",
      settingsPath: "/tmp/.copilot/settings.json",
      settingsExists: true,
      settingsParseError: null,
      statusLineCommand: "copilotline",
      customStatusVisible: true,
      statusLineCommandAvailable: true,
      recommendedCommand: "/opt/homebrew/bin/copilotline",
      binaryAvailable: true,
      gitAvailable: true,
      renderPreview: "GPT-5.4 | ctx 42%",
      nodeVersion: "25.9.0",
      selectedAccount: null,
      systemAccount: null,
      accountMode: "auto",
      accountOverride: null,
      tokenAvailableForSelectedAccount: false,
      tokenSourceForSelectedAccount: null,
      tokenErrorForSelectedAccount: null,
    });

    expect(report.summary.fail).toBe(0);
    expect(report.sections[1]?.lines[1]?.status).toBe("pass");
    expect(report.sections[1]?.lines[2]?.status).toBe("pass");
  });

  test("accepts shell-style statusLine.command values", () => {
    const report = runDoctor({
      version: "0.1.0",
      generatedAt: "2026-05-07T15:00:00.000Z",
      copilotCommandAvailable: true,
      copilotVersion: "1.0.54",
      copilotHome: "/tmp/.copilot",
      settingsPath: "/tmp/.copilot/settings.json",
      settingsExists: true,
      settingsParseError: null,
      statusLineCommand: "copilotline render",
      customStatusVisible: true,
      statusLineCommandAvailable: true,
      recommendedCommand: "copilotline",
      binaryAvailable: true,
      gitAvailable: true,
      renderPreview: "GPT-5.4 | ctx 42%",
      nodeVersion: "25.9.0",
      selectedAccount: null,
      systemAccount: null,
      accountMode: "auto",
      accountOverride: null,
      tokenAvailableForSelectedAccount: false,
      tokenSourceForSelectedAccount: null,
      tokenErrorForSelectedAccount: null,
    });

    expect(report.sections[1]?.lines[1]?.status).toBe("pass");
    expect(report.sections[1]?.lines[1]?.message).toContain(
      "copilotline render",
    );
  });

  test("warns when custom status visibility is disabled", () => {
    const report = runDoctor({
      version: "0.1.0",
      generatedAt: "2026-05-07T15:00:00.000Z",
      copilotCommandAvailable: true,
      copilotVersion: "1.0.54",
      copilotHome: "/tmp/.copilot",
      settingsPath: "/tmp/.copilot/settings.json",
      settingsExists: true,
      settingsParseError: null,
      statusLineCommand: "copilotline",
      customStatusVisible: false,
      statusLineCommandAvailable: true,
      recommendedCommand: "copilotline",
      binaryAvailable: true,
      gitAvailable: true,
      renderPreview: "GPT-5.4 | ctx 42%",
      nodeVersion: "25.9.0",
      selectedAccount: null,
      systemAccount: null,
      accountMode: "auto",
      accountOverride: null,
      tokenAvailableForSelectedAccount: false,
      tokenSourceForSelectedAccount: null,
      tokenErrorForSelectedAccount: null,
    });

    expect(report.summary.warn).toBeGreaterThan(0);
    expect(report.sections[1]?.lines[2]?.message).toContain("showCustom");
  });
});
