export function paymoreProductHtml(options: {
  title: string;
  gameName?: string;
  platform?: string;
  upc?: string;
  extraRows?: Array<[string, string]>;
}): string {
  const rows = [
    ["Collection", "Video Game"],
    ["Platform", options.platform ?? ""],
    ["Game Name", options.gameName ?? options.title],
    ["UPC", options.upc ?? ""],
    ...(options.extraRows ?? []),
  ]
    .filter(([, value]) => value)
    .map(
      ([label, value]) =>
        `<tr><td>${label}</td><td>${value} <div style="color:red; font-weight: bold;"></div></td></tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html>
  <head>
    <title>${options.title} – PayMore Rockville</title>
    <link rel="canonical" href="https://rockvillemd.paymore.com/products/example" />
  </head>
  <body>
    <h1 id="Titleeditor">${options.title}</h1>
    <div class="shopify-auto">
      <h2>Specifications:</h2>
      <table border="1">
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  </body>
</html>`;
}

export const CLAIR_OBSCUR_HTML = paymoreProductHtml({
  title: "New Clair Obscur: Expedition 33 [Lumiere Edition] (Sony PlayStation 5 PS5, 2025)",
  gameName: "Clair Obscur: Expedition 33 [Lumiere Edition]",
  platform: "Sony PlayStation 5 PS5",
  upc: "810145310328",
  extraRows: [
    ["Publisher", "Sandfall Interactive"],
    ["Genre", "RPG"],
    ["Rating", "M - Mature 17+"],
    ["Release Year", "2025"],
    ["Condition", "New"],
  ],
});

export const GALAXIAN_HTML = paymoreProductHtml({
  title: "Galaxian (Atari 5200, 1981)",
  gameName: "Galaxian",
  platform: "Atari 5200",
  upc: "077000052063",
  extraRows: [
    ["Publisher", "Atari"],
    ["Genre", "Arcade"],
    ["Condition", "Acceptable"],
  ],
});

export const MARIO_HTML = paymoreProductHtml({
  title: "Super Mario Bros (Nintendo NES, 1985) Cartridge Only",
  gameName: "Super Mario Bros",
  platform: "Nintendo NES",
  upc: "074299009129",
  extraRows: [
    ["Publisher", "Nintendo"],
    ["Genre", "Platformer"],
    ["Condition", "Acceptable"],
  ],
});

export const INVALID_UPC_HTML = paymoreProductHtml({
  title: "Unknown Prototype (Nintendo Switch, 2026)",
  gameName: "Unknown Prototype",
  platform: "Nintendo Switch",
  upc: "036000291453",
});

export const MISSING_UPC_HTML = paymoreProductHtml({
  title: "PayMore Stores Bargain Bin Video Games",
  gameName: "Bargain Bin Video Games",
  platform: "Mixed",
});

export const GALAXIAN_JSON_LD_HTML = `<!doctype html>
<html>
  <head>
    <title>Galaxian (Atari 5200, 1981) – PayMore Anaheim</title>
    <script type="application/ld+json">
      {"@type":"Product","name":"Galaxian (Atari 5200, 1981)","gtin12":"077000052063"}
    </script>
  </head>
  <body>
    <h1>Galaxian (Atari 5200, 1981)</h1>
  </body>
</html>`;

export const IPHONE_HTML = `<!doctype html>
<html>
  <head>
    <title>T-Mobile Apple iPhone 17 256GB Lavender MG494LL/A – PayMore Pooler</title>
  </head>
  <body>
    <p>SKU: GA02-6162A-C2R1</p>
    <h1>T-Mobile Apple iPhone 17 256GB Lavender MG494LL/A</h1>
    <h2>Specifications:</h2>
    <table>
      <tbody>
        <tr><td>Collection</td><td>Apple iPhone</td></tr>
        <tr><td>Brand</td><td>Apple</td></tr>
        <tr><td>Model</td><td>iPhone 17</td></tr>
        <tr><td>MPN</td><td>MG494LL/A</td></tr>
        <tr><td>Sim Card Slot</td><td>eSIM</td></tr>
        <tr><td>Storage Size</td><td>256GB</td></tr>
        <tr><td>Condition</td><td>Good</td></tr>
        <tr><td>iOS Version</td><td>26.5.1</td></tr>
        <tr><td>Screen Size</td><td>6.3"</td></tr>
        <tr><td>Lock Status</td><td>Network Locked</td></tr>
        <tr><td>Carrier Service</td><td>T-Mobile</td></tr>
        <tr><td>Color</td><td>Lavender</td></tr>
        <tr><td>IMEI</td><td>356305885491194</td></tr>
        <tr><td>Battery Health</td><td>100%</td></tr>
        <tr><td>Cycle Count</td><td>6</td></tr>
        <tr><td>MFG Warranty?</td><td>No</td></tr>
        <tr><td>UPC</td><td>195950642834</td></tr>
        <tr><td>Serial#</td><td>DR66HK6QDP</td></tr>
      </tbody>
    </table>
  </body>
</html>`;

