import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);

const requiredGates = [
  "appStoreConnectAdvancedExperiences",
  "appleThinnedAppClipSize",
  "physicalIphoneLaunch",
  "chromeCaptureInsertion",
];
const requiredEvidenceByGate = new Map([
  [
    "appStoreConnectAdvancedExperiences",
    [
      "app-store-connect-advanced-experiences.png",
      "app-store-connect-ocr-url.png",
      "app-store-connect-barcode-url.png",
      "app-store-connect-dictation-url.png",
    ],
  ],
  [
    "appleThinnedAppClipSize",
    [
      "app-clip-archive-summary.png",
      "app-clip-app-thinning-size-report.txt",
      "app-store-connect-app-clip-size.png",
    ],
  ],
  [
    "physicalIphoneLaunch",
    [
      "iphone-no-full-app-ocr-launch.mov",
      "iphone-no-full-app-barcode-launch.mov",
      "iphone-no-full-app-dictation-launch.mov",
      "iphone-full-app-installed-routing.mov",
    ],
  ],
  [
    "chromeCaptureInsertion",
    [
      "ocr-input-insertion.mov",
      "barcode-textarea-insertion.mov",
      "dictation-contenteditable-insertion.mov",
      "password-field-clipboard-fallback.mov",
      "restricted-page-clipboard-fallback.mov",
      "expired-session-retry-state.png",
      "close-qr-disconnect-state.png",
    ],
  ],
]);
const requiredPassCriteriaByGate = new Map([
  [
    "appStoreConnectAdvancedExperiences",
    "All three /clip/:mode URLs are configured as Advanced App Clip Experiences for com.volt.mobile.Clip on scanner-signal.vercel.app.",
  ],
  [
    "appleThinnedAppClipSize",
    "The uncompressed thinned iPhone App Clip variant is within Apple's supported size limit for the deployment target and QR invocation flow.",
  ],
  [
    "physicalIphoneLaunch",
    "Each launch matrix row opens the App Clip or routes correctly, and the opened screen matches the requested mode.",
  ],
  [
    "chromeCaptureInsertion",
    "OCR, barcode, and dictation results reach the original Chrome target, with clipboard fallback for restricted targets and clear recovery states for timeout/close flows.",
  ],
]);
const requiredCompletionRecordFields = [
  "validationDate",
  "deviceModel",
  "iosVersion",
  "browserVersion",
  "extensionVersion",
  "appBuild",
  "appThinningSizeValue",
];
const placeholderValuesByField = new Map([
  ["artifactDirectory", new Set(["path-or-url-to-archived-evidence"])],
  ["validationDate", new Set(["YYYY-MM-DD"])],
  ["deviceModel", new Set(["iPhone model"])],
  ["iosVersion", new Set(["iOS version"])],
  ["browserVersion", new Set(["Chrome version"])],
  ["extensionVersion", new Set(["Volt extension version/build"])],
  ["appBuild", new Set(["App Store/TestFlight build"])],
  ["appThinningSizeValue", new Set(["Uncompressed thinned App Clip size"])],
  ["appThinningSizeReport", new Set(["app-clip-app-thinning-size-report.txt"])],
]);

