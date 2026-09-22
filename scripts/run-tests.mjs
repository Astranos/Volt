import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const scopes = {
  all: ["apps/", "packages/", "convex/", "scripts/"],
  extension: ["packages/extension/"],
  web: ["apps/web/", "scripts/pwa.test.mjs"],
  kiosk: ["apps/kiosk/"],
  convex: ["convex/"],
  mobile: ["apps/mobile/"],
};

// Each test belongs to one runner. New directories need no script changes.
export function testPlan(files, scope = "all") {
  const prefixes = scopes[scope];
  if (!prefixes) throw new Error(`Unknown test scope: ${scope}`);
  const selected = [...new Set(files)].filter((file) =>
    prefixes.some((prefix) => file.startsWith(prefix)) && /\.(test|spec)\.[cm]?[jt]sx?$/.test(file),
  ).sort();
  const node = [];
  const vitest = [];
  for (const file of selected) {
    if (file.endsWith(".mjs")) node.push(file);
    else if (/\.[jt]sx?$/.test(file)) vitest.push(file);
    else throw new Error(`No test runner configured for ${file}`);
  }
  return { node, vitest };
}

function main() {
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root, encoding: "utf8",
  }).split("\0").filter((file) => file && existsSync(resolve(root, file)));
  const plan = testPlan(files, process.argv[2] ?? "all");
  if (plan.node.length + plan.vitest.length === 0) throw new Error("No tests found");
  if (process.argv.includes("--list")) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  let failed = false;
  for (const [runner, tests] of Object.entries(plan)) {
    if (!tests.length) continue;
    console.log(`Running ${tests.length} ${runner} test files`);
    const command = runner === "node" ? process.execPath : "pnpm";
    const args = runner === "node"
      ? ["--experimental-strip-types", "--test", ...tests]
      : ["exec", "vitest", "run", "--config", "vitest.config.mjs", ...tests];
    const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) failed = true;
  }
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
