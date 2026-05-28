import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import type { SettingsMutation } from "../application/configure-status-line.js";
import type { CopilotSettings } from "../domain/settings.js";
import { asRecord } from "./value-reader.js";

export function defaultCopilotHome(env: NodeJS.ProcessEnv = process.env): string {
  return env["COPILOT_HOME"]?.trim() || join(homedir(), ".copilot");
}

export function defaultSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(defaultCopilotHome(env), "settings.json");
}

export function readSettingsText(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf-8") : undefined;
}

export function parseSettings(text: string): CopilotSettings {
  const sanitized = stripTrailingCommas(stripJsonComments(text));
  const parsed = JSON.parse(sanitized) as unknown;

  const record = asRecord(parsed);
  if (!record) {
    throw new Error("Copilot settings root must be a JSON object.");
  }

  return record as CopilotSettings;
}

export function applySettingsMutations(
  text: string | undefined,
  mutations: readonly SettingsMutation[],
): string {
  const document = parseSettings(ensureDocument(text));

  for (const mutation of mutations) {
    applyMutation(document, mutation);
  }

  return `${JSON.stringify(document, null, 2)}\n`;
}

export function writeSettingsText(path: string, text: string): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });

  const tempPath = join(
    directory,
    `.settings.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );

  writeFileSync(tempPath, text, { mode: 0o600 });
  renameSync(tempPath, path);
}

function ensureDocument(text: string | undefined): string {
  if (!text || text.trim() === "") {
    return "{\n}\n";
  }

  return text;
}

function applyMutation(target: Record<string, unknown>, mutation: SettingsMutation): void {
  const path = [...mutation.path];
  const lastSegment = path.pop();
  if (!lastSegment) {
    throw new Error("Mutation path cannot be empty.");
  }

  let cursor = target;

  for (const segment of path) {
    const existing = cursor[segment];
    if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
      cursor[segment] = {};
    }

    cursor = cursor[segment] as Record<string, unknown>;
  }

  if (mutation.value === undefined) {
    delete cursor[lastSegment];
    return;
  }

  cursor[lastSegment] = mutation.value;
}

function stripJsonComments(source: string): string {
  let output = "";
  let index = 0;
  let inString = false;
  let isEscaped = false;

  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];

    if (inString) {
      output += current;
      if (isEscaped) {
        isEscaped = false;
      } else if (current === "\\") {
        isEscaped = true;
      } else if (current === "\"") {
        inString = false;
      }
      index += 1;
      continue;
    }

    if (current === "\"") {
      inString = true;
      output += current;
      index += 1;
      continue;
    }

    if (current === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      continue;
    }

    if (current === "/" && next === "*") {
      index += 2;
      while (index + 1 < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1;
      }
      index += 2;
      continue;
    }

    output += current;
    index += 1;
  }

  return output;
}

function stripTrailingCommas(source: string): string {
  let output = "";
  let index = 0;
  let inString = false;
  let isEscaped = false;

  while (index < source.length) {
    const current = source[index];

    if (inString) {
      output += current;
      if (isEscaped) {
        isEscaped = false;
      } else if (current === "\\") {
        isEscaped = true;
      } else if (current === "\"") {
        inString = false;
      }
      index += 1;
      continue;
    }

    if (current === "\"") {
      inString = true;
      output += current;
      index += 1;
      continue;
    }

    if (current === ",") {
      let probe = index + 1;
      while (probe < source.length && /\s/.test(source[probe] ?? "")) {
        probe += 1;
      }

      if (source[probe] === "}" || source[probe] === "]") {
        index += 1;
        continue;
      }
    }

    output += current;
    index += 1;
  }

  return output;
}
