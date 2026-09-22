import { readFileSync, readdirSync } from "node:fs";

const viewsDirectory = new URL("../ios/VoltClip/Views/", import.meta.url);

export function readClipView(name) {
  return readFileSync(new URL(name, viewsDirectory), "utf8");
}

// These are static wiring contracts, not substitutes for native runtime tests.
// Read the whole view module for cross-file presence/absence assertions.
export function readClipViewSources() {
  return readdirSync(viewsDirectory)
    .filter((name) => name.endsWith(".swift"))
    .sort()
    .map(readClipView)
    .join("\n");
}
