import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import type { SettingsMutation } from "../application/configure-status-line.js";
import type { CopilotSettings } from "../domain/settings.js";
import { asRecord } from "./value-reader.js";

/**
 * Raised when the JSONC document cannot be edited surgically (malformed,
 * unterminated, or a path that would require ambiguous structural surgery).
 * Callers fall back to a `.bak` + full rewrite.
 */
export class SettingsEditConflict extends Error {}

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

/**
 * Apply mutations to a Copilot settings document, preserving comments and
 * trailing commas by editing the raw JSONC text in place. Throws
 * {@link SettingsEditConflict} when the document cannot be edited surgically;
 * callers should `.bak` the original and fall back to {@link rewriteSettings}.
 */
export function applySettingsMutations(
  text: string | undefined,
  mutations: readonly SettingsMutation[],
): string {
  let doc = ensureDocument(text);

  for (const mutation of mutations) {
    if (mutation.path.length === 0) {
      throw new Error("Mutation path cannot be empty.");
    }
    doc =
      mutation.value === undefined
        ? deleteJsoncPath(doc, mutation.path)
        : setJsoncPath(doc, mutation.path, mutation.value);
  }

  // The surgical result must still parse as Copilot settings; if it does not,
  // treat the edit as ambiguous so the caller can fall back safely.
  try {
    parseSettings(doc);
  } catch (error) {
    throw new SettingsEditConflict(
      `surgical edit produced unparsable settings: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return doc;
}

/**
 * Full-rewrite fallback: parse, mutate the object model, and re-serialize.
 * Loses comments and trailing commas — used only when the surgical edit fails.
 */
export function rewriteSettings(
  text: string | undefined,
  mutations: readonly SettingsMutation[],
): string {
  const document = parseSettings(ensureDocument(text));

  for (const mutation of mutations) {
    applyMutation(document, mutation);
  }

  return `${JSON.stringify(document, null, 2)}\n`;
}

/** Copy an existing settings file to `<path>.bak`. Returns the backup path. */
export function backupSettingsFile(path: string): string | null {
  const existing = readSettingsText(path);
  if (existing === undefined) {
    return null;
  }

  const backupPath = `${path}.bak`;
  writeSettingsText(backupPath, existing);
  return backupPath;
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

// ---------------------------------------------------------------------------
// Surgical JSONC editor — preserves comments and trailing commas by splicing
// the raw text rather than round-tripping through JSON.parse/stringify.
// ---------------------------------------------------------------------------

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);

interface JsoncMember {
  key: string;
  keyStart: number;
  valueStart: number;
  valueEnd: number;
}

interface JsoncObject {
  open: number;
  close: number;
  members: JsoncMember[];
}

function isWhitespace(char: string | undefined): boolean {
  return char !== undefined && WHITESPACE.has(char);
}

/** Advance past whitespace and `//` / `/* *\/` comments. */
function skipTrivia(text: string, index: number): number {
  let i = index;
  while (i < text.length) {
    const char = text[i];
    if (isWhitespace(char)) {
      i += 1;
      continue;
    }
    if (char === "/" && text[i + 1] === "/") {
      i += 2;
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (char === "/" && text[i + 1] === "*") {
      i += 2;
      while (i + 1 < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    break;
  }
  return i;
}

/** `text[index]` is `"`; return the index just past the closing quote. */
function skipString(text: string, index: number): number {
  let i = index + 1;
  while (i < text.length) {
    const char = text[i];
    if (char === "\\") {
      i += 2;
      continue;
    }
    if (char === '"') {
      return i + 1;
    }
    i += 1;
  }
  throw new SettingsEditConflict("unterminated string");
}

function skipContainer(text: string, index: number, open: string, close: string): number {
  let depth = 0;
  let i = index;
  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      i = skipString(text, i);
      continue;
    }
    if (char === "/" && text[i + 1] === "/") {
      i += 2;
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (char === "/" && text[i + 1] === "*") {
      i += 2;
      while (i + 1 < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  throw new SettingsEditConflict("unterminated container");
}

/** Return the index just past the value beginning at `index` (after trivia). */
function skipValue(text: string, index: number): number {
  const char = text[index];
  if (char === '"') return skipString(text, index);
  if (char === "{") return skipContainer(text, index, "{", "}");
  if (char === "[") return skipContainer(text, index, "[", "]");

  let i = index;
  while (i < text.length) {
    const current = text[i];
    if (current === undefined) break;
    if (current === "," || current === "}" || current === "]" || isWhitespace(current)) break;
    if (current === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) break;
    i += 1;
  }
  if (i === index) {
    throw new SettingsEditConflict("empty value");
  }
  return i;
}

function parseObject(text: string, open: number): JsoncObject {
  const members: JsoncMember[] = [];
  let i = open + 1;
  for (;;) {
    i = skipTrivia(text, i);
    const char = text[i];
    if (char === undefined) throw new SettingsEditConflict("unterminated object");
    if (char === "}") return { open, close: i, members };
    if (char === ",") {
      i += 1;
      continue;
    }
    if (char !== '"') throw new SettingsEditConflict("unexpected token in object");

    const keyStart = i;
    const keyEnd = skipString(text, i);
    const key = JSON.parse(text.slice(keyStart, keyEnd)) as string;

    i = skipTrivia(text, keyEnd);
    if (text[i] !== ":") throw new SettingsEditConflict("missing colon");

    i = skipTrivia(text, i + 1);
    const valueStart = i;
    const valueEnd = skipValue(text, i);
    members.push({ key, keyStart, valueStart, valueEnd });
    i = valueEnd;
  }
}

function findRootObject(text: string): JsoncObject {
  const start = skipTrivia(text, 0);
  if (text[start] !== "{") {
    throw new SettingsEditConflict("settings root is not an object");
  }
  return parseObject(text, start);
}

function indentForObject(text: string, obj: JsoncObject): string {
  const first = obj.members[0];
  if (first) {
    const lineStart = text.lastIndexOf("\n", first.keyStart) + 1;
    const leading = text.slice(lineStart, first.keyStart);
    if (/^\s*$/.test(leading)) return leading;
  }
  const closeLineStart = text.lastIndexOf("\n", obj.close) + 1;
  const closeLeading = text.slice(closeLineStart, obj.close);
  return (/^\s*$/.test(closeLeading) ? closeLeading : "") + "  ";
}

function serializeValue(value: unknown, indent: string): string {
  return JSON.stringify(value, null, 2).replace(/\n/g, `\n${indent}`);
}

function setMember(text: string, obj: JsoncObject, key: string, value: unknown): string {
  const indent = indentForObject(text, obj);
  const serialized = serializeValue(value, indent);

  const existing = obj.members.find((member) => member.key === key);
  if (existing) {
    return text.slice(0, existing.valueStart) + serialized + text.slice(existing.valueEnd);
  }

  const memberText = `${JSON.stringify(key)}: ${serialized}`;
  if (obj.members.length === 0) {
    return `${text.slice(0, obj.open + 1)}\n${indent}${memberText}\n${text.slice(obj.open + 1)}`;
  }

  // Insert a leading comma + member immediately after the last value, before
  // any trailing comment or comma — keeps both valid and preserved.
  const last = obj.members[obj.members.length - 1];
  if (!last) {
    throw new SettingsEditConflict("object has no last member");
  }
  return `${text.slice(0, last.valueEnd)},\n${indent}${memberText}${text.slice(last.valueEnd)}`;
}

function deleteMember(text: string, obj: JsoncObject, key: string): string {
  const target = obj.members.find((member) => member.key === key);
  if (!target) {
    return text;
  }

  let delStart = target.keyStart;
  let delEnd = target.valueEnd;

  const afterIndex = skipTrivia(text, delEnd);
  if (text[afterIndex] === ",") {
    delEnd = afterIndex + 1;
  } else {
    let p = delStart - 1;
    while (p >= 0 && isWhitespace(text[p])) p -= 1;
    if (text[p] === ",") delStart = p;
  }

  const lineStart = text.lastIndexOf("\n", target.keyStart) + 1;
  if (/^\s*$/.test(text.slice(lineStart, target.keyStart))) {
    delStart = Math.min(delStart, lineStart - 1 < 0 ? 0 : lineStart);
  }

  return text.slice(0, delStart) + text.slice(delEnd);
}

function setJsoncPath(text: string, path: readonly string[], value: unknown): string {
  if (path.length === 1) {
    const root = findRootObject(text);
    return setMember(text, root, path[0] as string, value);
  }

  if (path.length === 2) {
    const parentKey = path[0] as string;
    const childKey = path[1] as string;
    const root = findRootObject(text);
    const parent = root.members.find((member) => member.key === parentKey);

    if (parent && text[parent.valueStart] === "{") {
      const parentObject = parseObject(text, parent.valueStart);
      return setMember(text, parentObject, childKey, value);
    }
    if (!parent) {
      return setMember(text, root, parentKey, { [childKey]: value });
    }
    throw new SettingsEditConflict(`cannot set ${childKey}: ${parentKey} is not an object`);
  }

  throw new SettingsEditConflict("unsupported mutation depth");
}

function deleteJsoncPath(text: string, path: readonly string[]): string {
  if (path.length === 1) {
    const root = findRootObject(text);
    return deleteMember(text, root, path[0] as string);
  }

  if (path.length === 2) {
    const root = findRootObject(text);
    const parent = root.members.find((member) => member.key === path[0]);
    if (!parent) {
      return text;
    }
    if (text[parent.valueStart] !== "{") {
      throw new SettingsEditConflict("parent is not an object");
    }
    const parentObject = parseObject(text, parent.valueStart);
    return deleteMember(text, parentObject, path[1] as string);
  }

  throw new SettingsEditConflict("unsupported mutation depth");
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
