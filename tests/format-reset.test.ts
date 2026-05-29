import { afterEach, describe, expect, test } from "bun:test";
import { formatReset } from "../src/application/render-status-line.js";

const stripAnsi = (value: string): string => value.replace(/\x1b\[[0-9;]*m/g, "");

describe("formatReset", () => {
  const originalTz = process.env["TZ"];

  afterEach(() => {
    if (originalTz === undefined) delete process.env["TZ"];
    else process.env["TZ"] = originalTz;
  });

  test("renders the reset instant in UTC, independent of the local timezone", () => {
    // 14:30 UTC — must render as 14:30 UTC regardless of TZ.
    const iso = "2026-06-03T14:30:00Z";

    process.env["TZ"] = "America/Los_Angeles";
    const west = stripAnsi(formatReset(iso) ?? "");
    process.env["TZ"] = "Asia/Tokyo";
    const east = stripAnsi(formatReset(iso) ?? "");

    expect(west).toBe(east);
    expect(west).toContain("Jun 3 14:30");
    expect(west).toContain("UTC");
  });
});
