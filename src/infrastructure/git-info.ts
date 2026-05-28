import { spawnSync } from "node:child_process";
import { basename } from "node:path";

export interface GitInfo {
  branch: string | null;
  dirty: boolean;
  worktree: boolean;
}

export function directoryName(cwd: string | null): string | null {
  if (!cwd) {
    return null;
  }

  const name = basename(cwd);
  return name.trim() === "" ? cwd : name;
}

export function getGitInfo(cwd: string): GitInfo {
  const statusOutput = runGit(cwd, [
    "--no-optional-locks",
    "status",
    "--porcelain",
    "--branch",
  ]);

  if (statusOutput === null) {
    return { branch: null, dirty: false, worktree: false };
  }

  const gitDir = runGit(cwd, ["--no-optional-locks", "rev-parse", "--git-dir"]);

  return {
    ...parseGitStatus(statusOutput),
    worktree: gitDir !== null && isWorktreeGitDir(gitDir),
  };
}

export function parseGitStatus(stdout: string): Pick<GitInfo, "branch" | "dirty"> {
  const lines = stdout.split("\n");
  const head = lines[0] ?? "";
  const dirty = lines.slice(1).some((line) => line.trim() !== "");
  let branch: string | null = null;

  if (head.startsWith("## ")) {
    const rest = head.slice(3);
    if (rest.startsWith("No commits yet on ")) {
      branch = rest.slice("No commits yet on ".length).trim() || null;
    } else if (!rest.startsWith("HEAD ") && rest !== "HEAD") {
      branch = rest.split("...")[0]?.split(" ")[0] ?? null;
    }
  }

  return { branch, dirty };
}

export function isWorktreeGitDir(gitDir: string): boolean {
  return /(^|[\\/])\.git[\\/]worktrees[\\/]/.test(gitDir.trim());
}

function runGit(cwd: string, args: string[]): string | null {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf-8",
    timeout: 1500,
  });

  if (result.status !== 0) {
    return null;
  }

  const output = result.stdout.trim();
  return output === "" ? null : output;
}
