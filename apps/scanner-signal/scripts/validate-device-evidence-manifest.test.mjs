import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  evidenceManifestPathFromArgv,
  readAndValidateEvidenceManifest,
  resolveEvidenceManifestPath,
  validateEvidenceManifest,
} from "./validate-device-evidence-manifest.mjs";

const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const requiredEvidenceByGate = {
  appStoreConnectAdvancedExperiences: [
    "app-store-connect-advanced-experiences.png",
    "app-store-connect-ocr-url.png",
    "app-store-connect-barcode-url.png",
    "app-store-connect-dictation-url.png",
  ],
  appleThinnedAppClipSize: [
    "app-clip-archive-summary.png",
    "app-clip-app-thinning-size-report.txt",
    "app-store-connect-app-clip-size.png",
  ],
  physicalIphoneLaunch: [
    "iphone-no-full-app-ocr-launch.mov",
    "iphone-no-full-app-barcode-launch.mov",
    "iphone-no-full-app-dictation-launch.mov",
    "iphone-full-app-installed-routing.mov",
  ],
  chromeCaptureInsertion: [
    "ocr-input-insertion.mov",
    "barcode-textarea-insertion.mov",
    "dictation-contenteditable-insertion.mov",
    "password-field-clipboard-fallback.mov",
    "restricted-page-clipboard-fallback.mov",
    "expired-session-retry-state.png",
    "close-qr-disconnect-state.png",
  ],
};
const requiredPassCriteriaByGate = {
  appStoreConnectAdvancedExperiences:
    "All three /clip/:mode URLs are configured as Advanced App Clip Experiences for com.volt.mobile.Clip on scanner-signal.vercel.app.",
  appleThinnedAppClipSize:
    "The uncompressed thinned iPhone App Clip variant is within Apple's supported size limit for the deployment target and QR invocation flow.",
  physicalIphoneLaunch:
    "Each launch matrix row opens the App Clip or routes correctly, and the opened screen matches the requested mode.",
  chromeCaptureInsertion:
    "OCR, barcode, and dictation results reach the original Chrome target, with clipboard fallback for restricted targets and clear recovery states for timeout/close flows.",
};

function completeManifest() {
  return {
    validationRunId: "2026-05-24-app-clip-validation",
    status: "passed",
    artifactDirectory: "s3://volt-evidence/app-clip/2026-05-24",
    completionRecord: {
      validationDate: "2026-05-24",
      deviceModel: "iPhone 15",
      iosVersion: "iOS 18.5",
      browserVersion: "Chrome 125",
      extensionVersion: "1.0.30",
      appBuild: "TestFlight 42",
      appStoreConnectEvidence: requiredEvidenceByGate.appStoreConnectAdvancedExperiences.map(
        (filename) => `s3://volt-evidence/app-clip/2026-05-24/${filename}`
      ),
      appThinningSizeReport:
        "s3://volt-evidence/app-clip/2026-05-24/app-clip-app-thinning-size-report.txt",
      appThinningSizeValue: "12.4 MB uncompressed thinned App Clip",
      launchEvidence: requiredEvidenceByGate.physicalIphoneLaunch.map(
        (filename) => `s3://volt-evidence/app-clip/2026-05-24/${filename}`
      ),
      captureAndInsertionEvidence: requiredEvidenceByGate.chromeCaptureInsertion.map(
        (filename) => `s3://volt-evidence/app-clip/2026-05-24/${filename}`
      ),
    },
    gates: Object.entries(requiredEvidenceByGate).map(([gate, evidenceFilenames]) => ({
      gate,
      status: "passed",
      passCriteria: requiredPassCriteriaByGate[gate],
      evidence: evidenceFilenames.map((filename) => ({
        filename,
        captured: true,
        artifactPath: `s3://volt-evidence/app-clip/2026-05-24/${filename}`,
        notes: "",
      })),
    })),
  };
}

