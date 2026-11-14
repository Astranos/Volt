import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(path.join(root, "packages/extension/package.json"));
const sharp = require("sharp");
const check = process.argv.includes("--check");
const source = path.join(root, "assets/brand");

if (process.argv.includes("--render-native")) {
  if (check) throw new Error("Use --render-native separately from --check.");
  execFileSync(
    "/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool",
    [path.join(source, "donut.icon"), "--export-image", "--output-file", path.join(source, "donut-app-icon.png"),
      "--platform", "iOS", "--rendition", "Default", "--width", "1024", "--height", "1024", "--scale", "1", "--design-generation", "27"],
    { stdio: "inherit" },
  );
}

const mark = await fs.readFile(path.join(source, "donut.svg"), "utf8");
const content = mark.match(/<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/)?.[1];
if (!content) throw new Error("Expected a standalone donut SVG.");
const appSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 64 64" fill="none" role="img" aria-label="Donut">\n  <rect width="64" height="64" rx="14" fill="#09090B"/>\n  <g transform="translate(32 32) scale(1.12) translate(-32 -32)">${content}</g>\n</svg>\n`;
const outputs = new Map();
const add = (name, value) => outputs.set(name, Buffer.isBuffer(value) ? value : Buffer.from(value));
const nativePng = await fs.readFile(path.join(source, "donut-app-icon.png"));

for (const name of ["apps/web/public/favicon.svg", "apps/web/public/app-icon.svg"]) add(name, appSvg);
for (const name of [
  "apps/web/public/brand/donut.svg",
  "packages/extension/public/assets/icons/logo-hd.svg",
  "apps/mobile/ios/Volt/Images.xcassets/VoltLogo.imageset/logo-hd.svg",
]) add(name, mark);

for (const size of [16, 32, 48, 128, 1024]) {
  add(`packages/extension/public/assets/icons/logo-${size}.png`, await sharp(nativePng).resize(size, size).png().toBuffer());
}
add("packages/extension/public/assets/icons/logo.png", await sharp(Buffer.from(mark)).resize(100, 100).png().toBuffer());
add("apps/web/public/assets/volt.webp", await sharp(Buffer.from(mark)).resize(100, 100).webp({ lossless: true }).toBuffer());
for (const size of [192, 512]) {
  add(`apps/web/public/app-icon-${size}.png`, await sharp(nativePng).resize(size, size).png().toBuffer());
}
const opaque = await sharp(nativePng).flatten({ background: "#000000" }).png().toBuffer();
for (const name of [
  "apps/mobile/ios/Volt/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png",
  "apps/mobile/ios/VoltClip/ClipAssets.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png",
  "assets/shopify-app-store/volt-resale-icon.png",
]) add(name, opaque);

const nativeSource = "assets/brand/donut.icon";
const nativeDestination = "apps/mobile/ios/Volt/volt.icon";
const walk = async (dir) => {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, dir), { withFileTypes: true })) {
    const name = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await walk(name));
    else files.push(name);
  }
  return files;
};
for (const name of await walk(nativeSource)) {
  add(name.replace(nativeSource, nativeDestination), await fs.readFile(path.join(root, name)));
}

let stale = 0;
for (const [name, expected] of outputs) {
  const target = path.join(root, name);
  if (check) {
    const actual = await fs.readFile(target).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!actual?.equals(expected)) {
      console.error(`Out of date: ${name}`);
      stale += 1;
    }
  } else {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, expected);
  }
}

const oldNativeLogo = path.join(root, nativeDestination, "Assets/logo-hd.png");
if (check) {
  if (await fs.stat(oldNativeLogo).catch(() => null)) {
    console.error("Legacy native Volt logo still exists.");
    stale += 1;
  }
} else {
  await fs.rm(oldNativeLogo, { force: true });
}
if (stale) process.exitCode = 1;
else console.log(`${check ? "Verified" : "Generated"} ${outputs.size} Donut brand assets.`);
