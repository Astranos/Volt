import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appSizeSummary,
  buildPreflightChecks,
  completionReadinessSummary,
  conservativeQrInvocationBudgetBytes,
  deviceValidationSummary,
  latestAppClipBuildPath,
  parsePreflightOptions,
  runPreflight,
} from "./app-clip-preflight.mjs";

const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);

test("implementation plan records resolved HTTPS relay transport decision", async () => {
  const plan = await readFile(
    path.join(repoRoot, "apps/mobile/APP_CLIP_IMPLEMENTATION_PLAN.md"),
    "utf8"
  );

  assert.match(plan, /## Resolved Decisions/);
  assert.match(plan, /Resolved: use the HTTPS result relay for App Clip sessions\./);
  assert.doesNotMatch(plan, /Default: try WebRTC/);
  assert.doesNotMatch(plan, /## Open Decisions/);
});

test("implementation plan records mandatory evidence manifest path guard", async () => {
  const plan = await readFile(
    path.join(repoRoot, "apps/mobile/APP_CLIP_IMPLEMENTATION_PLAN.md"),
    "utf8"
  );

  assert.match(plan, /--evidence-manifest` flag is intentionally rejected without an explicit manifest path/);
  assert.match(plan, /cannot accidentally fall back to a device-sheet-only run/);
});

test("parsePreflightOptions accepts pnpm separator and optional gates", () => {
  assert.deepEqual(
    parsePreflightOptions([
      "--",
      "--production",
      "--device-sheet",
      "--evidence-manifest",
      "apps/scanner-signal/.tmp/manifest.json",
    ]),
    {
      includeDeviceSheet: true,
      includeProduction: true,
      includeXcode: false,
      evidenceManifestPath: "apps/scanner-signal/.tmp/manifest.json",
    }
  );
});

test("parsePreflightOptions requires a value for evidence manifest", () => {
  assert.throws(
    () => parsePreflightOptions(["--", "--production", "--device-sheet", "--evidence-manifest"]),
    /--evidence-manifest requires a manifest path/
  );
  assert.throws(
    () =>
      parsePreflightOptions([
        "--",
        "--production",
        "--evidence-manifest",
        "--device-sheet",
      ]),
    /--evidence-manifest requires a manifest path/
  );
});

test("buildPreflightChecks includes optional production, device sheet, and xcode checks", () => {
  const checks = buildPreflightChecks({
    includeDeviceSheet: true,
    includeProduction: true,
    includeXcode: true,
  }).map(([command, args]) => [command, args.join(" ")]);

  assert.ok(
    checks.some(
      ([command, args]) =>
        command === "pnpm" && args.includes("@volt/scanner-signal validate:production")
    )
  );
  assert.ok(
    checks.some(
      ([command, args]) =>
        command === "pnpm" && args.includes("@volt/scanner-signal create:device-validation-session")
    )
  );
  assert.ok(
    checks.some(([command, args]) => command === "xcodebuild" && args.includes("-scheme VoltClip"))
  );
});

test("buildPreflightChecks validates a supplied evidence manifest without regenerating it", () => {
  const checks = buildPreflightChecks({
    includeDeviceSheet: true,
    includeProduction: true,
    evidenceManifestPath: "apps/scanner-signal/.tmp/manifest.json",
  }).map(([command, args]) => [command, args.join(" ")]);

  assert.ok(
    checks.some(
      ([command, args]) =>
        command === "pnpm" && args.includes("@volt/scanner-signal validate:production")
    )
  );
  assert.ok(
    !checks.some(
      ([command, args]) =>
        command === "pnpm" && args.includes("@volt/scanner-signal create:device-validation-session")
    )
  );
  assert.ok(
    checks.some(
      ([command, args]) =>
        command === "pnpm" &&
        args.includes("@volt/scanner-signal validate:device-evidence-manifest") &&
        args.includes("apps/scanner-signal/.tmp/manifest.json")
    )
  );
  assert.ok(
    checks.some(
      ([command, args]) =>
        command === "pnpm" &&
        args.includes("@volt/scanner-signal generate:device-evidence-completion-record") &&
        args.includes("apps/scanner-signal/.tmp/manifest.json")
    )
  );
  assert.ok(
    checks.some(
      ([command, args]) =>
        command === "pnpm" &&
        args.includes("@volt/mobile apply:clip-completion-record") &&
        args.includes("--check") &&
        args.includes("apps/scanner-signal/.tmp/manifest.json")
    )
  );
});

test("runPreflight writes a passing report from injected checks", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "volt-app-clip-preflight-"));
  const reportFile = path.join(tempDir, "report.json");
  const seen = [];

  try {
    const report = await runPreflight({
      checks: [
        ["pnpm", ["--filter", "@volt/mobile", "test:clip"]],
        ["pnpm", ["--filter", "@volt/extension", "compile"]],
      ],
      reportFile,
      runner: async (command, args) => {
        seen.push([command, args]);
        return { command: [command, ...args].join(" "), durationMs: 1, status: "passed" };
      },
    });

    assert.equal(report.results.length, 2);
    assert.deepEqual(
      seen.map(([command, args]) => [command, args.join(" ")]),
      [
        ["pnpm", "--filter @volt/mobile test:clip"],
        ["pnpm", "--filter @volt/extension compile"],
      ]
    );

    const written = JSON.parse(await readFile(reportFile, "utf8"));
    assert.equal(written.results[0].status, "passed");
    assert.equal(written.evidenceManifestPath, null);
    assert.equal(written.appSizeSummary, null);
    assert.equal(written.deviceValidationSummary, null);
    assert.deepEqual(written.completionReadinessSummary, {
      localPreflightPassed: true,
      productionValidationChecked: false,
      productionValidationPassed: false,
      deviceValidationSheetAvailable: false,
      deviceValidationSheetGenerated: false,
      generatedEvidenceManifestPath: null,
      evidenceManifestPath: null,
      completedEvidenceManifestValidated: false,
      completionRecordGenerated: false,
      completionRecordPlanUpdateChecked: false,
      appleThinnedSizeReportValidated: false,
      localSizeIsAppleThinnedReport: false,
      completionStatus: "pending-completion-checks",
      pendingExternalGates: [
        "appStoreConnectAdvancedExperiences",
        "appleThinnedAppClipSize",
        "physicalIphoneLaunch",
        "chromeCaptureInsertion",
      ],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runPreflight writes completion readiness details when a check fails", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "volt-app-clip-preflight-fail-"));
  const reportFile = path.join(tempDir, "report.json");

  try {
    await assert.rejects(
      () =>
        runPreflight({
          checks: [
            ["pnpm", ["--filter", "@volt/mobile", "test:clip"]],
            ["pnpm", ["--filter", "@volt/scanner-signal", "validate:device-evidence-manifest", "--", "manifest.json"]],
          ],
          includeProduction: true,
          includeDeviceSheet: false,
          evidenceManifestPath: "manifest.json",
          reportFile,
          runner: async (command, args) => {
            if (args.includes("validate:device-evidence-manifest")) {
              const error = new Error("manifest failed");
              error.result = {
                command: [command, ...args].join(" "),
                durationMs: 1,
                status: "failed",
                code: 1,
              };
              throw error;
            }

            return { command: [command, ...args].join(" "), durationMs: 1, status: "passed" };
          },
        }),
      /manifest failed/
    );

    const written = JSON.parse(await readFile(reportFile, "utf8"));
    assert.equal(written.results.length, 2);
    assert.equal(written.results[1].status, "failed");
    assert.equal(written.appSizeSummary, null);
    assert.equal(written.deviceValidationSummary, null);
    assert.deepEqual(written.completionReadinessSummary, {
      localPreflightPassed: false,
      productionValidationChecked: true,
      productionValidationPassed: false,
      deviceValidationSheetAvailable: false,
      deviceValidationSheetGenerated: false,
      generatedEvidenceManifestPath: null,
      evidenceManifestPath: "manifest.json",
      completedEvidenceManifestValidated: false,
      completionRecordGenerated: false,
      completionRecordPlanUpdateChecked: false,
      appleThinnedSizeReportValidated: false,
      localSizeIsAppleThinnedReport: false,
      completionStatus: "pending-completion-checks",
      pendingExternalGates: [
        "appStoreConnectAdvancedExperiences",
        "appleThinnedAppClipSize",
        "physicalIphoneLaunch",
        "chromeCaptureInsertion",
      ],
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("completionReadinessSummary reports pending external gates until evidence manifest passes", () => {
  assert.deepEqual(
    completionReadinessSummary({
      includeProduction: true,
      includeDeviceSheet: true,
      evidenceManifestPath: "apps/scanner-signal/.tmp/manifest.json",
      results: [
        { command: "pnpm --filter @volt/mobile test:clip", status: "passed" },
        {
          command: "pnpm --filter @volt/scanner-signal validate:production",
          status: "passed",
        },
        {
          command:
            "pnpm --filter @volt/scanner-signal validate:device-evidence-manifest -- apps/scanner-signal/.tmp/manifest.json",
          status: "failed",
        },
      ],
      deviceSummary: {
        evidenceManifestPath:
          "/repo/apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json",
      },
      appSize: { isAppleThinnedSizeReport: false },
    }),
    {
      localPreflightPassed: false,
      productionValidationChecked: true,
      productionValidationPassed: true,
      deviceValidationSheetAvailable: true,
      deviceValidationSheetGenerated: false,
      generatedEvidenceManifestPath:
        "/repo/apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json",
      evidenceManifestPath: "apps/scanner-signal/.tmp/manifest.json",
      completedEvidenceManifestValidated: false,
      completionRecordGenerated: false,
      completionRecordPlanUpdateChecked: false,
      appleThinnedSizeReportValidated: false,
      localSizeIsAppleThinnedReport: false,
      completionStatus: "pending-completion-checks",
      pendingExternalGates: [
        "appStoreConnectAdvancedExperiences",
        "appleThinnedAppClipSize",
        "physicalIphoneLaunch",
        "chromeCaptureInsertion",
      ],
    }
  );
});

test("completionReadinessSummary requires local checks and external evidence before ready", () => {
  assert.deepEqual(
    completionReadinessSummary({
      includeProduction: true,
      includeDeviceSheet: true,
      evidenceManifestPath: "apps/scanner-signal/.tmp/manifest.json",
      results: [
        { command: "pnpm --filter @volt/mobile test:clip", status: "failed" },
        {
          command:
            "pnpm --filter @volt/scanner-signal validate:device-evidence-manifest -- apps/scanner-signal/.tmp/manifest.json",
          status: "passed",
        },
        {
          command:
            "pnpm --filter @volt/scanner-signal generate:device-evidence-completion-record -- apps/scanner-signal/.tmp/manifest.json",
          status: "passed",
        },
      ],
      deviceSummary: {
        evidenceManifestPath:
          "/repo/apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json",
      },
      appSize: { isAppleThinnedSizeReport: false },
    }),
    {
      localPreflightPassed: false,
      productionValidationChecked: true,
      productionValidationPassed: false,
      deviceValidationSheetAvailable: true,
      deviceValidationSheetGenerated: false,
      generatedEvidenceManifestPath:
        "/repo/apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json",
      evidenceManifestPath: "apps/scanner-signal/.tmp/manifest.json",
      completedEvidenceManifestValidated: true,
      completionRecordGenerated: true,
      completionRecordPlanUpdateChecked: false,
      appleThinnedSizeReportValidated: true,
      localSizeIsAppleThinnedReport: false,
      completionStatus: "pending-completion-checks",
      pendingExternalGates: [],
    }
  );
});

test("completionReadinessSummary requires generated completion record before ready", () => {
  assert.deepEqual(
    completionReadinessSummary({
      includeProduction: true,
      includeDeviceSheet: true,
      evidenceManifestPath: "apps/scanner-signal/.tmp/manifest.json",
      results: [
        { command: "pnpm --filter @volt/mobile test:clip", status: "passed" },
        {
          command: "pnpm --filter @volt/scanner-signal validate:production",
          status: "passed",
        },
        {
          command:
            "pnpm --filter @volt/scanner-signal validate:device-evidence-manifest -- apps/scanner-signal/.tmp/manifest.json",
          status: "passed",
        },
      ],
      deviceSummary: {
        evidenceManifestPath:
          "/repo/apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json",
      },
      appSize: { isAppleThinnedSizeReport: false },
    }),
    {
      localPreflightPassed: true,
      productionValidationChecked: true,
      productionValidationPassed: true,
      deviceValidationSheetAvailable: true,
      deviceValidationSheetGenerated: false,
      generatedEvidenceManifestPath:
        "/repo/apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json",
      evidenceManifestPath: "apps/scanner-signal/.tmp/manifest.json",
      completedEvidenceManifestValidated: true,
      completionRecordGenerated: false,
      completionRecordPlanUpdateChecked: false,
      appleThinnedSizeReportValidated: true,
      localSizeIsAppleThinnedReport: false,
      completionStatus: "pending-completion-checks",
      pendingExternalGates: [],
    }
  );
});

test("completionReadinessSummary requires plan update check before ready", () => {
  assert.deepEqual(
    completionReadinessSummary({
      includeProduction: true,
      includeDeviceSheet: true,
      evidenceManifestPath: "apps/scanner-signal/.tmp/manifest.json",
      results: [
        { command: "pnpm --filter @volt/mobile test:clip", status: "passed" },
        {
          command: "pnpm --filter @volt/scanner-signal validate:production",
          status: "passed",
        },
        {
          command:
            "pnpm --filter @volt/scanner-signal validate:device-evidence-manifest -- apps/scanner-signal/.tmp/manifest.json",
          status: "passed",
        },
        {
          command:
            "pnpm --filter @volt/scanner-signal generate:device-evidence-completion-record -- apps/scanner-signal/.tmp/manifest.json",
          status: "passed",
        },
      ],
      deviceSummary: {
        evidenceManifestPath:
          "/repo/apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json",
      },
      appSize: { isAppleThinnedSizeReport: false },
    }),
    {
      localPreflightPassed: true,
      productionValidationChecked: true,
      productionValidationPassed: true,
      deviceValidationSheetAvailable: true,
      deviceValidationSheetGenerated: false,
      generatedEvidenceManifestPath:
        "/repo/apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json",
      evidenceManifestPath: "apps/scanner-signal/.tmp/manifest.json",
      completedEvidenceManifestValidated: true,
      completionRecordGenerated: true,
      completionRecordPlanUpdateChecked: false,
      appleThinnedSizeReportValidated: true,
      localSizeIsAppleThinnedReport: false,
      completionStatus: "pending-completion-checks",
      pendingExternalGates: [],
    }
  );
});

test("completionReadinessSummary marks completion ready after local checks, manifest, record, and plan check pass", () => {
  assert.deepEqual(
    completionReadinessSummary({
      includeProduction: true,
      includeDeviceSheet: true,
      evidenceManifestPath: "apps/scanner-signal/.tmp/manifest.json",
      results: [
        { command: "pnpm --filter @volt/mobile test:clip", status: "passed" },
        {
          command: "pnpm --filter @volt/scanner-signal validate:production",
          status: "passed",
        },
        {
          command:
            "pnpm --filter @volt/scanner-signal validate:device-evidence-manifest -- apps/scanner-signal/.tmp/manifest.json",
          status: "passed",
        },
        {
          command:
            "pnpm --filter @volt/scanner-signal generate:device-evidence-completion-record -- apps/scanner-signal/.tmp/manifest.json",
          status: "passed",
        },
        {
          command:
            "pnpm --filter @volt/mobile apply:clip-completion-record -- --check apps/scanner-signal/.tmp/manifest.json",
          status: "passed",
        },
      ],
      deviceSummary: {
        evidenceManifestPath:
          "/repo/apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json",
      },
      appSize: { isAppleThinnedSizeReport: false },
    }),
    {
      localPreflightPassed: true,
      productionValidationChecked: true,
      productionValidationPassed: true,
      deviceValidationSheetAvailable: true,
      deviceValidationSheetGenerated: false,
      generatedEvidenceManifestPath:
        "/repo/apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json",
      evidenceManifestPath: "apps/scanner-signal/.tmp/manifest.json",
      completedEvidenceManifestValidated: true,
      completionRecordGenerated: true,
      completionRecordPlanUpdateChecked: true,
      appleThinnedSizeReportValidated: true,
      localSizeIsAppleThinnedReport: false,
      completionStatus: "ready",
      pendingExternalGates: [],
    }
  );
});

test("completionReadinessSummary requires a readable device validation sheet before ready", () => {
  assert.deepEqual(
    completionReadinessSummary({
      includeProduction: true,
      includeDeviceSheet: true,
      evidenceManifestPath: "apps/scanner-signal/.tmp/manifest.json",
      results: [
        { command: "pnpm --filter @volt/mobile test:clip", status: "passed" },
        {
          command: "pnpm --filter @volt/scanner-signal validate:production",
          status: "passed",
        },
        {
          command:
            "pnpm --filter @volt/scanner-signal validate:device-evidence-manifest -- apps/scanner-signal/.tmp/manifest.json",
          status: "passed",
        },
        {
          command:
            "pnpm --filter @volt/scanner-signal generate:device-evidence-completion-record -- apps/scanner-signal/.tmp/manifest.json",
          status: "passed",
        },
        {
          command:
            "pnpm --filter @volt/mobile apply:clip-completion-record -- --check apps/scanner-signal/.tmp/manifest.json",
          status: "passed",
        },
      ],
      deviceSummary: null,
      appSize: { isAppleThinnedSizeReport: false },
    }),
    {
      localPreflightPassed: true,
      productionValidationChecked: true,
      productionValidationPassed: true,
      deviceValidationSheetAvailable: false,
      deviceValidationSheetGenerated: false,
      generatedEvidenceManifestPath: null,
      evidenceManifestPath: "apps/scanner-signal/.tmp/manifest.json",
      completedEvidenceManifestValidated: true,
      completionRecordGenerated: true,
      completionRecordPlanUpdateChecked: true,
      appleThinnedSizeReportValidated: true,
      localSizeIsAppleThinnedReport: false,
      completionStatus: "pending-completion-checks",
      pendingExternalGates: [],
    }
  );
});

test("completionReadinessSummary reports when the device sheet was generated in the same run", () => {
  assert.deepEqual(
    completionReadinessSummary({
      includeProduction: true,
      includeDeviceSheet: true,
      results: [
        {
          command: "pnpm --filter @volt/scanner-signal create:device-validation-session",
          status: "passed",
        },
      ],
      deviceSummary: {
        evidenceManifestPath:
          "/repo/apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json",
      },
    }),
    {
      localPreflightPassed: true,
      productionValidationChecked: true,
      productionValidationPassed: false,
      deviceValidationSheetAvailable: true,
      deviceValidationSheetGenerated: true,
      generatedEvidenceManifestPath:
        "/repo/apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json",
      evidenceManifestPath: null,
      completedEvidenceManifestValidated: false,
      completionRecordGenerated: false,
      completionRecordPlanUpdateChecked: false,
      appleThinnedSizeReportValidated: false,
      localSizeIsAppleThinnedReport: false,
      completionStatus: "pending-completion-checks",
      pendingExternalGates: [
        "appStoreConnectAdvancedExperiences",
        "appleThinnedAppClipSize",
        "physicalIphoneLaunch",
        "chromeCaptureInsertion",
      ],
    }
  );
});

test("deviceValidationSummary reports generated launch and evidence matrix counts", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "volt-app-clip-device-summary-"));
  const sessionsPath = path.join(tempDir, "app-clip-device-validation-sessions.json");
  const evidenceManifestPath = path.join(tempDir, "app-clip-device-evidence-manifest.json");

  try {
    await writeFile(evidenceManifestPath, JSON.stringify({ status: "pending" }));
    await writeFile(
      sessionsPath,
      JSON.stringify({
        origin: "https://scanner-signal.example",
        createdAt: "2026-05-24T00:00:00.000Z",
        expiresAt: "2026-05-24T00:30:00.000Z",
        sessionTtlMinutes: 30,
        sessions: [{ mode: "ocr" }, { mode: "barcode" }, { mode: "dictation" }],
        launchMatrix: [{ evidence: "iphone-no-full-app-ocr-launch.mov" }],
        captureMatrix: [{ evidence: "ocr-input-insertion.mov" }, { evidence: "barcode-textarea-insertion.mov" }],
        evidenceChecklist: ["app-store-connect-advanced-experiences.png", "app-clip-app-thinning-size-report.txt"],
        completionGateChecklist: [
          { gate: "appStoreConnectAdvancedExperiences" },
          { gate: "appleThinnedAppClipSize" },
        ],
        completionEvidenceManifestTemplate: { status: "pending" },
        completionRecordTemplate: { validationDate: "YYYY-MM-DD" },
      })
    );

    assert.deepEqual(
      await deviceValidationSummary({
        includeDeviceSheet: true,
        sessionsPath,
      }),
      {
        path: sessionsPath,
        evidenceManifestPath,
        evidenceManifestExists: true,
        origin: "https://scanner-signal.example",
        createdAt: "2026-05-24T00:00:00.000Z",
        expiresAt: "2026-05-24T00:30:00.000Z",
        sessionTtlMinutes: 30,
        modes: ["ocr", "barcode", "dictation"],
        sessionCount: 3,
        launchMatrixRows: 1,
        captureMatrixRows: 2,
        evidenceCount: 2,
        completionGateCount: 2,
        completionGates: ["appStoreConnectAdvancedExperiences", "appleThinnedAppClipSize"],
        hasCompletionEvidenceManifestTemplate: true,
        hasCompletionRecordTemplate: true,
      }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("appSizeSummary auto-detects the latest local Release App Clip build", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "volt-app-clip-derived-data-"));
  const staleAppPath = path.join(
    tempDir,
    "Volt-stale/Build/Products/Release-iphoneos/Volt Clip.app"
  );
  const latestAppPath = path.join(
    tempDir,
    "Volt-latest/Build/Products/Release-iphoneos/Volt Clip.app"
  );

  try {
    await mkdir(staleAppPath, { recursive: true });
    await writeFile(path.join(staleAppPath, "main.jsbundle"), "old");
    await mkdir(latestAppPath, { recursive: true });
    await writeFile(path.join(latestAppPath, "main.jsbundle"), "new-bundle");
    await writeFile(path.join(latestAppPath, "asset.txt"), "asset");

    const now = new Date();
    const old = new Date(now.getTime() - 60_000);
    await import("node:fs/promises").then(({ utimes }) => utimes(staleAppPath, old, old));
    await import("node:fs/promises").then(({ utimes }) => utimes(latestAppPath, now, now));

    assert.equal(await latestAppClipBuildPath(tempDir), latestAppPath);

    const summary = await appSizeSummary({
      appPath: null,
      detectLatest: true,
      derivedDataDir: tempDir,
    });

    assert.equal(summary.appPath, latestAppPath);
    assert.equal(summary.mainJsBundleBytes, 10);
    assert.equal(summary.appBundleBytes, 15);
    assert.equal(summary.conservativeQrInvocationBudgetBytes, conservativeQrInvocationBudgetBytes);
    assert.equal(summary.exceedsConservativeQrInvocationBudget, false);
    assert.equal(summary.isAppleThinnedSizeReport, false);
    assert.match(summary.note, /App Store Connect app thinning/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("appSizeSummary flags local bundles above the conservative QR invocation budget", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "volt-app-clip-size-budget-"));
  const appPath = path.join(tempDir, "Volt Clip.app");

  try {
    await mkdir(appPath, { recursive: true });
    await writeFile(path.join(appPath, "main.jsbundle"), "bundle");
    await writeFile(path.join(appPath, "native.bin"), "native-runtime");

    const summary = await appSizeSummary({
      appPath,
      conservativeBudgetBytes: 10,
    });

    assert.equal(summary.appBundleBytes, 20);
    assert.equal(summary.conservativeQrInvocationBudgetBytes, 10);
    assert.equal(summary.exceedsConservativeQrInvocationBudget, true);
    assert.equal(summary.isAppleThinnedSizeReport, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
