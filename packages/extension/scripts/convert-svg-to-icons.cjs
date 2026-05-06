const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

// Read the SVG from the tsx file
const svgFilePath = path.join(
  __dirname,
  "../public/assets/icons/convert-this-to-extension-images.tsx"
);
const svgFileContent = fs.readFileSync(svgFilePath, "utf8");

// Extract the SVG content
const svgMatch = svgFileContent.match(/<svg[^>]*>[\s\S]*?<\/svg>/);
if (!svgMatch) {
  console.error("Could not find SVG in the file");
  process.exit(1);
}

const originalSVG = svgMatch[0];

// Create a properly formatted SVG function
function createIconSVG(size) {
  // The original viewBox is "0 0 24 24", so we'll scale it properly
  // Set fill to black for a solid icon (currentColor doesn't work in PNG generation)
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path d="m3.497 14.044 7.022-7.021a4.946 4.946 0 0 0 1.474-3.526A4.99 4.99 0 0 0 10.563 0L3.54 7.024a4.945 4.945 0 0 0-1.473 3.525c0 1.373.55 2.6 1.43 3.496zm17.007-4.103-7.023 7.022a4.946 4.946 0 0 0-1.473 3.525c0 1.36.55 2.601 1.43 3.497l7.022-7.022a4.943 4.943 0 0 0 1.474-3.526c0-1.373-.55-2.6-1.43-3.496zm-.044-2.904a4.944 4.944 0 0 0 1.474-3.525c0-1.36-.55-2.6-1.43-3.497L3.54 16.965A4.986 4.986 0 0 0 3.497 24Z" fill="#000000" stroke="#000000" stroke-width="0"/>
</svg>`;
}

async function generateIcons() {
  const sizes = [16, 32, 48, 128];
  const iconsDir = path.join(__dirname, "../public/assets/icons");

  // Ensure the directory exists
  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
  }

  console.log("Generating PNG icons from SVG...");

  // Generate PNG files from SVG
  for (const size of sizes) {
    const svgContent = createIconSVG(size);
    const pngPath = path.join(iconsDir, `logo-${size}.png`);

    await sharp(Buffer.from(svgContent))
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 }, // Transparent background
      })
      .png()
      .toFile(pngPath);

    console.log(`✓ Created ${pngPath}`);
  }

  // Also create logo.png (typically 128x128)
  const defaultSvg = createIconSVG(128);
  const defaultPngPath = path.join(iconsDir, "logo.png");
  await sharp(Buffer.from(defaultSvg))
    .resize(128, 128, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(defaultPngPath);

  console.log(`✓ Created ${defaultPngPath}`);
  console.log("\n✓ Icons generated successfully!");
}

generateIcons().catch(console.error);