function isFilledString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isPlaceholderValue(field, value) {
  return placeholderValuesByField.get(field)?.has(value.trim()) ?? false;
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function listIncludesEvidence(evidenceList, filename) {
  return evidenceList.some((value) => typeof value === "string" && value.includes(filename));
}

function capturedArtifactPathsForGate(manifest, gateName) {
  const gate = Array.isArray(manifest.gates)
    ? manifest.gates.find((candidate) => candidate?.gate === gateName)
    : null;
  if (!Array.isArray(gate?.evidence)) return new Map();

  return new Map(
    gate.evidence
      .filter((item) => item?.captured === true && isFilledString(item.artifactPath))
      .map((item) => [item.filename, item.artifactPath])
  );
}

function listIncludesArtifactPath(evidenceList, artifactPath) {
  return evidenceList.some((value) => value === artifactPath);
}

function artifactPathIsInsideDirectory(artifactPath, artifactDirectory) {
  if (!isFilledString(artifactPath) || !isFilledString(artifactDirectory)) return false;
  const normalizedDirectory = artifactDirectory.trim().replace(/\/+$/, "");
  return artifactPath.trim().startsWith(`${normalizedDirectory}/`);
}

function artifactPathMatchesFilename(artifactPath, filename) {
  return isFilledString(artifactPath) && isFilledString(filename) && artifactPath.trim().endsWith(`/${filename}`);
}

function isConcreteThinnedAppClipSizeValue(value) {
  return (
    typeof value === "string" &&
    /\b\d+(?:\.\d+)?\s*MB\b/i.test(value) &&
    /\buncompressed\b/i.test(value) &&
    /\bthinned\b/i.test(value) &&
    /\bApp Clip\b/i.test(value)
  );
}

function validationRunIdForDate(validationDate) {
  return `${validationDate}-app-clip-validation`;
}

export function validateEvidenceManifest(manifest) {
  const errors = [];

  if (!manifest || typeof manifest !== "object") {
    return ["Manifest must be a JSON object."];
  }

  if (manifest.status !== "passed") {
    errors.push("Manifest status must be passed.");
  }

  if (typeof manifest.validationRunId !== "string" || manifest.validationRunId.trim() === "") {
    errors.push("Manifest must include validationRunId.");
  }

  if (typeof manifest.artifactDirectory !== "string" || manifest.artifactDirectory.trim() === "") {
    errors.push("Manifest must include artifactDirectory.");
  } else if (isPlaceholderValue("artifactDirectory", manifest.artifactDirectory)) {
    errors.push("Manifest artifactDirectory must replace the template placeholder.");
  }

  if (!manifest.completionRecord || typeof manifest.completionRecord !== "object") {
    errors.push("Manifest must include completionRecord.");
  } else {
    for (const field of requiredCompletionRecordFields) {
      if (!isFilledString(manifest.completionRecord[field])) {
        errors.push(`Completion record must include ${field}.`);
      } else if (isPlaceholderValue(field, manifest.completionRecord[field])) {
        errors.push(`Completion record ${field} must replace the template placeholder.`);
      }
    }

    if (
      isFilledString(manifest.completionRecord.validationDate) &&
      !isPlaceholderValue("validationDate", manifest.completionRecord.validationDate) &&
      !isIsoDate(manifest.completionRecord.validationDate)
    ) {
      errors.push("Completion record validationDate must use YYYY-MM-DD.");
    }

    if (
      isIsoDate(manifest.completionRecord.validationDate) &&
      isFilledString(manifest.validationRunId) &&
      !manifest.validationRunId.startsWith(`${manifest.completionRecord.validationDate}-`)
    ) {
      errors.push("Manifest validationRunId must start with completion record validationDate.");
    } else if (
      isIsoDate(manifest.completionRecord.validationDate) &&
      isFilledString(manifest.validationRunId) &&
      manifest.validationRunId !== validationRunIdForDate(manifest.completionRecord.validationDate)
    ) {
      errors.push("Manifest validationRunId must use YYYY-MM-DD-app-clip-validation.");
    }

    if (
      isIsoDate(manifest.completionRecord.validationDate) &&
      isFilledString(manifest.artifactDirectory) &&
      !isPlaceholderValue("artifactDirectory", manifest.artifactDirectory) &&
      !manifest.artifactDirectory.includes(manifest.completionRecord.validationDate)
    ) {
      errors.push("Manifest artifactDirectory must include completion record validationDate.");
    }

    if (
      isFilledString(manifest.completionRecord.appThinningSizeValue) &&
      !isPlaceholderValue("appThinningSizeValue", manifest.completionRecord.appThinningSizeValue) &&
      !isConcreteThinnedAppClipSizeValue(manifest.completionRecord.appThinningSizeValue)
    ) {
      errors.push(
        "Completion record appThinningSizeValue must include a numeric MB uncompressed thinned App Clip size."
      );
    }

    for (const field of ["appStoreConnectEvidence", "launchEvidence", "captureAndInsertionEvidence"]) {
      if (!Array.isArray(manifest.completionRecord[field]) || manifest.completionRecord[field].length === 0) {
        errors.push(`Completion record must include ${field}.`);
      }
    }

    if (!isFilledString(manifest.completionRecord.appThinningSizeReport)) {
      errors.push("Completion record must include appThinningSizeReport.");
    } else if (isPlaceholderValue("appThinningSizeReport", manifest.completionRecord.appThinningSizeReport)) {
      errors.push("Completion record appThinningSizeReport must include the captured report artifact path.");
    }

    const completionEvidenceChecks = [
      [
        "appStoreConnectEvidence",
        "appStoreConnectAdvancedExperiences",
        requiredEvidenceByGate.get("appStoreConnectAdvancedExperiences"),
      ],
      ["launchEvidence", "physicalIphoneLaunch", requiredEvidenceByGate.get("physicalIphoneLaunch")],
      [
        "captureAndInsertionEvidence",
        "chromeCaptureInsertion",
        requiredEvidenceByGate.get("chromeCaptureInsertion"),
      ],
    ];

    for (const [field, gateName, filenames] of completionEvidenceChecks) {
      if (!Array.isArray(manifest.completionRecord[field]) || manifest.completionRecord[field].length === 0) {
        continue;
      }
      const artifactPathsByFilename = capturedArtifactPathsForGate(manifest, gateName);
      const expectedArtifactPaths = new Set(
        (filenames ?? []).map((filename) => artifactPathsByFilename.get(filename)).filter(Boolean)
      );
      const canCheckUnexpectedArtifactPaths = expectedArtifactPaths.size === (filenames ?? []).length;
      const seenCompletionEvidence = new Map();
      for (const artifactPath of manifest.completionRecord[field]) {
        if (typeof artifactPath !== "string") {
          errors.push(`Completion record ${field} must contain artifact path strings.`);
          continue;
        }
        seenCompletionEvidence.set(artifactPath, (seenCompletionEvidence.get(artifactPath) ?? 0) + 1);
        if (canCheckUnexpectedArtifactPaths && !expectedArtifactPaths.has(artifactPath)) {
          errors.push(`Completion record ${field} has unexpected artifact path: ${artifactPath}.`);
        }
      }
      for (const [artifactPath, count] of seenCompletionEvidence.entries()) {
        if (count > 1) {
          errors.push(`Completion record ${field} has duplicate artifact path: ${artifactPath}.`);
        }
      }
      for (const filename of filenames ?? []) {
        if (!listIncludesEvidence(manifest.completionRecord[field], filename)) {
          errors.push(`Completion record ${field} must include ${filename}.`);
          continue;
        }

        const artifactPath = artifactPathsByFilename.get(filename);
        if (artifactPath && !listIncludesArtifactPath(manifest.completionRecord[field], artifactPath)) {
          errors.push(`Completion record ${field} must include captured artifact path for ${filename}.`);
        }
      }
    }

    if (
      isFilledString(manifest.completionRecord.appThinningSizeReport) &&
      !isPlaceholderValue("appThinningSizeReport", manifest.completionRecord.appThinningSizeReport) &&
      !manifest.completionRecord.appThinningSizeReport.includes("app-clip-app-thinning-size-report.txt")
    ) {
      errors.push("Completion record appThinningSizeReport must reference app-clip-app-thinning-size-report.txt.");
    }

    const sizeArtifactPath = capturedArtifactPathsForGate(manifest, "appleThinnedAppClipSize").get(
      "app-clip-app-thinning-size-report.txt"
    );
    if (
      sizeArtifactPath &&
      isFilledString(manifest.completionRecord.appThinningSizeReport) &&
      !isPlaceholderValue("appThinningSizeReport", manifest.completionRecord.appThinningSizeReport) &&
      manifest.completionRecord.appThinningSizeReport !== sizeArtifactPath
    ) {
      errors.push(
        "Completion record appThinningSizeReport must match the captured app-thinning report artifact path."
      );
    }
  }

  if (!Array.isArray(manifest.gates)) {
    errors.push("Manifest gates must be an array.");
    return errors;
  }

  const gatesByName = new Map(manifest.gates.map((gate) => [gate?.gate, gate]));
  const requiredGateSet = new Set(requiredGates);
  const gateCounts = new Map();
  for (const gate of manifest.gates) {
    gateCounts.set(gate?.gate, (gateCounts.get(gate?.gate) ?? 0) + 1);
    if (!requiredGateSet.has(gate?.gate)) {
      errors.push(`Unexpected gate: ${gate?.gate ?? "(missing gate)"}.`);
    }
  }
  for (const [gateName, count] of gateCounts.entries()) {
    if (count > 1) {
      errors.push(`Duplicate gate: ${gateName ?? "(missing gate)"}.`);
    }
  }

  for (const gateName of requiredGates) {
    const gate = gatesByName.get(gateName);
    if (!gate) {
      errors.push(`Missing gate: ${gateName}.`);
      continue;
    }

    if (gate.status !== "passed") {
      errors.push(`Gate ${gateName} status must be passed.`);
    }

    if (gate.passCriteria !== requiredPassCriteriaByGate.get(gateName)) {
      errors.push(`Gate ${gateName} passCriteria must match the generated checklist.`);
    }

    if (!Array.isArray(gate.evidence) || gate.evidence.length === 0) {
      errors.push(`Gate ${gateName} must include evidence.`);
      continue;
    }

    const requiredEvidence = requiredEvidenceByGate.get(gateName) ?? [];
    const requiredEvidenceSet = new Set(requiredEvidence);
    const evidenceByFilename = new Map(gate.evidence.map((item) => [item?.filename, item]));
    const evidenceCounts = new Map();
    for (const item of gate.evidence) {
      evidenceCounts.set(item?.filename, (evidenceCounts.get(item?.filename) ?? 0) + 1);
    }
    for (const [filename, count] of evidenceCounts.entries()) {
      if (count > 1) {
        errors.push(`Gate ${gateName} has duplicate evidence ${filename ?? "(missing filename)"}.`);
      }
    }
    for (const filename of requiredEvidence) {
      if (!evidenceByFilename.has(filename)) {
        errors.push(`Gate ${gateName} missing required evidence ${filename}.`);
      }
    }

    for (const item of gate.evidence) {
      const filename = typeof item?.filename === "string" ? item.filename : "(missing filename)";
      if (!requiredEvidenceSet.has(item?.filename)) {
        errors.push(`Gate ${gateName} has unexpected evidence ${filename}.`);
      }
      if (item?.captured !== true) {
        errors.push(`Evidence ${gateName}/${filename} must be marked captured with boolean true.`);
      }
      if (typeof item?.notes !== "string") {
        errors.push(`Evidence ${gateName}/${filename} notes must be a string.`);
      }
      if (typeof item?.artifactPath !== "string" || item.artifactPath.trim() === "") {
        errors.push(`Evidence ${gateName}/${filename} must include artifactPath.`);
      } else if (!artifactPathIsInsideDirectory(item.artifactPath, manifest.artifactDirectory)) {
        errors.push(`Evidence ${gateName}/${filename} artifactPath must be inside artifactDirectory.`);
      } else if (!artifactPathMatchesFilename(item.artifactPath, filename)) {
        errors.push(`Evidence ${gateName}/${filename} artifactPath must end with filename.`);
      }
    }
  }

  return errors;
}

export async function readAndValidateEvidenceManifest(pathname) {
  const manifest = JSON.parse(await readFile(pathname, "utf8"));
  return validateEvidenceManifest(manifest);
}

export function resolveEvidenceManifestPath(pathname) {
  if (path.isAbsolute(pathname)) return pathname;
  if (pathname.startsWith("apps/")) return path.join(repoRoot, pathname);
  return pathname;
}

export function evidenceManifestPathFromArgv(argv = process.argv.slice(2)) {
  return argv.find((arg) => arg !== "--") || process.env.APP_CLIP_EVIDENCE_MANIFEST || ".tmp/app-clip-device-evidence-manifest.json";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifestPath = resolveEvidenceManifestPath(evidenceManifestPathFromArgv());
  const errors = await readAndValidateEvidenceManifest(manifestPath);

  if (errors.length > 0) {
    console.error(`App Clip evidence manifest failed validation: ${manifestPath}`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(`App Clip evidence manifest passed validation: ${manifestPath}`);
}
