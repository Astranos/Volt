import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyCompletionRecord,
  parseApplyCompletionRecordOptions,
  upsertCompletionRecordSection,
} from "./apply-app-clip-completion-record.mjs";

const artifactDirectory = "s3://volt-evidence/app-clip/2026-05-24";

const evidenceByGate = {
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
const passCriteriaByGate = {
  appStoreConnectAdvancedExperiences:
    "All three /clip/:mode URLs are configured as Advanced App Clip Experiences for com.volt.mobile.Clip on scanner-signal.vercel.app.",
  appleThinnedAppClipSize:
    "The uncompressed thinned iPhone App Clip variant is within Apple's supported size limit for the deployment target and QR invocation flow.",
  physicalIphoneLaunch:
    "Each launch matrix row opens the App Clip or routes correctly, and the opened screen matches the requested mode.",
  chromeCaptureInsertion:
    "OCR, barcode, and dictation results reach the original Chrome target, with clipboard fallback for restricted targets and clear recovery states for timeout/close flows.",
};

function artifactPath(filename) {
  return `${artifactDirectory}/${filename}`;
}

function completeManifest() {
  return {
    validationRunId: "2026-05-24-app-clip-validation",
    status: "passed",
    artifactDirectory,
    completionRecord: {
      validationDate: "2026-05-24",
      deviceModel: "iPhone 15",
      iosVersion: "iOS 18.5",
      browserVersion: "Chrome 125",
      extensionVersion: "1.0.30",
      appBuild: "TestFlight 42",
      appStoreConnectEvidence: evidenceByGate.appStoreConnectAdvancedExperiences.map(artifactPath),
      appThinningSizeReport: artifactPath("app-clip-app-thinning-size-report.txt"),
      appThinningSizeValue: "12.4 MB uncompressed thinned App Clip",
      launchEvidence: evidenceByGate.physicalIphoneLaunch.map(artifactPath),
      captureAndInsertionEvidence: evidenceByGate.chromeCaptureInsertion.map(artifactPath),
    },
    gates: Object.entries(evidenceByGate).map(([gate, filenames]) => ({
      gate,
      status: "passed",
      passCriteria: passCriteriaByGate[gate],
      evidence: filenames.map((filename) => ({
        filename,
        captured: true,
        artifactPath: artifactPath(filename),
        notes: "",
      })),
    })),
  };
}

test("upsertCompletionRecordSection inserts completion evidence before current gate status", () => {
  const updated = upsertCompletionRecordSection(
    ["### Production Validation", "", "- Existing production fact.", "", "### Current Completion Gate Status", "", "- Pending."].join("\n"),
    "### Completion Evidence - 2026-05-24\n\n- Validation run: 2026-05-24-app-clip-validation\n"
  );

  assert.match(
    updated,
    /- Existing production fact\.\n\n### Completion Evidence - 2026-05-24\n\n- Validation run: 2026-05-24-app-clip-validation\n\n### Current Completion Gate Status/
  );
});

test("upsertCompletionRecordSection replaces an existing completion evidence block", () => {
  const updated = upsertCompletionRecordSection(
    [
      "### Production Validation",
      "",
      "### Completion Evidence - 2026-05-01",
      "",
      "- Old run.",
      "",
      "### Current Completion Gate Status",
      "",
      "- Pending.",
    ].join("\n"),
    "### Completion Evidence - 2026-05-24\n\n- New run.\n"
  );

  assert.match(updated, /### Completion Evidence - 2026-05-24/);
  assert.match(updated, /- New run\./);
  assert.doesNotMatch(updated, /Old run/);
});

test("applyCompletionRecord validates the manifest and updates a plan file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "volt-app-clip-apply-record-"));
  const manifestPath = path.join(tempDir, "manifest.json");
  const planPath = path.join(tempDir, "APP_CLIP_IMPLEMENTATION_PLAN.md");

  try {
    await writeFile(manifestPath, JSON.stringify(completeManifest(), null, 2));
    await writeFile(
      planPath,
      ["### Production Validation", "", "- Existing production fact.", "", "### Current Completion Gate Status", "", "- Pending."].join("\n")
    );

    await applyCompletionRecord({ manifestPath, planPath });

    const updated = await readFile(planPath, "utf8");
    assert.match(updated, /### Completion Evidence - 2026-05-24/);
    assert.match(updated, /Completion gates:/);
    assert.match(updated, /Apple app-thinning evidence:/);
    assert.match(updated, /### Current Completion Gate Status/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("applyCompletionRecord check mode validates without writing the plan file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "volt-app-clip-apply-record-check-"));
  const manifestPath = path.join(tempDir, "manifest.json");
  const planPath = path.join(tempDir, "APP_CLIP_IMPLEMENTATION_PLAN.md");
  const originalPlan = [
    "### Production Validation",
    "",
    "- Existing production fact.",
    "",
    "### Current Completion Gate Status",
    "",
    "- Pending.",
  ].join("\n");

  try {
    await writeFile(manifestPath, JSON.stringify(completeManifest(), null, 2));
    await writeFile(planPath, originalPlan);

    const result = await applyCompletionRecord({ check: true, manifestPath, planPath });

    assert.equal(result.check, true);
    assert.equal(result.changed, true);
    assert.match(result.updatedPlan, /### Completion Evidence - 2026-05-24/);
    assert.equal(await readFile(planPath, "utf8"), originalPlan);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("applyCompletionRecord rejects a pending manifest before updating the plan", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "volt-app-clip-apply-record-pending-"));
  const manifestPath = path.join(tempDir, "manifest.json");
  const planPath = path.join(tempDir, "APP_CLIP_IMPLEMENTATION_PLAN.md");

  try {
    const manifest = completeManifest();
    manifest.status = "pending";
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    await writeFile(planPath, "### Current Completion Gate Status\n");

    await assert.rejects(
      () => applyCompletionRecord({ manifestPath, planPath }),
      /Cannot generate completion record from invalid manifest/
    );
    assert.equal(await readFile(planPath, "utf8"), "### Current Completion Gate Status\n");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("applyCompletionRecord requires an evidence manifest path", async () => {
  await assert.rejects(
    () => applyCompletionRecord(),
    /requires an evidence manifest path/
  );
});

test("parseApplyCompletionRecordOptions accepts check mode and pnpm separator", () => {
  assert.deepEqual(
    parseApplyCompletionRecordOptions([
      "--",
      "--check",
      "apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json",
    ]),
    {
      check: true,
      manifestPath: "apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json",
    }
  );
});
