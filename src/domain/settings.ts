export const BUILT_IN_FOOTER_KEYS = [
  "showModelEffort",
  "showDirectory",
  "showBranch",
  "showContextWindow",
  "showQuota",
  "showAgent",
  "showCodeChanges",
  "showUsername",
] as const;

export type FooterSettingKey = (typeof BUILT_IN_FOOTER_KEYS)[number];

export interface StatusLineSettings {
  type?: string;
  command?: string;
  padding?: number;
}

export interface FooterSettings {
  showModelEffort?: boolean;
  showDirectory?: boolean;
  showBranch?: boolean;
  showContextWindow?: boolean;
  showQuota?: boolean;
  showAgent?: boolean;
  showCodeChanges?: boolean;
  showUsername?: boolean;
  showCustom?: boolean;
}

export interface CopilotSettings extends Record<string, unknown> {
  statusLine?: StatusLineSettings;
  footer?: FooterSettings;
}

export function expectedStatusLineSettings(
  command: string,
  padding: number,
): StatusLineSettings {
  return {
    type: "command",
    command,
    padding,
  };
}
