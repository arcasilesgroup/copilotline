export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as JsonRecord;
}

export function listKeys(value: unknown): string[] {
  const record = asRecord(value);
  return record ? Object.keys(record).sort() : [];
}

export function pickUnknown(
  source: unknown,
  ...paths: readonly (readonly string[])[]
): unknown {
  const record = asRecord(source);
  if (!record) {
    return undefined;
  }

  for (const path of paths) {
    let current: unknown = record;

    for (const segment of path) {
      const currentRecord = asRecord(current);
      if (!currentRecord || !(segment in currentRecord)) {
        current = undefined;
        break;
      }

      current = currentRecord[segment];
    }

    if (current !== undefined && current !== null) {
      return current;
    }
  }

  return undefined;
}

export function pickRecord(
  source: unknown,
  ...paths: readonly (readonly string[])[]
): JsonRecord | undefined {
  return asRecord(pickUnknown(source, ...paths));
}

export function pickString(
  source: unknown,
  ...paths: readonly (readonly string[])[]
): string | undefined {
  const value = pickUnknown(source, ...paths);
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function pickNumber(
  source: unknown,
  ...paths: readonly (readonly string[])[]
): number | undefined {
  const value = pickUnknown(source, ...paths);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
