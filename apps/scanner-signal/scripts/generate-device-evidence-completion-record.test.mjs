import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  formatCompletionRecordMarkdown,
  readAndFormatCompletionRecord,
} from "./generate-device-evidence-completion-record.mjs";

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

test("formatCompletionRecordMarkdown emits a plan-ready evidence section", () => {
  const markdown = formatCompletionRecordMarkdown(completeManifest());

  assert.match(markdown, /^### Completion Evidence - 2026-05-24/);
  assert.match(markdown, /Validation run: 2026-05-24-app-clip-validation/);
  assert.match(markdown, /Device: iPhone 15, iOS 18\.5/);
  assert.match(markdown, /App Clip thinned size: 12\.4 MB uncompressed thinned App Clip/);
  assert.match(markdown, /Completion gates:/);
  assert.match(markdown, /appStoreConnectAdvancedExperiences: passed \(4 artifacts\)/);
  assert.match(markdown, /Pass criteria: All three \/clip\/:mode URLs are configured as Advanced App Clip Experiences/);
  assert.match(markdown, /appleThinnedAppClipSize: passed \(3 artifacts\)/);
  assert.match(markdown, /Pass criteria: The uncompressed thinned iPhone App Clip variant is within Apple's supported size limit/);
  assert.match(markdown, /physicalIphoneLaunch: passed \(4 artifacts\)/);
  assert.match(markdown, /Pass criteria: Each launch matrix row opens the App Clip or routes correctly/);
  assert.match(markdown, /chromeCaptureInsertion: passed \(7 artifacts\)/);
  assert.match(markdown, /Pass criteria: OCR, barcode, and dictation results reach the original Chrome target/);
  assert.match(markdown, /App Store Connect evidence:/);
  assert.match(markdown, /Apple app-thinning evidence:/);
  assert.match(markdown, /Physical iPhone launch evidence:/);
  assert.match(markdown, /Chrome capture and insertion evidence:/);
  assert.match(markdown, /s3:\/\/volt-evidence\/app-clip\/2026-05-24\/app-store-connect-ocr-url\.png/);
  assert.match(markdown, /s3:\/\/volt-evidence\/app-clip\/2026-05-24\/app-clip-archive-summary\.png/);
  assert.match(markdown, /s3:\/\/volt-evidence\/app-clip\/2026-05-24\/app-clip-app-thinning-size-report\.txt/);
  assert.match(markdown, /s3:\/\/volt-evidence\/app-clip\/2026-05-24\/app-store-connect-app-clip-size\.png/);
  assert.match(markdown, /s3:\/\/volt-evidence\/app-clip\/2026-05-24\/iphone-no-full-app-ocr-launch\.mov/);
  assert.match(markdown, /s3:\/\/volt-evidence\/app-clip\/2026-05-24\/restricted-page-clipboard-fallback\.mov/);
});

test("formatCompletionRecordMarkdown rejects invalid manifests before emitting Markdown", () => {
  const manifest = completeManifest();
  manifest.status = "pending";

  assert.throws(
    () => formatCompletionRecordMarkdown(manifest),
    /Cannot generate completion record from invalid manifest:\n- Manifest status must be passed\./
  );
});

test("readAndFormatCompletionRecord reads a manifest from disk", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "volt-app-clip-record-"));
  const manifestPath = path.join(tempDir, "manifest.json");

  try {
    await writeFile(manifestPath, JSON.stringify(completeManifest(), null, 2));

    assert.match(
      await readAndFormatCompletionRecord(manifestPath),
      /### Completion Evidence - 2026-05-24/
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