test("validateEvidenceManifest accepts a completed manifest with all completion gates", () => {
  assert.deepEqual(validateEvidenceManifest(completeManifest()), []);
});

test("validateEvidenceManifest rejects pending gates and missing artifact paths", () => {
  const manifest = completeManifest();
  manifest.status = "pending";
  manifest.gates[1].status = "pending";
  manifest.gates[2].evidence[0].captured = false;
  manifest.gates[3].evidence[0].artifactPath = "";

  assert.deepEqual(validateEvidenceManifest(manifest), [
    "Manifest status must be passed.",
    "Gate appleThinnedAppClipSize status must be passed.",
    "Evidence physicalIphoneLaunch/iphone-no-full-app-ocr-launch.mov must be marked captured with boolean true.",
    "Evidence chromeCaptureInsertion/ocr-input-insertion.mov must include artifactPath.",
  ]);
});

test("validateEvidenceManifest rejects non-boolean captured flags", () => {
  const manifest = completeManifest();
  manifest.gates
    .find((gate) => gate.gate === "physicalIphoneLaunch")
    .evidence.find((item) => item.filename === "iphone-no-full-app-barcode-launch.mov").captured =
    "true";

  assert.deepEqual(validateEvidenceManifest(manifest), [
    "Evidence physicalIphoneLaunch/iphone-no-full-app-barcode-launch.mov must be marked captured with boolean true.",
  ]);
});

test("validateEvidenceManifest rejects non-string evidence notes", () => {
  const manifest = completeManifest();
  manifest.gates
    .find((gate) => gate.gate === "chromeCaptureInsertion")
    .evidence.find((item) => item.filename === "expired-session-retry-state.png").notes = {
    reviewer: "manual",
  };

  assert.deepEqual(validateEvidenceManifest(manifest), [
    "Evidence chromeCaptureInsertion/expired-session-retry-state.png notes must be a string.",
  ]);
});

test("validateEvidenceManifest rejects missing required evidence filenames", () => {
  const manifest = completeManifest();
  manifest.gates
    .find((gate) => gate.gate === "chromeCaptureInsertion")
    .evidence = manifest.gates
    .find((gate) => gate.gate === "chromeCaptureInsertion")
    .evidence.filter((item) => item.filename !== "restricted-page-clipboard-fallback.mov");

  assert.deepEqual(validateEvidenceManifest(manifest), [
    "Gate chromeCaptureInsertion missing required evidence restricted-page-clipboard-fallback.mov.",
  ]);
});

test("validateEvidenceManifest rejects changed gate pass criteria", () => {
  const manifest = completeManifest();
  manifest.gates.find((gate) => gate.gate === "chromeCaptureInsertion").passCriteria =
    "Chrome insertion looked good.";

  assert.deepEqual(validateEvidenceManifest(manifest), [
    "Gate chromeCaptureInsertion passCriteria must match the generated checklist.",
  ]);
});

test("validateEvidenceManifest rejects missing completion record fields", () => {
  const manifest = completeManifest();
  manifest.completionRecord.deviceModel = "";
  manifest.completionRecord.appThinningSizeValue = "";
  manifest.completionRecord.launchEvidence = [];

  assert.deepEqual(validateEvidenceManifest(manifest), [
    "Completion record must include deviceModel.",
    "Completion record must include appThinningSizeValue.",
    "Completion record must include launchEvidence.",
  ]);
});

test("validateEvidenceManifest rejects invalid completion record validation dates", () => {
  const manifest = completeManifest();
  manifest.completionRecord.validationDate = "2026-02-31";

  assert.deepEqual(validateEvidenceManifest(manifest), [
    "Completion record validationDate must use YYYY-MM-DD.",
  ]);
});

test("validateEvidenceManifest rejects validation run ids that do not match the completion date", () => {
  const manifest = completeManifest();
  manifest.validationRunId = "2026-05-23-app-clip-validation";

  assert.deepEqual(validateEvidenceManifest(manifest), [
    "Manifest validationRunId must start with completion record validationDate.",
  ]);
});

