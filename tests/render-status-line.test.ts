import { describe, expect, test } from "bun:test";
import {
  buildStatusSnapshot,
  renderStatusLine,
} from "../src/application/render-status-line.js";

const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, "");
const fixedNow = () => new Date("2026-05-07T15:00:00Z").getTime();
const deps = {
  now: fixedNow,
  getGitInfo: () => ({ branch: "main", dirty: true, worktree: false }),
};

describe("renderStatusLine", () => {
  test("renders the main segments from a likely Copilot payload shape", () => {
    const line = renderStatusLine(
      {
        model: { displayName: "GPT-5.4" },
        cwd: "/Users/me/repos/copilotline",
        contextWindow: { usedPercent: 42 },
        session: { startedAt: "2026-05-07T14:00:00Z" },
        agent: { name: "research" },
        effort: { level: "high" },
        quota: { label: "premium", usedPercent: 13 },
      },
      deps,
    );

    const plain = stripAnsi(line);
    expect(plain).toContain("GPT-5.4");
    expect(plain).toContain("· high");
    expect(plain).toContain("✍️  42%");
    expect(plain).toContain("copilotline (main*)");
    expect(plain).toContain("⏱ 1h");
    expect(plain).toContain("💸 premium");
    expect(plain).toContain("13%");
    expect(plain).toContain("agent research");
  });

  test("computes context percentage from token counts when needed", () => {
    const line = renderStatusLine(
      {
        model: { id: "gpt-5.4" },
        workspace: { current_dir: "/tmp/example" },
        context_window: { used_tokens: 250, total_tokens: 1000 },
      },
      {
        now: fixedNow,
        getGitInfo: () => ({ branch: null, dirty: false, worktree: false }),
      },
    );

    const plain = stripAnsi(line);
    expect(plain).toContain("gpt-5.4");
    expect(plain).toContain("✍️  25%");
    expect(plain).toContain("example");
  });

  test("uses Copilot statusline display context fields", () => {
    const line = renderStatusLine(
      {
        account: { login: "work-account", host: "github.com" },
        model: { display_name: "GPT-5.5" },
        cwd: "/tmp/copilotline",
        context_window: {
          current_context_used_percentage: 45,
          current_context_tokens: 90_000,
          displayed_context_limit: 200_000,
        },
        cost: { total_duration_ms: 3_900_000 },
      },
      {
        now: fixedNow,
        getGitInfo: () => ({ branch: null, dirty: false, worktree: false }),
      },
    );

    const plain = stripAnsi(line);
    expect(plain).toContain("GPT-5.5");
    expect(plain).toContain("✍️  45%");
    expect(plain).toContain("⏱ 1h5m");
  });

  test("renders Copilot reasoning effort from nested model fields", () => {
    const line = renderStatusLine(
      {
        model: { display_name: "gpt-5.5", reasoning: { effort: "xhigh" } },
      },
      deps,
    );

    expect(stripAnsi(line)).toContain("gpt-5.5 · xhigh");
  });

  test("renders quota counts and reset time", () => {
    const line = renderStatusLine(
      {
        account: { login: "work-account", host: "github.com" },
        model: { display_name: "GPT-5.5" },
        quota: {
          label: "premium",
          percent_remaining: 38,
          entitlement: 1_000,
          remaining: 380,
          reset_date: "2026-06-01T00:00:00Z",
        },
      },
      deps,
    );

    const plain = stripAnsi(line);
    expect(plain).toContain("💸 premium");
    expect(plain).toContain("62% 620/1k");
    expect(plain).not.toContain("left");
    expect(plain).toContain("⟳ Jun 1");
  });

  test("prefers live quota snapshots from the Copilot payload over cached quota", () => {
    const line = renderStatusLine(
      {
        account: { login: "work-account", host: "github.com" },
        model: { display_name: "GPT-5.5" },
        quota_reset_date: "2026-06-01",
        quota_snapshots: {
          premium_interactions: {
            entitlement: 300,
            remaining: 60,
            percent_remaining: 20,
            overage_count: 2,
            overage_permitted: true,
          },
        },
      },
      {
        ...deps,
        quota: {
          label: "premium",
          unit: "request",
          usedPercent: 48,
          remainingPercent: 52,
          entitlement: 300,
          remaining: 156,
          used: 144,
          unlimited: false,
          overageUsed: null,
          overagePermitted: null,
          costUsd: null,
          creditAllowanceSource: null,
          resetAt: "2026-06-01",
          source: "cache",
          login: "work-account",
          host: "github.com",
          accountSource: "cache",
          tokenSource: null,
        },
      },
    );

    const plain = stripAnsi(line);
    expect(plain).toContain("💸 work-account premium");
    expect(plain).toContain("80% 240/300");
    expect(plain).toContain("+2 extra");
    expect(plain).not.toContain("48%");
  });

  test("renders quota from Copilot quota response headers", () => {
    const line = renderStatusLine(
      {
        model: { display_name: "GPT-5.5" },
        headers: {
          "x-quota-snapshot-premium_models":
            "ent=1000&rem=12.5&ov=1.5&ovPerm=true&rst=2026-06-01T00%3A00%3A00Z",
        },
      },
      deps,
    );

    const plain = stripAnsi(line);
    expect(plain).toContain("💸 premium");
    expect(plain).toContain("88%");
    expect(plain).toContain("⟳ Jun 1");
    expect(plain).toContain("+1.5 extra");
  });

  test("colors the quota bar by used percentage", () => {
    const line = renderStatusLine(
      {
        model: { display_name: "GPT-5.5" },
        quota: {
          label: "premium",
          percent_remaining: 5,
          entitlement: 300,
          remaining: 15,
        },
      },
      deps,
    );

    expect(line).toContain("\x1b[38;2;255;85;85m●");
  });

  test("renders linked worktree marker before the branch name", () => {
    const line = renderStatusLine(
      {
        model: { display_name: "GPT-5.5" },
        cwd: "/tmp/copilotline-worktree",
      },
      {
        now: fixedNow,
        getGitInfo: () => ({ branch: "feature", dirty: true, worktree: true }),
      },
    );

    expect(stripAnsi(line)).toContain("copilotline-worktree (⎇:feature*)");
  });

  test("falls back to Copilot when the payload has no usable fields", () => {
    expect(stripAnsi(renderStatusLine({}, deps))).toBe("Copilot");
  });

  test("returns a normalized snapshot with raw top-level keys", () => {
    const snapshot = buildStatusSnapshot(
      {
        session: { id: "abc", start_time: "2026-05-07T14:30:00Z" },
        cwd: "/tmp/demo",
      },
      {
        now: fixedNow,
        getGitInfo: () => ({ branch: null, dirty: false, worktree: false }),
      },
    );

    expect(snapshot.session.id).toBe("abc");
    expect(snapshot.session.elapsedSeconds).toBe(1800);
    expect(snapshot.rawKeys).toEqual(["cwd", "session"]);
  });
});

