// Build the public-safe, offline, fully anonymized harness used by BOTH VHS
// demo tapes (docs/demo-statusline.tape and docs/demo-cli.tape). Centralizing
// the plumbing here keeps the tapes readable and keeps fragile shell quoting
// out of the `Type` lines.
//
// Given a repo root and an anonymized demo root under /tmp, this writes:
//   <demo>/cli.js                     copy of the built dist/cli.js, so the path
//                                      runInstall records (statusLineCommand()
//                                      derives from import.meta.url) is the
//                                      anonymized /tmp path, never the repo path.
//   <demo>/bin/copilotline            shim -> `node <demo>/cli.js "$@"`; for the
//                                      `install` subcommand it appends
//                                      --no-account so install never blocks on
//                                      the interactive account wizard (VHS is a
//                                      real TTY).
//   <demo>/bin/gh                      stub that exits 1, so accountFromGitHubCli
//                                      returns null: no host GitHub account can
//                                      leak and there is no slow `gh` spawn.
//   <demo>/bin/copilot                 stub from docs/fixtures/copilot-shim.sh
//                                      that prints a fixed version banner, so
//                                      doctor's copilot line is deterministic
//                                      with no host version leaking into the GIF.
//   <demo>/copilot/config.json        fabricated lastLoggedInUser = octocat, so
//                                      account detection resolves the public-safe
//                                      demo login with no PII.
//   <demo>/cache/github.com-octocat.usage-cache.json
//                                      offline credits snapshot (fresh fetchedAt,
//                                      within TTL) keyed to octocat, mirroring
//                                      docs/fixtures/usage-cache.json. Fabricated
//                                      values only; no network, no token.
//   <demo>/payload.json               public-safe Copilot status payload:
//                                      gpt-5.5 / xhigh, ~47% context, cwd in the
//                                      throwaway repo, started_at ~2h27m ago.
//
// Usage: node docs/fixtures/seed-demo-harness.mjs <repoRoot> <demoRoot>

import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [, , repoRoot, demoRoot] = process.argv;
if (!repoRoot || !demoRoot) {
  console.error("usage: seed-demo-harness.mjs <repoRoot> <demoRoot>");
  process.exit(2);
}

for (const dir of ["bin", "copilot", "cache", join("work", "copilotline")]) {
  mkdirSync(join(demoRoot, dir), { recursive: true });
}

// Anonymized copy of the built bundle.
copyFileSync(join(repoRoot, "dist", "cli.js"), join(demoRoot, "cli.js"));

// copilotline shim: install runs non-interactively via --no-account.
const shim =
  "#!/bin/sh\n" +
  'case "$1" in\n' +
  `  install) shift; exec node "${demoRoot}/cli.js" install --no-account "$@" ;;\n` +
  `  *) exec node "${demoRoot}/cli.js" "$@" ;;\n` +
  "esac\n";
writeFileSync(join(demoRoot, "bin", "copilotline"), shim, { mode: 0o755 });
chmodSync(join(demoRoot, "bin", "copilotline"), 0o755);

// gh stub: fail fast so no host GitHub account leaks into the demo.
writeFileSync(join(demoRoot, "bin", "gh"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
chmodSync(join(demoRoot, "bin", "gh"), 0o755);

// copilot stub: a fixed, public-safe version banner so `copilotline doctor`
// reports a deterministic "copilot command available" line with no dependency
// on a real Copilot install (and no host version leaking into the GIF).
copyFileSync(
  join(repoRoot, "docs", "fixtures", "copilot-shim.sh"),
  join(demoRoot, "bin", "copilot"),
);
chmodSync(join(demoRoot, "bin", "copilot"), 0o755);

// Fabricated, public-safe account.
writeFileSync(
  join(demoRoot, "copilot", "config.json"),
  `${JSON.stringify({ lastLoggedInUser: { login: "octocat", host: "github.com" } }, null, 2)}\n`,
);

// Offline credits cache keyed to octocat (fresh, within TTL).
const cache = JSON.parse(
  readFileSync(join(repoRoot, "docs", "fixtures", "usage-cache.json"), "utf8"),
);
cache.fetchedAt = new Date().toISOString();
cache.account = { login: "octocat", host: "github.com", source: "copilot-config" };
cache.quota.login = "octocat";
cache.quota.host = "github.com";
cache.quota.accountSource = "copilot-config";
writeFileSync(
  join(demoRoot, "cache", "github.com-octocat.usage-cache.json"),
  `${JSON.stringify(cache, null, 2)}\n`,
);

// Public-safe status payload.
const startedAt = new Date(Date.now() - 147 * 60 * 1000).toISOString();
const payload = {
  model: { display_name: "gpt-5.5", reasoning: { effort: "xhigh" } },
  context_window: { current_context_used_percentage: 47 },
  cwd: join(demoRoot, "work", "copilotline"),
  session: { started_at: startedAt },
};
writeFileSync(join(demoRoot, "payload.json"), `${JSON.stringify(payload)}\n`);
