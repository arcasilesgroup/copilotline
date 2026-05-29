import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, join } from "node:path";

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

  return {
    ...parseGitStatus(statusOutput),
    worktree: detectWorktree(cwd),
  };
}

// Detect a linked worktree without a second git spawn. A linked worktree's
// `.git` is a file ("gitdir: <path>") pointing under `.git/worktrees/`, while
// a main working tree's `.git` is a directory and a submodule's points under
// `.git/modules/`. Best-effort under the single-spawn constraint.
function detectWorktree(cwd: string): boolean {
  let dir = cwd;
  for (;;) {
    const dotGit = join(dir, ".git");
    let stats;
    try {
      stats = statSync(dotGit);
    } catch {
      const parent = dirname(dir);
      if (parent === dir) {
        return false;
      }
      dir = parent;
      continue;
    }

    if (!stats.isFile()) {
      return false;
    }

    try {
      const match = readFileSync(dotGit, "utf-8").trim().match(/^gitdir:\s*(.+)$/);
      return match?.[1] ? isWorktreeGitDir(match[1]) : false;
    } catch {
      return false;
    }
  }
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
