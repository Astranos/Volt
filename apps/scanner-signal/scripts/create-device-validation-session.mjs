import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const origin = process.env.SCANNER_SIGNAL_ORIGIN || "https://scanner-signal.vercel.app";
const outputDir = process.env.APP_CLIP_VALIDATION_OUTPUT_DIR || ".tmp";
const modes = ["ocr", "barcode", "dictation"];
const sessionTtlMinutes = 30;
const evidenceChecklist = [
  "app-store-connect-advanced-experiences.png",
  "app-store-connect-ocr-url.png",
  "app-store-connect-barcode-url.png",
  "app-store-connect-dictation-url.png",
  "app-clip-archive-summary.png",
  "app-clip-app-thinning-size-report.txt",
  "app-store-connect-app-clip-size.png",
  "iphone-no-full-app-ocr-launch.mov",
  "iphone-no-full-app-barcode-launch.mov",
  "iphone-no-full-app-dictation-launch.mov",
  "iphone-full-app-installed-routing.mov",
  "ocr-input-insertion.mov",
  "barcode-textarea-insertion.mov",
  "dictation-contenteditable-insertion.mov",
  "password-field-clipboard-fallback.mov",
  "restricted-page-clipboard-fallback.mov",
  "expired-session-retry-state.png",
  "close-qr-disconnect-state.png",
];
const launchMatrix = [
  {
    deviceState: "Full app not installed",
    network: "Cellular",
    launcher: "Camera app QR",
    path: "/clip/ocr?session=...",
    evidence: "iphone-no-full-app-ocr-launch.mov",
  },
  {
    deviceState: "Full app not installed",
    network: "Wi-Fi",
    launcher: "Camera app QR",
    path: "/clip/barcode?session=...",
    evidence: "iphone-no-full-app-barcode-launch.mov",
  },
  {
    deviceState: "Full app not installed",
    network: "Wi-Fi",
    launcher: "Safari URL",
    path: "/clip/dictation?session=...",
    evidence: "iphone-no-full-app-dictation-launch.mov",
  },
  {
    deviceState: "Full app installed",
    network: "Wi-Fi",
    launcher: "Camera app QR",
    path: "/clip/ocr?session=...",
    evidence: "iphone-full-app-installed-routing.mov",
  },
];
const captureMatrix = [
  {
    scenario: "OCR",
    browserTarget: "<input>",
    action: "Capture printed text, edit the text, send it.",
    evidence: "ocr-input-insertion.mov",
  },
  {
    scenario: "Barcode",
    browserTarget: "<textarea>",
    action: "Scan a UPC or QR code and send it.",
    evidence: "barcode-textarea-insertion.mov",
  },
  {
    scenario: "Dictation",
    browserTarget: '<div contenteditable="true">',
    action: "Record speech, stop, send the final transcript.",
    evidence: "dictation-contenteditable-insertion.mov",
  },
  {
    scenario: "Password fallback",
    browserTarget: '<input type="password">',
    action: "Send a capture and verify clipboard fallback.",
    evidence: "password-field-clipboard-fallback.mov",
  },
  {
    scenario: "Restricted-page fallback",
    browserTarget: "chrome://version",
    action: "Send a capture and verify clipboard fallback.",
    evidence: "restricted-page-clipboard-fallback.mov",
  },
  {
    scenario: "Expired session",
    browserTarget: "App Clip URL",
    action: "Open after the extension relay session expires.",
    evidence: "expired-session-retry-state.png",
  },
  {
    scenario: "Close QR",
    browserTarget: "Extension QR overlay",
    action: "Close the overlay without scanning.",
    evidence: "close-qr-disconnect-state.png",
  },
];
const completionRecordTemplate = {
  validationDate: "YYYY-MM-DD",
  deviceModel: "iPhone model",
  iosVersion: "iOS version",
  browserVersion: "Chrome version",
  extensionVersion: "Volt extension version/build",
  appBuild: "App Store/TestFlight build",
  appStoreConnectEvidence: [
    "app-store-connect-advanced-experiences.png",
    "app-store-connect-ocr-url.png",
    "app-store-connect-barcode-url.png",
    "app-store-connect-dictation-url.png",
  ],
  appThinningSizeReport: "app-clip-app-thinning-size-report.txt",
  appThinningSizeValue: "Uncompressed thinned App Clip size",
  launchEvidence: launchMatrix.map((row) => row.evidence),
  captureAndInsertionEvidence: captureMatrix.map((row) => row.evidence),
};
const completionGateChecklist = [
  {
    gate: "appStoreConnectAdvancedExperiences",
    requiredEvidence: [
      "app-store-connect-advanced-experiences.png",
      "app-store-connect-ocr-url.png",
      "app-store-connect-barcode-url.png",
      "app-store-connect-dictation-url.png",
    ],
    passCriteria:
      "All three /clip/:mode URLs are configured as Advanced App Clip Experiences for com.volt.mobile.Clip on scanner-signal.vercel.app.",
  },
  {
    gate: "appleThinnedAppClipSize",
    requiredEvidence: [
      "app-clip-archive-summary.png",
      "app-clip-app-thinning-size-report.txt",
      "app-store-connect-app-clip-size.png",
    ],
    passCriteria:
      "The uncompressed thinned iPhone App Clip variant is within Apple's supported size limit for the deployment target and QR invocation flow.",
  },
  {
    gate: "physicalIphoneLaunch",
    requiredEvidence: launchMatrix.map((row) => row.evidence),
    passCriteria:
      "Each launch matrix row opens the App Clip or routes correctly, and the opened screen matches the requested mode.",
  },
  {
    gate: "chromeCaptureInsertion",
    requiredEvidence: captureMatrix.map((row) => row.evidence),
    passCriteria:
      "OCR, barcode, and dictation results reach the original Chrome target, with clipboard fallback for restricted targets and clear recovery states for timeout/close flows.",
  },
];
const completionEvidenceManifestTemplate = {
  validationRunId: "YYYY-MM-DD-app-clip-validation",
  status: "pending",
  artifactDirectory: "path-or-url-to-archived-evidence",
  completionRecord: completionRecordTemplate,
  gates: completionGateChecklist.map((gate) => ({
    gate: gate.gate,
    status: "pending",
    passCriteria: gate.passCriteria,
    evidence: gate.requiredEvidence.map((filename) => ({
      filename,
      captured: false,
      artifactPath: "",
      notes: "",
    })),
  })),
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function createRelaySession({ mode, origin, fetchImpl = fetch }) {
  const response = await fetchImpl(`${origin}/api/signal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ relay: true, mode }),
  });

  if (!response.ok) {
    let details = "";
    try {
      const payload = await response.json();
      details = payload?.error ? `: ${payload.error}` : "";
    } catch (_error) {}
    throw new Error(`Failed to create ${mode} session (${response.status})${details}`);
  }

  const payload = await response.json();
  if (typeof payload.sessionId !== "string" || !payload.sessionId) {
    throw new Error(`Invalid ${mode} session response`);
  }

  const url = `${origin}/clip/${mode}?session=${encodeURIComponent(payload.sessionId)}`;
  return { mode, sessionId: payload.sessionId, url };
}

export function renderHtml({
  sessions,
  origin,
  createdAt = new Date().toISOString(),
  expiresAt = new Date(Date.parse(createdAt) + sessionTtlMinutes * 60 * 1000).toISOString(),
}) {
  const rows = sessions
    .map((session) => {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(
        session.url
      )}`;
      return `<section>
  <h2>${escapeHtml(session.mode)}</h2>
  <img src="${qrUrl}" alt="${escapeHtml(session.mode)} App Clip QR" width="240" height="240" />
  <p><a href="${escapeHtml(session.url)}">${escapeHtml(session.url)}</a></p>
  <p>Session: <code>${escapeHtml(session.sessionId)}</code></p>
</section>`;
    })
    .join("\n");
  const evidenceItems = evidenceChecklist.map((filename) => `<li><code>${escapeHtml(filename)}</code></li>`).join("\n");
  const launchRows = launchMatrix
    .map(
      (row) => `<tr>
  <td>${escapeHtml(row.deviceState)}</td>
  <td>${escapeHtml(row.network)}</td>
  <td>${escapeHtml(row.launcher)}</td>
  <td><code>${escapeHtml(row.path)}</code></td>
  <td><code>${escapeHtml(row.evidence)}</code></td>
</tr>`
    )
    .join("\n");
  const captureRows = captureMatrix
    .map(
      (row) => `<tr>
  <td>${escapeHtml(row.scenario)}</td>
  <td><code>${escapeHtml(row.browserTarget)}</code></td>
  <td>${escapeHtml(row.action)}</td>
  <td><code>${escapeHtml(row.evidence)}</code></td>
</tr>`
    )
    .join("\n");
  const completionRecord = `<pre><code>${escapeHtml(
    JSON.stringify(completionRecordTemplate, null, 2)
  )}</code></pre>`;
  const completionManifest = `<pre><code>${escapeHtml(
    JSON.stringify(completionEvidenceManifestTemplate, null, 2)
  )}</code></pre>`;
  const gateRows = completionGateChecklist
    .map(
      (gate) => `<tr>
  <td><code>${escapeHtml(gate.gate)}</code></td>
  <td>${escapeHtml(gate.passCriteria)}</td>
  <td>${escapeHtml(gate.requiredEvidence.join(", "))}</td>
</tr>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Volt App Clip Device Validation</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0 auto;
        max-width: 960px;
        padding: 24px;
        color: #1c1917;
        background: #fafaf9;
      }
      main {
        display: grid;
        gap: 20px;
      }
      section {
        border: 1px solid #d6d3d1;
        border-radius: 8px;
        padding: 16px;
        background: #ffffff;
      }
      .checklist {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 8px 20px;
        padding-left: 20px;
      }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      th,
      td {
        border-top: 1px solid #e7e5e4;
        padding: 8px;
        text-align: left;
        vertical-align: top;
      }
      th {
        color: #44403c;
        font-size: 13px;
        text-transform: uppercase;
      }
      h1,
      h2,
      p {
        margin: 0 0 12px;
      }
      img {
        display: block;
        margin-bottom: 12px;
      }
      a {
        overflow-wrap: anywhere;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Volt App Clip Device Validation</h1>
      <p>Generated ${escapeHtml(createdAt)} against ${escapeHtml(origin)}. Relay sessions expire at ${escapeHtml(expiresAt)} (${sessionTtlMinutes} minutes after generation). Keep the Chrome QR overlay open when testing insertion, and generate a fresh sheet if sessions expire.</p>
      ${rows}
      <section>
        <h2>Launch Matrix</h2>
        <table>
          <thead>
            <tr>
              <th>Device State</th>
              <th>Network</th>
              <th>Launcher</th>
              <th>URL</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            ${launchRows}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Capture And Insertion Matrix</h2>
        <table>
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Browser Target</th>
              <th>Action</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            ${captureRows}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Required Evidence</h2>
        <ul class="checklist">
          ${evidenceItems}
        </ul>
        <p>Pass only when all three modes launch from <code>/clip/:mode?session=...</code>, capture sends a result back to Chrome, editable targets receive insertion, restricted targets use clipboard fallback, App Store Connect Advanced App Clip Experiences are configured, and the Apple app-thinning size report is within the supported App Clip limit.</p>
      </section>
      <section>
        <h2>Completion Gates</h2>
        <table>
          <thead>
            <tr>
              <th>Gate</th>
              <th>Pass Criteria</th>
              <th>Required Evidence</th>
            </tr>
          </thead>
          <tbody>
            ${gateRows}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Completion Record Template</h2>
        <p>Use this shape for the manifest <code>completionRecord</code>. Do not copy it into the implementation plan until the manifest validator passes.</p>
        ${completionRecord}
      </section>
      <section>
        <h2>Evidence Manifest Template</h2>
        <p>Fill <code>apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json</code> alongside the captured artifacts. Replace the template <code>artifactDirectory</code> with the final evidence archive containing the completion-record date, keep every captured <code>artifactPath</code> under that directory, set every evidence item to boolean <code>captured: true</code>, set <code>validationRunId</code> to <code>YYYY-MM-DD-app-clip-validation</code> using the same date, and replace every completion-record placeholder.</p>
        ${completionManifest}
      </section>
      <section>
        <h2>Completion Commands</h2>
        <p>Run these after all App Store Connect, app-thinning, physical launch, and Chrome insertion artifacts are captured.</p>
        <pre><code>pnpm --filter @volt/scanner-signal validate:device-evidence-manifest -- apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json
pnpm --filter @volt/mobile preflight:clip -- --production --device-sheet --evidence-manifest apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json
pnpm --filter @volt/scanner-signal generate:device-evidence-completion-record -- apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json
pnpm --filter @volt/mobile apply:clip-completion-record -- --check apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json
pnpm --filter @volt/mobile apply:clip-completion-record -- apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json</code></pre>
        <p>The mobile preflight command validates this existing manifest without regenerating the device-validation sheet first, so it will not overwrite the completed evidence manifest before checking it.</p>
        <p>The <code>--evidence-manifest</code> flag requires an explicit manifest path; rerun this command only after replacing the template manifest with captured artifact paths.</p>
        <p>The apply command inserts or replaces the generated <code>Completion Evidence - YYYY-MM-DD</code> block in <code>apps/mobile/APP_CLIP_IMPLEMENTATION_PLAN.md</code> after the same manifest validates.</p>
      </section>
    </main>
  </body>
</html>
`;
}

export async function createDeviceValidationSessionSheet({
  origin,
  outputDir,
  modes,
  fetchImpl = fetch,
  createdAt = new Date().toISOString(),
}) {
  await mkdir(outputDir, { recursive: true });

  const sessions = [];
  for (const mode of modes) {
    sessions.push(await createRelaySession({ mode, origin, fetchImpl }));
  }

  const jsonPath = path.join(outputDir, "app-clip-device-validation-sessions.json");
  const htmlPath = path.join(outputDir, "app-clip-device-validation.html");
  const evidenceManifestPath = path.join(outputDir, "app-clip-device-evidence-manifest.json");
  const expiresAt = new Date(Date.parse(createdAt) + sessionTtlMinutes * 60 * 1000).toISOString();

  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        origin,
        createdAt,
        expiresAt,
        sessionTtlMinutes,
        sessions,
        launchMatrix,
        captureMatrix,
        evidenceChecklist,
        completionGateChecklist,
        completionEvidenceManifestTemplate,
        completionRecordTemplate,
      },
      null,
      2
    )
  );
  await writeFile(htmlPath, renderHtml({ sessions, origin, createdAt, expiresAt }));
  await writeFile(evidenceManifestPath, JSON.stringify(completionEvidenceManifestTemplate, null, 2));

  return { evidenceManifestPath, htmlPath, jsonPath, sessions };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await createDeviceValidationSessionSheet({
    origin,
    outputDir,
    modes,
  });

  console.log(`Created ${result.sessions.length} App Clip validation sessions`);
  console.log(`JSON: ${result.jsonPath}`);
  console.log(`HTML: ${result.htmlPath}`);
  console.log(`Evidence manifest: ${result.evidenceManifestPath}`);
  for (const session of result.sessions) {
    console.log(`${session.mode}: ${session.url}`);
  }
}
