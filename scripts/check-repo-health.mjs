import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";

const generatedOutputChecks = [
  {
    name: "iOS generated build output",
    pattern: /(^|\/)(build-device-liquid|DerivedData|\.xcresult|\.xcarchive)(\/|$)/,
  },
  {
    name: "web and extension generated output",
    pattern: /(^|\/)(node_modules|dist|\.output|\.wxt)(\/|$)/,
  },
];

const sourceExtensions = new Set([
  ".cjs",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".mjs",
  ".swift",
  ".ts",
  ".tsx",
]);

const sourceRootsPattern = /^(apps|convex|packages)\//;
const maxSourceLines = 1000;
const oversizedSourceBaseline = new Map([
  ["packages/extension/entrypoints/context-menu.tsx", 1070],
  ["packages/extension/src/components/cmdk-palette/CMDKPalette.tsx", 1092],
]);

const workingTreeFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  {
    encoding: "utf8",
  },
)
  .split("\n")
  .filter(Boolean)
  .sort();

const trackedFiles = execFileSync("git", ["ls-files"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

let failed = false;

function reportFailures(name, matches) {
  if (matches.length === 0) {
    console.log(`ok - ${name}`);
    return;
  }

  failed = true;
  console.error(`error - ${name}:`);
  for (const match of matches.slice(0, 25)) {
    console.error(`  ${match}`);
  }
  if (matches.length > 25) {
    console.error(`  ... and ${matches.length - 25} more`);
  }
}

function countLines(content) {
  if (content.length === 0) {
    return 0;
  }

  const lines = content.split("\n");
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

for (const check of generatedOutputChecks) {
  const matches = trackedFiles.filter((file) => check.pattern.test(file));
  reportFailures(`tracked ${check.name}`, matches);
}

const sourceFiles = workingTreeFiles.filter((file) => {
  return (
    sourceRootsPattern.test(file) &&
    sourceExtensions.has(extname(file)) &&
    existsSync(file)
  );
});

const oversizedFiles = [];
for (const file of sourceFiles) {
  const lineCount = countLines(readFileSync(file, "utf8"));
  const baseline = oversizedSourceBaseline.get(file);

  if (baseline !== undefined) {
    if (lineCount > baseline) {
      oversizedFiles.push(`${file} (${lineCount} lines, baseline ${baseline})`);
    }
  } else if (lineCount > maxSourceLines) {
    oversizedFiles.push(`${file} (${lineCount} lines)`);
  }
}
reportFailures(
  `source files over ${maxSourceLines} lines outside the accepted baseline`,
  oversizedFiles,
);

const scannerProtocolBoundaryViolations = [];
for (const file of sourceFiles) {
  if (file.startsWith("packages/scanner-protocol/")) {
    continue;
  }

  const content = readFileSync(file, "utf8");
  if (content.includes("scanner-protocol/src")) {
    scannerProtocolBoundaryViolations.push(file);
  }
}
reportFailures(
  "scanner protocol source imports outside the package boundary",
  scannerProtocolBoundaryViolations,
);

const sourceTextTestPattern =
  /readFileSync|source-contract anchors|backgroundSource|assert\.match\(.*Source/;
const sourceTextTestViolations = sourceFiles.filter((file) => {
  return (
    file.startsWith("packages/extension/src/domain/") &&
    file.includes(".test.") &&
    sourceTextTestPattern.test(readFileSync(file, "utf8"))
  );
});
reportFailures(
  "extension domain tests that assert production source text",
  sourceTextTestViolations,
);

if (failed) {
  process.exitCode = 1;
}
