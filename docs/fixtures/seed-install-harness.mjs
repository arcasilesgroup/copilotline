// Build the public-safe, offline, fully anonymized harness for the install-
// wizard demo (docs/demo-install.tape). Parallels seed-demo-harness.mjs, but
// seeds THREE fabricated Copilot accounts so `copilotline install` shows the
// real first-run "Choose quota account" picker with multiple options.
//
// Given a repo root and an anonymized demo root under /tmp, this writes:
//   <demo>/cli.js                     copy of the built dist/cli.js, so the path
//                                      runInstall records (statusLineCommand()
//                                      derives from import.meta.url) is the
//                                      anonymized /tmp path, never the repo path.
//   <demo>/bin/copilotline            shim -> `node --import <repo>/docs/fixtures/
//                                      github-user-mock.mjs <demo>/cli.js "$@"`.
//                                      It does NOT append --no-account, so the
//                                      `install` subcommand shows the interactive
//                                      account picker under VHS's real TTY. The
//                                      --import preload makes the fabricated
//                                      per-login tokens verify offline so the
//                                      picker shows "token ok".
//   <demo>/bin/gh                      stub that exits 1, so accountFromGitHubCli
//                                      returns null: no host GitHub account can
//                                      leak and there is no slow `gh` spawn.
//   <demo>/copilot/config.json        fabricated lastLoggedInUser = octocat, so
//                                      account detection resolves octocat from
//                                      the Copilot CLI config (the system/auto
//                                      account) with no PII.
//   <demo>/vscode/state.vscdb         a VS Code globalStorage SQLite DB with
//                                      __GitHub.copilot-chat-monalisa and
//                                      __GitHub.copilot-chat-hubot rows, so the
//                                      VS Code detector yields two more
//                                      fabricated accounts.
//   <demo>/config/                    COPILOTLINE_CONFIG_DIR target so the
//                                      picker's writes land in the isolated root.
//
// The matching per-login tokens (COPILOTLINE_GITHUB_TOKEN_{OCTOCAT,MONALISA,
// HUBOT} = demo-<login>) are exported by seed-install-shell.sh; combined with
// the --import mock they make every account show "token ok" offline.
//
// Usage: node docs/fixtures/seed-install-harness.mjs <repoRoot> <demoRoot>

import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const [, , repoRoot, demoRoot] = process.argv;
if (!repoRoot || !demoRoot) {
  console.error("usage: seed-install-harness.mjs <repoRoot> <demoRoot>");
  process.exit(2);
}

for (const dir of ["bin", "copilot", "vscode", "config", "work"]) {
  mkdirSync(join(demoRoot, dir), { recursive: true });
}

// Anonymized copy of the built bundle.
copyFileSync(join(repoRoot, "dist", "cli.js"), join(demoRoot, "cli.js"));

// copilotline shim: every invocation runs the bundle under the offline /user
// mock so fabricated tokens verify as "token ok". `install` is NOT given
// --no-account, so it shows the interactive picker under VHS's TTY.
const mockPath = join(repoRoot, "docs", "fixtures", "github-user-mock.mjs");
const shim =
  "#!/bin/sh\n" +
  `exec node --import "${mockPath}" "${demoRoot}/cli.js" "$@"\n`;
writeFileSync(join(demoRoot, "bin", "copilotline"), shim, { mode: 0o755 });
chmodSync(join(demoRoot, "bin", "copilotline"), 0o755);

// gh stub: fail fast so no host GitHub account leaks into the demo.
writeFileSync(join(demoRoot, "bin", "gh"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
chmodSync(join(demoRoot, "bin", "gh"), 0o755);

// Fabricated, public-safe Copilot CLI account -> octocat (system/auto).
writeFileSync(
  join(demoRoot, "copilot", "config.json"),
  `${JSON.stringify({ lastLoggedInUser: { login: "octocat", host: "github.com" } }, null, 2)}\n`,
);

// Fabricated VS Code globalStorage state DB with two more accounts. The CLI
// reads rows whose key matches `__GitHub.copilot-chat-<login>` (the login is
// taken straight from the key), so the row values can be empty objects.
const stateDb = join(demoRoot, "vscode", "state.vscdb");
const sql =
  "CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value BLOB);" +
  "INSERT INTO ItemTable (key, value) VALUES ('__GitHub.copilot-chat-monalisa', '{}');" +
  "INSERT INTO ItemTable (key, value) VALUES ('__GitHub.copilot-chat-hubot', '{}');";
const result = spawnSync("sqlite3", [stateDb, sql], { encoding: "utf-8" });
if (result.error || result.status !== 0) {
  console.error(
    `seed-install-harness: sqlite3 failed: ${result.error?.message ?? result.stderr}`,
  );
  process.exit(1);
}
