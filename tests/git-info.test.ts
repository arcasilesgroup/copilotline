import { describe, expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { getGitInfo, isWorktreeGitDir, parseGitStatus } from "../src/infrastructure/git-info.js";

describe("git info", () => {
  test("issues a single git spawn per render (worktree detected without git)", () => {
    const spy = spyOn(childProcess, "spawnSync");
    try {
      getGitInfo(process.cwd());
      const gitCalls = spy.mock.calls.filter((call) => call[0] === "git");
      expect(gitCalls.length).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

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
