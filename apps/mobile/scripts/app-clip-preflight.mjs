import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const outputDir = path.join(repoRoot, "apps/mobile/.tmp");
const reportPath = path.join(outputDir, "app-clip-preflight.json");
const deviceValidationSessionsPath = path.join(
  repoRoot,
  "apps/scanner-signal/.tmp/app-clip-device-validation-sessions.json"
);
const deviceEvidenceManifestFilename = "app-clip-device-evidence-manifest.json";
const defaultDerivedDataDir = path.join(
  process.env.HOME ?? "",
  "Library/Developer/Xcode/DerivedData"
);
export const conservativeQrInvocationBudgetBytes = 15 * 1024 * 1024;

export function parsePreflightOptions(argv = process.argv.slice(2)) {
  const normalizedArgs = argv.filter((arg) => arg !== "--");
  const args = new Set(normalizedArgs);
  const evidenceManifestIndex = normalizedArgs.indexOf("--evidence-manifest");
  const evidenceManifestValue =
    evidenceManifestIndex >= 0 ? normalizedArgs[evidenceManifestIndex + 1] ?? null : null;

  if (
    evidenceManifestIndex >= 0 &&
    (typeof evidenceManifestValue !== "string" ||
      evidenceManifestValue.trim() === "" ||
      evidenceManifestValue.startsWith("--"))
  ) {
    throw new Error("App Clip preflight --evidence-manifest requires a manifest path.");
  }

  return {
    includeDeviceSheet: args.has("--device-sheet"),
    includeProduction: args.has("--production"),
    includeXcode: args.has("--xcode"),
    evidenceManifestPath: evidenceManifestValue,
  };
}

export function buildPreflightChecks({
  includeDeviceSheet = false,
  includeProduction = false,
  includeXcode = false,
  evidenceManifestPath = null,
} = {}) {
  const checks = [
    ["pnpm", ["--filter", "@volt/mobile", "test:clip"]],
    ["pnpm", ["--filter", "@volt/mobile", "typecheck"]],
    ["pnpm", ["--filter", "@volt/scanner-signal", "test:clip"]],
    [
      "pnpm",
      [
        "--filter",
        "@volt/scanner-signal",
        "exec",
        "tsc",
        "--noEmit",
        "--moduleResolution",
        "node",
        "--module",
        "esnext",
        "--target",
        "es2022",
        "api/clip.ts",
        "api/signal.ts",
        "api/apple-app-site-association.ts",
      ],
    ],
    ["pnpm", ["--filter", "@volt/extension", "test:scanner"]],
    ["pnpm", ["--filter", "@volt/extension", "compile"]],
  ];

  if (includeProduction) {
    checks.push(["pnpm", ["--filter", "@volt/scanner-signal", "validate:production"]]);
  }

  if (includeDeviceSheet && !evidenceManifestPath) {
    checks.push(["pnpm", ["--filter", "@volt/scanner-signal", "create:device-validation-session"]]);
  }

  if (evidenceManifestPath) {
    checks.push([
      "pnpm",
      [
        "--filter",
        "@volt/scanner-signal",
        "validate:device-evidence-manifest",
        "--",
        evidenceManifestPath,
      ],
    ]);
    checks.push([
      "pnpm",
      [
        "--filter",
        "@volt/scanner-signal",
        "generate:device-evidence-completion-record",
        "--",
        evidenceManifestPath,
      ],
    ]);
    checks.push([
      "pnpm",
      [
        "--filter",
        "@volt/mobile",
        "apply:clip-completion-record",
        "--",
        "--check",
        evidenceManifestPath,
      ],
    ]);
  }

  if (includeXcode) {
    checks.push([
      "xcodebuild",
      [
        "-workspace",
        "apps/mobile/ios/Volt.xcworkspace",
        "-scheme",
        "VoltClip",
        "-configuration",
        "Release",
        "-sdk",
        "iphoneos",
        "-destination",
        "generic/platform=iOS",
        "CODE_SIGNING_ALLOWED=NO",
        "build",
      ],
    ]);
  }

  return checks;
}

export function run(command, args, options = {}) {
  const label = [command, ...args].join(" ");
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
      ...options,
    });

    child.on("error", reject);
    child.on("close", (code) => {
      const durationMs = Date.now() - startedAt;
      if (code === 0) {
        resolve({ command: label, durationMs, status: "passed" });
        return;
      }

      const error = new Error(`${label} failed with exit code ${code}`);
      error.result = { command: label, durationMs, status: "failed", code };
      reject(error);
    });
  });
}

export async function fileSize(pathname) {
  return (await stat(pathname)).size;
}

export async function pathExists(pathname) {
  try {
    await stat(pathname);
    return true;
  } catch {
    return false;
  }
}