test("validateEvidenceManifest rejects validation run ids that do not use the generated suffix", () => {
  const manifest = completeManifest();
  manifest.validationRunId = "2026-05-24-manual-device-run";

  assert.deepEqual(validateEvidenceManifest(manifest), [
    "Manifest validationRunId must use YYYY-MM-DD-app-clip-validation.",
  ]);
});

test("validateEvidenceManifest rejects artifact directories that do not include the validation date", () => {
  const manifest = completeManifest();
  manifest.artifactDirectory = "s3://volt-evidence/app-clip/current";
  for (const gate of manifest.gates) {
    for (const evidence of gate.evidence) {
      evidence.artifactPath = `s3://volt-evidence/app-clip/current/${evidence.filename}`;
    }
  }
  manifest.completionRecord.appStoreConnectEvidence =
    manifest.gates
      .find((gate) => gate.gate === "appStoreConnectAdvancedExperiences")
      .evidence.map((evidence) => evidence.artifactPath);
  manifest.completionRecord.appThinningSizeReport =
    "s3://volt-evidence/app-clip/current/app-clip-app-thinning-size-report.txt";
  manifest.completionRecord.launchEvidence =
    manifest.gates
      .find((gate) => gate.gate === "physicalIphoneLaunch")
      .evidence.map((evidence) => evidence.artifactPath);
  manifest.completionRecord.captureAndInsertionEvidence =
    manifest.gates
      .find((gate) => gate.gate === "chromeCaptureInsertion")
      .evidence.map((evidence) => evidence.artifactPath);

  assert.deepEqual(validateEvidenceManifest(manifest), [
    "Manifest artifactDirectory must include completion record validationDate.",
  ]);
});

test("validateEvidenceManifest rejects vague app thinning size values", () => {
  const manifest = completeManifest();
  manifest.completionRecord.appThinningSizeValue = "within limit";

  assert.deepEqual(validateEvidenceManifest(manifest), [
    "Completion record appThinningSizeValue must include a numeric MB uncompressed thinned App Clip size.",
  ]);
});

test("validateEvidenceManifest rejects completion record evidence lists that omit required artifacts", () => {
  const manifest = completeManifest();
  manifest.completionRecord.appStoreConnectEvidence =
    manifest.completionRecord.appStoreConnectEvidence.filter(
      (artifactPath) => !artifactPath.endsWith("app-store-connect-dictation-url.png")
    );
  manifest.completionRecord.captureAndInsertionEvidence =
    manifest.completionRecord.captureAndInsertionEvidence.filter(
      (artifactPath) => !artifactPath.endsWith("restricted-page-clipboard-fallback.mov")
    );
  manifest.completionRecord.appThinningSizeReport =
    "s3://volt-evidence/app-clip/2026-05-24/wrong-size-report.txt";

  assert.deepEqual(validateEvidenceManifest(manifest), [
    "Completion record appStoreConnectEvidence must include app-store-connect-dictation-url.png.",
    "Completion record captureAndInsertionEvidence must include restricted-page-clipboard-fallback.mov.",
    "Completion record appThinningSizeReport must reference app-clip-app-thinning-size-report.txt.",
    "Completion record appThinningSizeReport must match the captured app-thinning report artifact path.",
  ]);
});

test("validateEvidenceManifest rejects completion record paths that do not match captured artifacts", () => {
  const manifest = completeManifest();
  manifest.completionRecord.launchEvidence = manifest.completionRecord.launchEvidence.map((artifactPath) =>
    artifactPath.endsWith("iphone-no-full-app-ocr-launch.mov")
      ? "s3://other-bucket/iphone-no-full-app-ocr-launch.mov"
      : artifactPath
  );

  assert.deepEqual(validateEvidenceManifest(manifest), [
    "Completion record launchEvidence has unexpected artifact path: s3://other-bucket/iphone-no-full-app-ocr-launch.mov.",
    "Completion record launchEvidence must include captured artifact path for iphone-no-full-app-ocr-launch.mov.",
  ]);
});

