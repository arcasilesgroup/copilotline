import { describe, expect, test } from "bun:test";
import { isWorktreeGitDir, parseGitStatus } from "../src/infrastructure/git-info.js";

describe("git info", () => {
  test("parses branch and dirty state from porcelain branch output", () => {
    expect(parseGitStatus("## trunk...origin/trunk\n M src/file.ts\n")).toEqual({
      branch: "trunk",
      dirty: true,
    });
  });

  test("parses unborn branch output", () => {
    expect(parseGitStatus("## No commits yet on main\n")).toEqual({
      branch: "main",
      dirty: false,
    });
  });

  test("detects linked worktree git directories", () => {
    expect(isWorktreeGitDir(".git/worktrees/feature")).toBe(true);
    expect(isWorktreeGitDir("/repo/.git/worktrees/feature")).toBe(true);
    expect(isWorktreeGitDir(".git")).toBe(false);
    expect(isWorktreeGitDir("/repo/.git")).toBe(false);
  });
});
