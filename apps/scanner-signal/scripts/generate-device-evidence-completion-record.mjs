import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  evidenceManifestPathFromArgv,
  resolveEvidenceManifestPath,
  validateEvidenceManifest,
} from "./validate-device-evidence-manifest.mjs";

function listItems(values) {
  return values.map((value) => `- ${value}`).join("\n");
}

function gateSummaryItems(gates) {
  return gates
    .map(
      (gate) =>
        `- ${gate.gate}: ${gate.status} (${gate.evidence.length} artifacts)\n  Pass criteria: ${gate.passCriteria}`
    )
    .join("\n");
}

function artifactPathsForGate(manifest, gateName) {
  const gate = manifest.gates.find((candidate) => candidate.gate === gateName);
  return gate.evidence.map((item) => item.artifactPath);
}

export function formatCompletionRecordMarkdown(manifest) {
  const errors = validateEvidenceManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`Cannot generate completion record from invalid manifest:\n- ${errors.join("\n- ")}`);
  }

  const record = manifest.completionRecord;
  return `### Completion Evidence - ${record.validationDate}

- Validation run: ${manifest.validationRunId}
- Evidence archive: ${manifest.artifactDirectory}
- Device: ${record.deviceModel}, ${record.iosVersion}
- Browser: ${record.browserVersion}
- Extension: ${record.extensionVersion}
- App build: ${record.appBuild}
- App Clip thinned size: ${record.appThinningSizeValue}
- App thinning report: ${record.appThinningSizeReport}

Completion gates:

${gateSummaryItems(manifest.gates)}

App Store Connect evidence:

${listItems(record.appStoreConnectEvidence)}

Apple app-thinning evidence:

${listItems(artifactPathsForGate(manifest, "appleThinnedAppClipSize"))}

Physical iPhone launch evidence:

${listItems(record.launchEvidence)}

Chrome capture and insertion evidence:

${listItems(record.captureAndInsertionEvidence)}
`;
}

export async function readAndFormatCompletionRecord(pathname) {
  const manifest = JSON.parse(await readFile(pathname, "utf8"));
  return formatCompletionRecordMarkdown(manifest);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifestPath = resolveEvidenceManifestPath(evidenceManifestPathFromArgv());

  try {
    process.stdout.write(await readAndFormatCompletionRecord(manifestPath));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
