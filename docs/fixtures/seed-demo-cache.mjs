// Seed a public-safe, offline copilotline usage cache + status payload for the
// VHS statusline demo.
//
// - Copies docs/fixtures/usage-cache.json into <cacheDir>/usage-cache.json and
//   stamps `fetchedAt` to now so the render path reads it as a fresh, within-TTL
//   entry (no network, no token, no real account).
// - Writes <demoRoot>/payload.json: a public-safe Copilot status payload whose
//   cwd points at <demoRoot>/work/copilotline and whose session started ~2h27m
//   ago, so the ribbon renders the model, context, directory/branch, timer, and
//   credits segments deterministically.
//
// Usage: node docs/fixtures/seed-demo-cache.mjs <repoRoot> <demoRoot>

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [, , repoRoot, demoRoot] = process.argv;
if (!repoRoot || !demoRoot) {
  console.error("usage: seed-demo-cache.mjs <repoRoot> <demoRoot>");
  process.exit(2);
}

const cacheDir = join(demoRoot, "cache");
const fixture = JSON.parse(
  readFileSync(join(repoRoot, "docs", "fixtures", "usage-cache.json"), "utf8"),
);
fixture.fetchedAt = new Date().toISOString();

mkdirSync(cacheDir, { recursive: true });
writeFileSync(
  join(cacheDir, "usage-cache.json"),
  `${JSON.stringify(fixture, null, 2)}\n`,
);

const startedAt = new Date(Date.now() - 147 * 60 * 1000).toISOString();
const payload = {
  model: { display_name: "gpt-5.5", reasoning: { effort: "xhigh" } },
  context_window: { current_context_used_percentage: 47 },
  cwd: join(demoRoot, "work", "copilotline"),
  session: { started_at: startedAt },
};
writeFileSync(join(demoRoot, "payload.json"), `${JSON.stringify(payload)}\n`);