test("validateEvidenceManifest rejects completion record duplicate and extra artifact paths", () => {
  const manifest = completeManifest();
  manifest.completionRecord.captureAndInsertionEvidence.push(
    manifest.completionRecord.captureAndInsertionEvidence[0],
    "s3://volt-evidence/app-clip/2026-05-24/extra-capture.mov"
  );

  assert.deepEqual(validateEvidenceManifest(manifest), [
    "Completion record captureAndInsertionEvidence has unexpected artifact path: s3://volt-evidence/app-clip/2026-05-24/extra-capture.mov.",
    `Completion record captureAndInsertionEvidence has duplicate artifact path: ${manifest.completionRecord.captureAndInsertionEvidence[0]}.`,
  ]);
});

test("validateEvidenceManifest rejects non-string completion record evidence entries", () => {
  const manifest = completeManifest();
  manifest.completionRecord.launchEvidence.push({
    artifactPath: "s3://volt-evidence/app-clip/2026-05-24/extra-launch.mov",
  });

  assert.deepEqual(validateEvidenceManifest(manifest), [
    "Completion record launchEvidence must contain artifact path strings.",
  ]);
});

test("validateEvidenceManifest rejects captured artifacts outside the declared artifact directory", () => {
  const manifest = completeManifest();
  manifest.gates
    .find((gate) => gate.gate === "appStoreConnectAdvancedExperiences")
    .evidence.find((item) => item.filename === "app-store-connect-ocr-url.png").artifactPath =
    "s3://volt-evidence/other-run/app-store-connect-ocr-url.png";

  assert.deepEqual(validateEvidenceManifest(manifest), [
    "Completion record appStoreConnectEvidence has unexpected artifact path: s3://volt-evidence/app-clip/2026-05-24/app-store-connect-ocr-url.png.",
    "Completion record appStoreConnectEvidence must include captured artifact path for app-store-connect-ocr-url.png.",
    "Evidence appStoreConnectAdvancedExperiences/app-store-connect-ocr-url.png artifactPath must be inside artifactDirectory.",
  ]);
});

test("validateEvidenceManifest rejects artifact paths that do not end with their evidence filename", () => {
  const manifest = completeManifest();
  manifest.gates
    .find((gate) => gate.gate === "appleThinnedAppClipSize")
    .evidence.find((item) => item.filename === "app-store-connect-app-clip-size.png").artifactPath =
    "s3://volt-evidence/app-clip/2026-05-24/app-store-connect-size-screenshot.png";

  assert.deepEqual(validateEvidenceManifest(manifest), [
    "Evidence appleThinnedAppClipSize/app-store-connect-app-clip-size.png artifactPath must end with filename.",
  ]);
});

test("validateEvidenceManifest rejects unchanged artifact directory placeholder", () => {
  const manifest = completeManifest();
  manifest.artifactDirectory = "path-or-url-to-archived-evidence";
  for (const gate of manifest.gates) {
    for (const evidence of gate.evidence) {
      evidence.artifactPath = `path-or-url-to-archived-evidence/${evidence.filename}`;
    }
  }
  manifest.completionRecord.appStoreConnectEvidence =
    manifest.gates
      .find((gate) => gate.gate === "appStoreConnectAdvancedExperiences")
      .evidence.map((evidence) => evidence.artifactPath);
  manifest.completionRecord.appThinningSizeReport =
    "path-or-url-to-archived-evidence/app-clip-app-thinning-size-report.txt";
  manifest.completionRecord.launchEvidence =
    manifest.gates
      .find((gate) => gate.gate === "physicalIphoneLaunch")
      .evidence.map((evidence) => evidence.artifactPath);
  manifest.completionRecord.captureAndInsertionEvidence =
    manifest.gates
      .find((gate) => gate.gate === "chromeCaptureInsertion")
      .evidence.map((evidence) => evidence.artifactPath);

  assert.deepEqual(validateEvidenceManifest(manifest), [
    "Manifest artifactDirectory must replace the template placeholder.",
  ]);
});

