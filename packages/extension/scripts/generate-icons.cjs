const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

// Read the scout.svg file
const scoutSVGPath = path.join(__dirname, "../public/assets/icons/scout.svg");
const scoutSVGContent = fs.readFileSync(scoutSVGPath, "utf8");

// Extract path elements from scout.svg and format them properly
const pathMatches = scoutSVGContent.match(/<path[^>]*>/g);
const scoutPaths = pathMatches
  ? pathMatches.map((p) => "    " + p.replace(/\/>/g, "/>")).join("\n")
  : "";

// Create SVG with outlined scout icon on transparent background
// The original viewBox is "0 0 400 400" so we'll scale appropriately
function createScoutSVG(size) {
  const scale = size / 400; // Scale from 400x400 viewBox to icon size (no padding)

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <g transform="scale(${scale})">
${scoutPaths
  .replace(/stroke="#000000"/g, 'stroke="#16a34a"')
  .replace(/stroke-opacity="[^"]*"/g, 'stroke-opacity="1"')
  .replace(/fill="none"/g, 'fill="none"')
  .replace(/<\?xml[^>]*>/g, "")
  .replace(/<!--[^>]*-->/g, "")}
  </g>
</svg>`;
}

async function generateIcons() {
  const sizes = [16, 32, 48, 128];
  const iconsDir = path.join(__dirname, "../public/assets/icons");

  // Ensure the directory exists
  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
  }

  console.log("Generating PNG icons with outlined green scout...");

  // Generate PNG files from SVG
  for (const size of sizes) {
    const svgContent = createScoutSVG(size);
    const pngPath = path.join(iconsDir, `icon${size}.png`);

    await sharp(Buffer.from(svgContent))
      .resize(size, size)
      .png()
      .toFile(pngPath);

    console.log(`✓ Created ${pngPath}`);
  }

  // Create brand SVG for use in popup/sidepanel
  const brandSize = 128;
  const brandSVG = createScoutSVG(brandSize);
  const brandPath = path.join(
    __dirname,
    "../public/assets/images/scout-brand.svg"
  );
  fs.writeFileSync(brandPath, brandSVG);
  console.log(`✓ Created ${brandPath}`);

  console.log("\n✓ Icons generated successfully!");
}

generateIcons().catch(console.error);
