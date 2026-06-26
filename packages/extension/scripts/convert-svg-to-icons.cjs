const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const repoRoot = path.resolve(__dirname, "../../..");
const sourceSvgPath = path.join(repoRoot, "apps/web/public/favicon.svg");
const sourceSvg = fs.readFileSync(sourceSvgPath, "utf8");

async function generateIcons() {
  const sizes = [16, 32, 48, 128, 1024];
  const iconsDir = path.join(__dirname, "../public/assets/icons");

  // Ensure the directory exists
  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
  }

  console.log("Generating PNG icons from SVG...");

  // Generate PNG files from SVG
  for (const size of sizes) {
    const pngPath = path.join(iconsDir, `logo-${size}.png`);

    await sharp(Buffer.from(sourceSvg))
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(pngPath);

    console.log(`✓ Created ${pngPath}`);
  }

  // Also create logo.png for in-extension UI references.
  const defaultPngPath = path.join(iconsDir, "logo.png");
  await sharp(Buffer.from(sourceSvg))
    .resize(100, 100, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(defaultPngPath);

  console.log(`✓ Created ${defaultPngPath}`);
  console.log("\n✓ Icons generated successfully!");
}

generateIcons().catch(console.error);
