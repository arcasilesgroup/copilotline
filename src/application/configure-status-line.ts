import {
  BUILT_IN_FOOTER_KEYS,
  expectedStatusLineSettings,
  type FooterSettingKey,
} from "../domain/settings.js";

export interface SettingsMutation {
  path: readonly string[];
  value: unknown;
}

export interface InstallStatusLineOptions {
  command: string;
  padding?: number;
  disableBuiltInFooterItems?: boolean;
}

export function installStatusLineMutations(
  options: InstallStatusLineOptions,
): SettingsMutation[] {
  const padding = options.padding ?? 1;
  const mutations: SettingsMutation[] = [
    {
      path: ["statusLine"],
      value: expectedStatusLineSettings(options.command, padding),
    },
    {
      path: ["footer", "showCustom"],
      value: true,
    },
  ];

  if (!options.disableBuiltInFooterItems) {
    return mutations;
  }

  for (const key of BUILT_IN_FOOTER_KEYS) {
    mutations.push({
      path: ["footer", key as FooterSettingKey],
      value: false,
    });
  }

  return mutations;
}

export function uninstallStatusLineMutations(): SettingsMutation[] {
  return [
    {
      path: ["statusLine"],
      value: undefined,
    },
  ];
}
