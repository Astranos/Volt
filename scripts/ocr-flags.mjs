#!/usr/bin/env node
// Downloads OCR captures flagged from TestFlight builds so parsing can be reproduced locally.
//
//   node scripts/ocr-flags.mjs [--limit 50] [--out .ocr-flags] [--prod]
//
// Each flag becomes <out>/<createdAt>-<flagId>/ with photo.jpg (the capture before OCR cleanup)
// and flag.json (selected text, cleaned text, review regions and every raw recognizer region).
// Uses `npx convex run` against the deployment you're logged into; pass --prod for production.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const limit = Number(option("--limit", "50"));
const outDir = path.resolve(option("--out", ".ocr-flags"));
const deploymentArgs = process.argv.includes("--prod") ? ["--prod"] : [];

function convexRun(functionName, args) {
  const output = execFileSync(
    "npx",
    ["convex", "run", ...deploymentArgs, functionName, JSON.stringify(args)],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(output);
}

const flags = convexRun("ocrFlags:listOcrFlags", { limit });
await mkdir(outDir, { recursive: true });
let downloaded = 0;
for (const flag of flags) {
  const stamp = new Date(flag.createdAt).toISOString().replace(/[:.]/g, "-");
  const flagDir = path.join(outDir, `${stamp}-${flag.flagId}`);
  if (existsSync(path.join(flagDir, "photo.jpg"))) continue;
  await mkdir(flagDir, { recursive: true });
  await writeFile(path.join(flagDir, "flag.json"), `${JSON.stringify(flag, null, 2)}\n`);
  const url = convexRun("ocrFlags:ocrFlagPhotoUrl", { flagId: flag.flagId });
  if (!url) continue;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    console.warn(`Photo download failed for ${flag.flagId}: ${response.status}`);
    continue;
  }
  await writeFile(path.join(flagDir, "photo.jpg"), Buffer.from(await response.arrayBuffer()));
  downloaded += 1;
}
console.log(`${flags.length} flag(s) listed, ${downloaded} new photo(s) saved to ${outDir}`);