test("validateEvidenceManifest rejects unchanged completion record placeholders", () => {
  const manifest = completeManifest();
  manifest.completionRecord.validationDate = "YYYY-MM-DD";
  manifest.completionRecord.deviceModel = "iPhone model";
  manifest.completionRecord.appThinningSizeReport = "app-clip-app-thinning-size-report.txt";
  manifest.completionRecord.appThinningSizeValue = "Uncompressed thinned App Clip size";

  assert.deepEqual(validateEvidenceManifest(manifest), [
    "Completion record validationDate must replace the template placeholder.",
    "Completion record deviceModel must replace the template placeholder.",
    "Completion record appThinningSizeValue must replace the template placeholder.",
    "Completion record appThinningSizeReport must include the captured report artifact path.",
  ]);
});

test("validateEvidenceManifest rejects missing required gates", () => {
  const manifest = completeManifest();
  manifest.gates = manifest.gates.filter((gate) => gate.gate !== "chromeCaptureInsertion");

  assert.deepEqual(validateEvidenceManifest(manifest), ["Missing gate: chromeCaptureInsertion."]);
});

test("validateEvidenceManifest rejects unexpected gates and evidence filenames", () => {
  const manifest = completeManifest();
  manifest.gates.push({
    gate: "extraManualNotes",
    status: "passed",
    evidence: [
      {
        filename: "manual-notes.txt",
        captured: true,
        artifactPath: "s3://volt-evidence/app-clip/2026-05-24/manual-notes.txt",
        notes: "",
      },
    ],
  });
  manifest.gates
    .find((gate) => gate.gate === "physicalIphoneLaunch")
    .evidence.push({
      filename: "extra-launch.mov",
      captured: true,
      artifactPath: "s3://volt-evidence/app-clip/2026-05-24/extra-launch.mov",
      notes: "",
    });

  assert.deepEqual(validateEvidenceManifest(manifest), [
    "Unexpected gate: extraManualNotes.",
    "Gate physicalIphoneLaunch has unexpected evidence extra-launch.mov.",
  ]);
});

test("validateEvidenceManifest rejects duplicate gates and evidence filenames", () => {
  const manifest = completeManifest();
  manifest.gates.push(structuredClone(manifest.gates[0]));
  const chromeGate = manifest.gates.find((gate) => gate.gate === "chromeCaptureInsertion");
  chromeGate.evidence.push(structuredClone(chromeGate.evidence[0]));

  assert.deepEqual(validateEvidenceManifest(manifest), [
    "Duplicate gate: appStoreConnectAdvancedExperiences.",
    "Gate chromeCaptureInsertion has duplicate evidence ocr-input-insertion.mov.",
  ]);
});

test("readAndValidateEvidenceManifest reads a JSON manifest from disk", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "volt-app-clip-evidence-"));
  const manifestPath = path.join(tempDir, "manifest.json");

  try {
    await writeFile(manifestPath, JSON.stringify(completeManifest(), null, 2));
    assert.deepEqual(await readAndValidateEvidenceManifest(manifestPath), []);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("evidenceManifestPathFromArgv skips pnpm argument separator", () => {
  assert.equal(
    evidenceManifestPathFromArgv(["--", "apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json"]),
    "apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json"
  );
});

test("resolveEvidenceManifestPath accepts repo-relative app paths", () => {
  assert.equal(
    resolveEvidenceManifestPath("apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json"),
    path.join(repoRoot, "apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json")
  );
});
