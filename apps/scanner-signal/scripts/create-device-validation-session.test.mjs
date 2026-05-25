import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createDeviceValidationSessionSheet, renderHtml } from "./create-device-validation-session.mjs";

test("renderHtml includes QR images and App Clip URLs for every mode", () => {
  const html = renderHtml({
    origin: "https://scanner-signal.example",
    createdAt: "2026-05-24T00:00:00.000Z",
    expiresAt: "2026-05-24T00:30:00.000Z",
    sessions: [
      {
        mode: "ocr",
        sessionId: "ocr12345",
        url: "https://scanner-signal.example/clip/ocr?session=ocr12345",
      },
      {
        mode: "barcode",
        sessionId: "bar12345",
        url: "https://scanner-signal.example/clip/barcode?session=bar12345",
      },
    ],
  });

  assert.match(html, /Volt App Clip Device Validation/);
  assert.match(html, /Relay sessions expire at 2026-05-24T00:30:00.000Z \(30 minutes after generation\)/);
  assert.match(html, /https:\/\/api\.qrserver\.com\/v1\/create-qr-code\//);
  assert.match(html, /https:\/\/scanner-signal\.example\/clip\/ocr\?session=ocr12345/);
  assert.match(html, /https:\/\/scanner-signal\.example\/clip\/barcode\?session=bar12345/);
  assert.match(html, /Session: <code>ocr12345<\/code>/);
  assert.match(html, /Required Evidence/);
  assert.match(html, /Launch Matrix/);
  assert.match(html, /Capture And Insertion Matrix/);
  assert.match(html, /app-clip-app-thinning-size-report\.txt/);
  assert.match(html, /iphone-no-full-app-ocr-launch\.mov/);
  assert.match(html, /ocr-input-insertion\.mov/);
  assert.match(html, /password-field-clipboard-fallback\.mov/);
  assert.match(html, /&lt;input&gt;/);
  assert.match(html, /&lt;div contenteditable=&quot;true&quot;&gt;/);
  assert.doesNotMatch(html, /<td><code><input><\/code><\/td>/);
  assert.match(html, /Advanced App Clip Experiences/);
  assert.match(html, /Completion Gates/);
  assert.match(html, /appStoreConnectAdvancedExperiences/);
  assert.match(html, /appleThinnedAppClipSize/);
  assert.match(html, /physicalIphoneLaunch/);
  assert.match(html, /chromeCaptureInsertion/);
  assert.match(html, /Completion Record Template/);
  assert.match(html, /Evidence Manifest Template/);
  assert.match(html, /Completion Commands/);
  assert.match(html, /validate:device-evidence-manifest -- apps\/scanner-signal\/\.tmp\/app-clip-device-evidence-manifest\.json/);
  assert.match(html, /preflight:clip -- --production --device-sheet --evidence-manifest apps\/scanner-signal\/\.tmp\/app-clip-device-evidence-manifest\.json/);
  assert.match(html, /generate:device-evidence-completion-record -- apps\/scanner-signal\/\.tmp\/app-clip-device-evidence-manifest\.json/);
  assert.match(html, /apply:clip-completion-record -- --check apps\/scanner-signal\/\.tmp\/app-clip-device-evidence-manifest\.json/);
  assert.match(html, /apply:clip-completion-record -- apps\/scanner-signal\/\.tmp\/app-clip-device-evidence-manifest\.json/);
  assert.match(html, /without regenerating the device-validation sheet first/);
  assert.match(html, /Completion Evidence - YYYY-MM-DD/);
  assert.match(html, /Replace the template <code>artifactDirectory<\/code> with the final evidence archive containing the completion-record date/);
  assert.match(html, /validationRunId<\/code> to <code>YYYY-MM-DD-app-clip-validation<\/code> using the same date/);
  assert.match(html, /artifactPath<\/code> under that directory/);
  assert.match(html, /boolean <code>captured: true<\/code>/);
  assert.match(html, /<code>--evidence-manifest<\/code> flag requires an explicit manifest path/);
  assert.match(html, /validationRunId/);
  assert.match(html, /artifactDirectory/);
  assert.match(html, /appThinningSizeValue/);
});

test("renderHtml escapes session values in generated markup", () => {
  const html = renderHtml({
    origin: "https://scanner-signal.example",
    createdAt: "2026-05-24T00:00:00.000Z",
    sessions: [
      {
        mode: "ocr<script>",
        sessionId: "bad<script>",
        url: "https://scanner-signal.example/clip/ocr?session=bad<script>",
      },
    ],
  });

  assert.match(html, /ocr&lt;script&gt;/);
  assert.match(html, /bad&lt;script&gt;/);
  assert.doesNotMatch(html, /bad<script>/);
});

test("createDeviceValidationSessionSheet creates mode-bound sessions and writes JSON and HTML", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "volt-clip-validation-"));
  const requests = [];
  const sessionIds = {
    ocr: "ocr12345",
    barcode: "bar12345",
    dictation: "dic12345",
  };

  try {
    const result = await createDeviceValidationSessionSheet({
      origin: "https://scanner-signal.example",
      outputDir: tempDir,
      modes: ["ocr", "barcode", "dictation"],
      createdAt: "2026-05-24T00:00:00.000Z",
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);
        requests.push({ url, body });
        return {
          ok: true,
          async json() {
            return { sessionId: sessionIds[body.mode] };
          },
        };
      },
    });

    assert.equal(result.sessions.length, 3);
    assert.deepEqual(
      requests.map((request) => request.body),
      [
        { relay: true, mode: "ocr" },
        { relay: true, mode: "barcode" },
        { relay: true, mode: "dictation" },
      ]
    );

    const json = JSON.parse(await readFile(result.jsonPath, "utf8"));
    const html = await readFile(result.htmlPath, "utf8");
    const evidenceManifest = JSON.parse(await readFile(result.evidenceManifestPath, "utf8"));

    assert.equal(json.origin, "https://scanner-signal.example");
    assert.equal(json.createdAt, "2026-05-24T00:00:00.000Z");
    assert.equal(json.expiresAt, "2026-05-24T00:30:00.000Z");
    assert.equal(json.sessionTtlMinutes, 30);
    assert.equal(json.sessions[0].url, "https://scanner-signal.example/clip/ocr?session=ocr12345");
    assert.equal(json.launchMatrix[0].evidence, "iphone-no-full-app-ocr-launch.mov");
    assert.equal(json.captureMatrix[0].evidence, "ocr-input-insertion.mov");
    assert.ok(json.evidenceChecklist.includes("app-store-connect-advanced-experiences.png"));
    assert.ok(json.evidenceChecklist.includes("close-qr-disconnect-state.png"));
    assert.deepEqual(
      json.completionGateChecklist.map((gate) => gate.gate),
      [
        "appStoreConnectAdvancedExperiences",
        "appleThinnedAppClipSize",
        "physicalIphoneLaunch",
        "chromeCaptureInsertion",
      ]
    );
    assert.ok(
      json.completionGateChecklist
        .find((gate) => gate.gate === "appleThinnedAppClipSize")
        .requiredEvidence.includes("app-clip-app-thinning-size-report.txt")
    );
    assert.equal(json.completionEvidenceManifestTemplate.status, "pending");
    assert.equal(json.completionEvidenceManifestTemplate.completionRecord.validationDate, "YYYY-MM-DD");
    assert.equal(
      json.completionEvidenceManifestTemplate.completionRecord.appThinningSizeValue,
      "Uncompressed thinned App Clip size"
    );
    assert.equal(json.completionEvidenceManifestTemplate.gates.length, 4);
    assert.deepEqual(json.completionEvidenceManifestTemplate.gates[0].evidence[0], {
      filename: "app-store-connect-advanced-experiences.png",
      captured: false,
      artifactPath: "",
      notes: "",
    });
    assert.deepEqual(evidenceManifest, json.completionEvidenceManifestTemplate);
    assert.equal(json.completionRecordTemplate.validationDate, "YYYY-MM-DD");
    assert.deepEqual(json.completionRecordTemplate.launchEvidence, [
      "iphone-no-full-app-ocr-launch.mov",
      "iphone-no-full-app-barcode-launch.mov",
      "iphone-no-full-app-dictation-launch.mov",
      "iphone-full-app-installed-routing.mov",
    ]);
    assert.match(html, /https:\/\/scanner-signal\.example\/clip\/dictation\?session=dic12345/);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
