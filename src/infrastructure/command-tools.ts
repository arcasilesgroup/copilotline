import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export function isCommandAvailable(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const executable = firstCommandToken(command);
  if (!executable) {
    return false;
  }

  return isExecutableReferenceAvailable(executable, env, platform);
}

export function isExecutableReferenceAvailable(
  reference: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const executable = expandExecutableReference(reference, env);
  if (!executable) {
    return false;
  }

  if (executable.includes("/") || executable.includes("\\")) {
    return existsSync(executable);
  }

  const pathValue = env["PATH"] ?? "";
  const entries = pathValue.split(delimiter).filter(Boolean);
  const suffixes = platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];

  return entries.some((entry) =>
    suffixes.some((suffix) => existsSync(join(entry, `${executable}${suffix}`))),
  );
}

function firstCommandToken(command: string): string {
  return command.trim().split(/\s+/)[0] ?? "";
}

function expandExecutableReference(
  reference: string,
  env: NodeJS.ProcessEnv,
): string {
  const expanded = expandEnvironmentVariables(reference.trim(), env);
  if (expanded === "~") {
    return homedir();
  }

  if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
    return join(homedir(), expanded.slice(2));
  }

  return expanded;
}

function expandEnvironmentVariables(
  value: string,
  env: NodeJS.ProcessEnv,
): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*):-([^}]*)\}|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (_match, defaultName: string | undefined, defaultValue: string | undefined, braceName: string | undefined, bareName: string | undefined) => {
      if (defaultName) {
        const resolved = env[defaultName];
        return resolved && resolved !== "" ? resolved : (defaultValue ?? "");
      }

      const name = braceName ?? bareName;
      return name ? (env[name] ?? "") : "";
    },
  );
}
