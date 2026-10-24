// Sample store data. Images are real product photos so shots look like a real
// store; they load from Wikimedia, so capturing needs a network connection.
const wikimedia = "https://upload.wikimedia.org/wikipedia/commons/thumb";

export const productImages = {
  iphone13: `${wikimedia}/0/0c/IPhone_13_vector.svg/500px-IPhone_13_vector.svg.png`,
  iphone13Pro: `${wikimedia}/b/b5/IPhone_13_Pro_vector.svg/500px-IPhone_13_Pro_vector.svg.png`,
  iphone13Mini: `${wikimedia}/8/8b/IPhone_13_Mini_Gr%C3%BCn_Freigestellt.png/500px-IPhone_13_Mini_Gr%C3%BCn_Freigestellt.png`,
  iphone13ProMax: `${wikimedia}/1/13/Back_view_of_iPhone_13_Pro_Max_Gold.jpg/500px-Back_view_of_iPhone_13_Pro_Max_Gold.jpg`,
};

export const shop = "volt-demo.myshopify.com";

const product = (id: number, title: string, totalInventory: number, price: string, sku: string, condition: string, imageUrl: string) => ({
  id: `gid://shopify/Product/${id}`,
  title,
  status: "ACTIVE",
  totalInventory,
  url: `https://admin.shopify.com/store/volt-demo/products/${id}`,
  imageUrl,
  price,
  currencyCode: "USD",
  sku,
  condition,
});

export const shopifySearchResult = {
  shop,
  products: [
    product(101, "Apple iPhone 13 128GB Midnight — Unlocked", 3, "389.00", "IP13-128-MID-A", "Used - Excellent", productImages.iphone13),
    product(102, "Apple iPhone 13 Pro 256GB Graphite — Unlocked", 1, "529.00", "IP13P-256-GR", "Used - Good", productImages.iphone13Pro),
    product(103, "Apple iPhone 13 mini 128GB Green — AT&T", 2, "279.00", "IP13M-128-GRN", "Used - Fair", productImages.iphone13Mini),
    product(104, "Apple iPhone 13 Pro Max 512GB Gold — Unlocked", 1, "689.00", "IP13PM-512-GLD", "Open Box", productImages.iphone13ProMax),
    product(105, "Apple iPhone 13 128GB Pink — Verizon (For parts)", 0, "119.00", "IP13-128-PNK-P", "For parts", productImages.iphone13),
  ],
};

/** chrome.runtime message handlers for a connected store. */
export const shopifyMessages = {
  shopifyAuditStatus: () => ({ success: true, value: { shop } }),
  shopifyAuditSearchProducts: () => ({ success: true, value: shopifySearchResult }),
};

// Yesterday's products for the Shopify audit review.
const auditTitles: Array<[string, string]> = [
  ["Nintendo Switch OLED — White", "ACTIVE"],
  ["Apple iPad 9th Gen 64GB Wi-Fi", "ACTIVE"],
  ["Sony WH-1000XM4 Wireless Headphones", "DRAFT"],
  ["PS5 DualSense Controller — Cosmic Red", "ACTIVE"],
  ["Pokémon Scarlet (Nintendo Switch)", "ACTIVE"],
  ["Xbox Series S 512GB", "UNLISTED"],
  ["Canon EOS Rebel T7 Kit 18-55mm", "DRAFT"],
  ["Apple Watch SE 40mm GPS", "ACTIVE"],
  ["Bose SoundLink Flex Speaker", "ARCHIVED"],
  ["Meta Quest 2 128GB", "ACTIVE"],
  ["Zelda: Tears of the Kingdom", "ACTIVE"],
  ["Kindle Paperwhite 11th Gen", "DRAFT"],
];

export const auditProducts = auditTitles.map(([title, status], index) => ({
  id: `gid://shopify/Product/${8800 + index}`,
  title,
  status,
  url: `https://admin.shopify.com/store/volt-demo/products/${8800 + index}`,
}));

const details = (id: number, title: string, price: string, condition: string, images: string[], cosmetic: string) => ({
  id: `gid://shopify/Product/${id}`, title, status: "ACTIVE", totalInventory: 1,
  url: `https://admin.shopify.com/store/volt-demo/products/${id}`, images,
  currencyCode: "USD", minPrice: price, maxPrice: price, condition, vendor: "PayMore", productType: "Cell Phones",
  descriptionHtml: `<h3>Cosmetic condition:</h3><p>${cosmetic}</p><h3>Functionality condition:</h3><p>Tested and fully working. Battery health 88%. Factory reset and ready to activate.</p><h3>Items included in this sale:</h3><ul><li>${title}</li><li>USB-C cable</li></ul>`,
  variants: [{ id: `gid://shopify/ProductVariant/${id}`, title: "Default Title", sku: `IP-${id}`, price }],
});

/** Product details for the compare page. */
export const compareDetails = {
  shop,
  products: [
    details(101, "Apple iPhone 13 128GB Midnight — Unlocked", "389.00", "Used - Excellent", [productImages.iphone13, productImages.iphone13Mini], "Light scratches on the frame. Screen is clean with no marks. See pictures for details."),
    details(102, "Apple iPhone 13 Pro 256GB Graphite — Unlocked", "529.00", "Used - Good", [productImages.iphone13Pro, productImages.iphone13ProMax], "Visible scuffs on the back glass and corners. Screen has minor wear. See pictures for details."),
  ],
};

const minutesAgo = (minutes: number) => Date.now() - minutes * 60_000;
const kioskRequest = (id: string, title: string, sku: string, minutes: number, status: "waiting" | "found", imageUrl: string) => ({
  id, storeSlug: "taylormi", productId: String(900 + Number(id.slice(1))), variantId: "1", title, variantTitle: "Default Title",
  sku, imageUrl, priceCents: 0, productUrl: "https://taylormi.paymore.com/products/sample", status,
  createdAt: minutesAgo(minutes), updatedAt: minutesAgo(minutes), expiresAt: minutesAgo(minutes - 60),
});

/** The kiosk's GET /api/requests response for taylormi. */
export const kioskQueue = () => ({
  serverNow: Date.now(),
  requests: [
    kioskRequest("k1", "Apple iPhone 13 Pro 256GB Graphite — Unlocked", "IP13P-256-GR", 9, "found", productImages.iphone13Pro),
    kioskRequest("k2", "Apple iPhone 13 128GB Midnight — Unlocked", "IP13-128-MID-A", 4, "waiting", productImages.iphone13),
    kioskRequest("k3", "Apple iPhone 13 mini 128GB Green — AT&T", "IP13M-128-GRN", 1, "waiting", productImages.iphone13Mini),
  ],
});
