import { mkdir, writeFile } from "node:fs/promises";

const source = "https://use.hugeicons.com/font";
const [cssResponse, fontResponse] = await Promise.all([
  fetch(`${source}/icons.css`),
  fetch(`${source}/hgi-stroke-rounded.woff2`),
]);
if (!cssResponse.ok || !fontResponse.ok) {
  throw new Error("Could not download the free Hugeicons font and icon catalog.");
}

const css = await cssResponse.text();
const icons = [...css.matchAll(/\.hgi-stroke\.hgi-([\w-]+)::before\s*\{\s*content:\s*"\\([0-9a-f]+)";/g)]
  .map((match) => [match[1], Number.parseInt(match[2], 16)]);
if (icons.length < 5_000 || new Set(icons.map(([name]) => name)).size !== icons.length) {
  throw new Error("The Hugeicons catalog format changed or contains duplicate names.");
}

const catalogPath = new URL("../src/domain/hugeicon-catalog.ts", import.meta.url);
const fontPath = new URL("../public/assets/fonts/hugeicons-stroke-rounded.woff2", import.meta.url);
await mkdir(new URL("../public/assets/fonts/", import.meta.url), { recursive: true });
await writeFile(
  catalogPath,
  `// Free Hugeicons Stroke Rounded font catalog from ${source}/icons.css.\n`
    + `// Regenerate with: node packages/extension/scripts/update-hugeicons-font.mjs\n`
    + `export const HUGEICON_CATALOG: ReadonlyArray<readonly [string, number]> = [\n`
    + icons.map(([name, codepoint]) => `  [${JSON.stringify(name)}, 0x${codepoint.toString(16)}],`).join("\n")
    + `\n];\n`,
);
await writeFile(fontPath, Buffer.from(await fontResponse.arrayBuffer()));
process.stdout.write(`Saved ${icons.length} free Hugeicons.\n`);
