import { execFileSync } from "node:child_process";

const checks = [
  {
    name: "iOS generated build output",
    pattern: /(^|\/)(build-device-liquid|DerivedData|\.xcresult|\.xcarchive)(\/|$)/,
  },
  {
    name: "web and extension generated output",
    pattern: /(^|\/)(node_modules|dist|\.output|\.wxt)(\/|$)/,
  },
];

const trackedFiles = execFileSync("git", ["ls-files"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

let failed = false;

for (const check of checks) {
  const matches = trackedFiles.filter((file) => check.pattern.test(file));

  if (matches.length === 0) {
    console.log(`ok - ${check.name}`);
    continue;
  }

  failed = true;
  console.error(`error - tracked ${check.name}:`);
  for (const file of matches.slice(0, 25)) {
    console.error(`  ${file}`);
  }
  if (matches.length > 25) {
    console.error(`  ... and ${matches.length - 25} more`);
  }
}

if (failed) {
  process.exitCode = 1;
}
