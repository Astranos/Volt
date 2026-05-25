import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveEvidenceManifestPath,
} from "../../scanner-signal/scripts/validate-device-evidence-manifest.mjs";
import { readAndFormatCompletionRecord } from "../../scanner-signal/scripts/generate-device-evidence-completion-record.mjs";

const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const defaultPlanPath = path.join(repoRoot, "apps/mobile/APP_CLIP_IMPLEMENTATION_PLAN.md");
const insertionHeading = "### Current Completion Gate Status";
const completionHeadingPattern = /^### Completion Evidence - .+$/m;

export function upsertCompletionRecordSection(planMarkdown, completionRecordMarkdown) {
  const normalizedRecord = completionRecordMarkdown.trimEnd();
  const existingMatch = planMarkdown.match(completionHeadingPattern);

  if (existingMatch?.index !== undefined) {
    const nextHeadingIndex = planMarkdown.indexOf("\n### ", existingMatch.index + existingMatch[0].length);
    const replaceEnd = nextHeadingIndex >= 0 ? nextHeadingIndex : planMarkdown.length;
    return `${planMarkdown.slice(0, existingMatch.index).trimEnd()}\n\n${normalizedRecord}\n\n${planMarkdown
      .slice(replaceEnd)
      .trimStart()}`;
  }

  const insertionIndex = planMarkdown.indexOf(`\n${insertionHeading}`);
  if (insertionIndex < 0) {
    throw new Error(`Could not find insertion heading: ${insertionHeading}`);
  }

  return `${planMarkdown.slice(0, insertionIndex).trimEnd()}\n\n${normalizedRecord}\n${planMarkdown.slice(
    insertionIndex
  )}`;
}

export async function applyCompletionRecord({
  manifestPath,
  planPath = defaultPlanPath,
  check = false,
} = {}) {
  if (typeof manifestPath !== "string" || manifestPath.trim() === "") {
    throw new Error(
      "App Clip completion record update requires an evidence manifest path. Pass -- <manifest.json> or set APP_CLIP_EVIDENCE_MANIFEST."
    );
  }
  const completionRecord = await readAndFormatCompletionRecord(resolveEvidenceManifestPath(manifestPath));
  const currentPlan = await readFile(planPath, "utf8");
  const updatedPlan = upsertCompletionRecordSection(currentPlan, completionRecord);
  if (!check) await writeFile(planPath, updatedPlan);
  return { changed: updatedPlan !== currentPlan, check, planPath, updatedPlan };
}

export function parseApplyCompletionRecordOptions(argv = process.argv.slice(2)) {
  const args = argv.filter((arg) => arg !== "--");
  return {
    check: args.includes("--check"),
    manifestPath: args.find((arg) => arg !== "--check") || process.env.APP_CLIP_EVIDENCE_MANIFEST,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseApplyCompletionRecordOptions();

  try {
    const result = await applyCompletionRecord(options);
    console.log(
      result.check
        ? `Validated App Clip completion record update for ${result.planPath}`
        : `Updated App Clip completion record in ${result.planPath}`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