describe("renderStatusLine token/credit billing (spec-002)", () => {
  test("renders a credits noun and allowance bar for a credit-billed account", () => {
    const line = renderStatusLine(
      {
        cwd: "/x",
        quota: { unit: "credit", entitlement: 1500, remaining: 1395 },
      },
      deps,
    );
    const plain = stripAnsi(line);
    expect(plain).toContain("💸 credits");
    expect(plain).not.toContain("premium");
    expect(plain).toContain("7%");
    expect(plain).toContain("105/1.5k");
  });

  test("renders a used-only clause when no allowance is reported (D-002-12)", () => {
    const line = renderStatusLine(
      { cwd: "/x", quota: { unit: "credit", used: 420 } },
      deps,
    );
    const plain = stripAnsi(line);
    expect(plain).toContain("💸 credits");
    expect(plain).toContain("420 used");
    // no bar, no percent, no fabricated denominator
    expect(plain).not.toContain("%");
    expect(plain).not.toContain("/");
  });

  test("renders a tokens noun with compact magnitudes", () => {
    const line = renderStatusLine(
      {
        cwd: "/x",
        quota: { unit: "token", entitlement: 5_000_000, used: 1_200_000 },
      },
      deps,
    );
    const plain = stripAnsi(line);
    expect(plain).toContain("💸 tokens");
    expect(plain).toContain("1.2m/5m");
  });

  test("omits the quota segment entirely when there is no usable datum", () => {
    const line = renderStatusLine({ cwd: "/x", quota: {} }, deps);
    expect(stripAnsi(line)).not.toContain("💸");
  });
});

describe("renderStatusLine usage units/cost config (spec-002 P4)", () => {
  test("usage.units=usd shows GitHub-reported cost as the primary value", () => {
    const line = renderStatusLine(
      {
        cwd: "/x",
        quota: {
          unit: "credit",
          entitlement: 1500,
          remaining: 1395,
          cost_usd: 1.05,
        },
      },
      { ...deps, usage: { units: "usd", showCost: false } },
    );
    const plain = stripAnsi(line);
    expect(plain).toContain("💸 credits");
    expect(plain).toContain("$1.05");
    expect(plain).not.toContain("105/1.5k");
  });

  test("usage.showCost appends a secondary cost clause alongside the count", () => {
    const line = renderStatusLine(
      {
        cwd: "/x",
        quota: {
          unit: "credit",
          entitlement: 1500,
          remaining: 1395,
          cost_usd: 1.05,
        },
      },
      { ...deps, usage: { units: "credit", showCost: true } },
    );
    const plain = stripAnsi(line);
    expect(plain).toContain("105/1.5k");
    expect(plain).toContain("≈ $1.05");
  });

  test("usage.units=usd falls back to native counts when no cost is reported", () => {
    const line = renderStatusLine(
      {
        cwd: "/x",
        quota: { unit: "credit", entitlement: 1500, remaining: 1395 },
      },
      { ...deps, usage: { units: "usd", showCost: false } },
    );
    const plain = stripAnsi(line);
    expect(plain).toContain("105/1.5k");
    expect(plain).not.toContain("$");
  });
});