export async function directorySize(pathname) {
  const entries = await readdir(pathname, { withFileTypes: true });
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(pathname, entry.name);
      if (entry.isDirectory()) return directorySize(entryPath);
      if (entry.isFile() || entry.isSymbolicLink()) return fileSize(entryPath);
      return 0;
    })
  );

  return sizes.reduce((total, size) => total + size, 0);
}

export async function latestAppClipBuildPath(derivedDataDir = defaultDerivedDataDir) {
  if (!derivedDataDir) return null;

  let projects;
  try {
    projects = await readdir(derivedDataDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = [];
  for (const project of projects) {
    if (!project.isDirectory() || !project.name.startsWith("Volt-")) continue;
    const appPath = path.join(
      derivedDataDir,
      project.name,
      "Build/Products/Release-iphoneos/Volt Clip.app"
    );

    try {
      const appStat = await stat(appPath);
      if (appStat.isDirectory()) candidates.push({ appPath, mtimeMs: appStat.mtimeMs });
    } catch {
      // Ignore stale DerivedData projects without a Release App Clip build.
    }
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.appPath ?? null;
}

export async function appSizeSummary({
  appPath = process.env.APP_CLIP_BUILD_APP_PATH,
  detectLatest = false,
  derivedDataDir = defaultDerivedDataDir,
  conservativeBudgetBytes = conservativeQrInvocationBudgetBytes,
} = {}) {
  const resolvedAppPath = appPath ?? (detectLatest ? await latestAppClipBuildPath(derivedDataDir) : null);
  if (!resolvedAppPath) return null;

  const bundlePath = path.join(resolvedAppPath, "main.jsbundle");
  const appBundleBytes = await directorySize(resolvedAppPath);
  return {
    appPath: resolvedAppPath,
    appBundleBytes,
    mainJsBundleBytes: await fileSize(bundlePath),
    conservativeQrInvocationBudgetBytes: conservativeBudgetBytes,
    exceedsConservativeQrInvocationBudget: appBundleBytes > conservativeBudgetBytes,
    isAppleThinnedSizeReport: false,
    note:
      "Local unsigned bundle size is build-health evidence only; App Store Connect app thinning output is required for the production App Clip size gate.",
  };
}

export async function deviceValidationSummary({
  sessionsPath = deviceValidationSessionsPath,
  includeDeviceSheet = false,
} = {}) {
  if (!includeDeviceSheet) return null;

  try {
    const payload = JSON.parse(await readFile(sessionsPath, "utf8"));
    const evidenceManifestPath = path.join(path.dirname(sessionsPath), deviceEvidenceManifestFilename);
    return {
      path: sessionsPath,
      evidenceManifestPath,
      evidenceManifestExists: await pathExists(evidenceManifestPath),
      origin: payload.origin,
      createdAt: payload.createdAt,
      expiresAt: payload.expiresAt,
      sessionTtlMinutes: payload.sessionTtlMinutes,
      modes: Array.isArray(payload.sessions) ? payload.sessions.map((session) => session.mode) : [],
      sessionCount: Array.isArray(payload.sessions) ? payload.sessions.length : 0,
      launchMatrixRows: Array.isArray(payload.launchMatrix) ? payload.launchMatrix.length : 0,
      captureMatrixRows: Array.isArray(payload.captureMatrix) ? payload.captureMatrix.length : 0,
      evidenceCount: Array.isArray(payload.evidenceChecklist) ? payload.evidenceChecklist.length : 0,
      completionGateCount: Array.isArray(payload.completionGateChecklist)
        ? payload.completionGateChecklist.length
        : 0,
      completionGates: Array.isArray(payload.completionGateChecklist)
        ? payload.completionGateChecklist.map((gate) => gate.gate).filter((gate) => typeof gate === "string")
        : [],
      hasCompletionEvidenceManifestTemplate:
        typeof payload.completionEvidenceManifestTemplate === "object" &&
        payload.completionEvidenceManifestTemplate !== null,
      hasCompletionRecordTemplate:
        typeof payload.completionRecordTemplate === "object" && payload.completionRecordTemplate !== null,
    };
  } catch {
    return null;
  }
}

export function completionReadinessSummary({
  includeProduction = false,
  includeDeviceSheet = false,
  evidenceManifestPath = null,
  results = [],
  deviceSummary = null,
  appSize = null,
} = {}) {
  const evidenceManifestCommand = results.find((result) =>
    result.command.includes("validate:device-evidence-manifest")
  );
  const completionRecordCommand = results.find((result) =>
    result.command.includes("generate:device-evidence-completion-record")
  );
  const planCompletionRecordCommand = results.find((result) =>
    result.command.includes("apply:clip-completion-record")
  );
  const deviceSheetCommand = results.find((result) =>
    result.command.includes("create:device-validation-session")
  );
  const productionValidationCommand = results.find((result) =>
    result.command.includes("validate:production")
  );
  const hasCompletedEvidenceManifest = evidenceManifestCommand?.status === "passed";
  const hasGeneratedCompletionRecord = completionRecordCommand?.status === "passed";
  const hasCheckedPlanCompletionRecord = planCompletionRecordCommand?.status === "passed";
  const hasGeneratedDeviceSheet = deviceSheetCommand?.status === "passed";
  const hasPassedProductionValidation = productionValidationCommand?.status === "passed";
  const hasDeviceValidationSheet = includeDeviceSheet && deviceSummary !== null;
  const localPreflightPassed = results.every((result) => result.status === "passed");
  const isCompletionReady =
    localPreflightPassed &&
    includeProduction &&
    hasPassedProductionValidation &&
    includeDeviceSheet &&
    hasDeviceValidationSheet &&
    hasCompletedEvidenceManifest &&
    hasGeneratedCompletionRecord &&
    hasCheckedPlanCompletionRecord;

  return {
    localPreflightPassed,
    productionValidationChecked: includeProduction,
    productionValidationPassed: hasPassedProductionValidation,
    deviceValidationSheetAvailable: hasDeviceValidationSheet,
    deviceValidationSheetGenerated: hasGeneratedDeviceSheet,
    generatedEvidenceManifestPath: deviceSummary?.evidenceManifestPath ?? null,
    evidenceManifestPath,
    completedEvidenceManifestValidated: hasCompletedEvidenceManifest,
    completionRecordGenerated: hasGeneratedCompletionRecord,
    completionRecordPlanUpdateChecked: hasCheckedPlanCompletionRecord,
    appleThinnedSizeReportValidated: hasCompletedEvidenceManifest,
    localSizeIsAppleThinnedReport: appSize?.isAppleThinnedSizeReport === true,
    completionStatus: isCompletionReady ? "ready" : "pending-completion-checks",
    pendingExternalGates: hasCompletedEvidenceManifest
      ? []
      : [
          "appStoreConnectAdvancedExperiences",
          "appleThinnedAppClipSize",
          "physicalIphoneLaunch",
          "chromeCaptureInsertion",
        ],
  };
}

export async function runPreflight({
  checks,
  includeDeviceSheet = false,
  includeProduction = false,
  includeXcode = false,
  evidenceManifestPath = null,
  runner = run,
  reportFile = reportPath,
} = {}) {
  const results = [];
  const plannedChecks =
    checks ??
    buildPreflightChecks({
      includeDeviceSheet,
      includeProduction,
      includeXcode,
      evidenceManifestPath,
    });

  await mkdir(outputDir, { recursive: true });
  await rm(reportFile, { force: true });

  try {
    for (const [command, commandArgs] of plannedChecks) {
      results.push(await runner(command, commandArgs));
    }

    const report = {
      createdAt: new Date().toISOString(),
      includeDeviceSheet,
      includeProduction,
      includeXcode,
      evidenceManifestPath,
      results,
      appSizeSummary: await appSizeSummary({ detectLatest: includeXcode }),
      deviceValidationSummary: await deviceValidationSummary({ includeDeviceSheet }),
    };
    report.completionReadinessSummary = completionReadinessSummary({
      includeProduction,
      includeDeviceSheet,
      evidenceManifestPath,
      results,
      deviceSummary: report.deviceValidationSummary,
      appSize: report.appSizeSummary,
    });

    await writeFile(reportFile, JSON.stringify(report, null, 2));
    console.log(`App Clip preflight passed. Report: ${reportFile}`);
    return report;
  } catch (error) {
    if (error.result) results.push(error.result);
    const report = {
      createdAt: new Date().toISOString(),
      includeDeviceSheet,
      includeProduction,
      includeXcode,
      evidenceManifestPath,
      results,
      appSizeSummary: await appSizeSummary({ detectLatest: includeXcode }),
      deviceValidationSummary: await deviceValidationSummary({ includeDeviceSheet }),
    };
    report.completionReadinessSummary = completionReadinessSummary({
      includeProduction,
      includeDeviceSheet,
      evidenceManifestPath,
      results,
      deviceSummary: report.deviceValidationSummary,
      appSize: report.appSizeSummary,
    });
    await writeFile(reportFile, JSON.stringify(report, null, 2));
    error.report = report;
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parsePreflightOptions();
  runPreflight(options).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    console.error(`App Clip preflight failed. Report: ${reportPath}`);
    process.exit(1);
  });
}
