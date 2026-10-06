import { ConvexError } from "convex/values";

export const SHOPIFY_API_VERSION = "2026-07";
export function shopDomain(input: string): string {
  const shop = input.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(shop)) {
    throw new ConvexError("Enter your store's .myshopify.com domain.");
  }
  return shop;
}
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new ConvexError("Shopify is not configured on the server.");
  return value;
}
const encoder = new TextEncoder();
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function unhex(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[a-f0-9]{2})+$/i.test(value)) throw new Error("Invalid encrypted token");
  return Uint8Array.from(value.match(/../g) ?? [], (part) => parseInt(part, 16));
}
export function nonce(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}
export async function nonceHash(value: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new ConvexError("Invalid Shopify browser nonce.");
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
async function tokenKey() {
  const key = requiredEnv("SHOPIFY_TOKEN_ENCRYPTION_KEY");
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new ConvexError("Shopify encryption key must be 32 bytes encoded as hex.");
  return crypto.subtle.importKey("raw", unhex(key), "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptToken(value: string, ownerAndShop: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(ownerAndShop) }, await tokenKey(), encoder.encode(value));
  return `${hex(iv)}.${hex(new Uint8Array(encrypted))}`;
}
export async function decryptToken(value: string, ownerAndShop: string): Promise<string> {
  const [iv, encrypted] = value.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unhex(iv), additionalData: encoder.encode(ownerAndShop) }, await tokenKey(), unhex(encrypted));
  return new TextDecoder().decode(plain);
}
export async function verifyCallback(params: URLSearchParams): Promise<{ shop: string; state: string; code: string }> {
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate callback parameters");
  const hmac = params.get("hmac") ?? "";
  if (!/^[a-f0-9]{64}$/i.test(hmac)) throw new Error("Invalid callback signature");
  const message = [...params.entries()].filter(([key]) => key !== "hmac").sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join("&");
  const key = await crypto.subtle.importKey("raw", encoder.encode(requiredEnv("SHOPIFY_CLIENT_SECRET")), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  // Web Crypto performs the MAC verification without a JavaScript string comparison.
  if (!await crypto.subtle.verify("HMAC", key, unhex(hmac), encoder.encode(message))) throw new Error("Invalid callback signature");
  const shop = shopDomain(params.get("shop") ?? "");
  const state = params.get("state") ?? "";
  const code = params.get("code") ?? "";
  if (!/^[a-f0-9]{64}$/.test(state) || !code || code.length > 4096) throw new Error("Invalid callback parameters");
  return { shop, state, code };
}

export function auditRange(startUtc: string, endUtc: string, date: string) {
  const start = Date.parse(startUtc);
  const end = Date.parse(endUtc);
  const now = Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || new Date(start).toISOString() !== startUtc || new Date(end).toISOString() !== endUtc
    || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
    || Math.abs(start - Date.parse(`${date}T00:00:00Z`)) > 14 * 3600000
    || end - start < 23 * 3600000 || end - start > 25 * 3600000
    || end < now - 25 * 3600000 || end > now + 60000) {
    throw new ConvexError("Invalid previous-day date range.");
  }
  return { start: startUtc, end: endUtc, date };
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConvexError("Shopify returned an invalid response.");
  return value as Record<string, unknown>;
}
export function string(value: unknown): string {
  if (typeof value !== "string" || !value) throw new ConvexError("Shopify returned an invalid response.");
  return value;
}
export async function exchangeToken(shop: string, fields: Record<string, string>) {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: requiredEnv("SHOPIFY_CLIENT_ID"), client_secret: requiredEnv("SHOPIFY_CLIENT_SECRET"), ...fields }),
  });
  if (!response.ok) throw new ConvexError("Shopify authorization expired or failed. Reconnect your store.");
  const data = object(await response.json());
  const scope = string(data.scope).split(",");
  if (!scope.includes("read_products") && !scope.includes("write_products")) throw new ConvexError("Shopify did not grant product read access.");
  if (typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || typeof data.refresh_token_expires_in !== "number" || !Number.isFinite(data.refresh_token_expires_in) || data.refresh_token_expires_in <= 0) throw new ConvexError("Shopify did not return an expiring offline token.");
  return { access: string(data.access_token), refresh: string(data.refresh_token), expiresAt: Date.now() + data.expires_in * 1000, refreshExpiresAt: Date.now() + data.refresh_token_expires_in * 1000 };
}
export async function graphql(shop: string, access: string, query: string, variables: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": access }, body: JSON.stringify({ query, variables }),
    });
    if (response.status === 429 || response.status >= 500) {
      if (attempt === 3) throw new ConvexError("Shopify is busy. Try again shortly.");
      const seconds = Number(response.headers.get("Retry-After"));
      await new Promise((resolve) => setTimeout(resolve, Math.min(10000, Math.max(1000 * 2 ** attempt, Number.isFinite(seconds) ? seconds * 1000 : 0))));
      continue;
    }
    if (!response.ok) throw new ConvexError(response.status === 401 || response.status === 403 ? "Shopify access is unavailable. Reconnect your store." : "Shopify request failed. Try again.");
    const body = object(await response.json());
    if (Array.isArray(body.errors) && body.errors.length) {
      const throttled = body.errors.every((error: unknown) => object(object(error).extensions).code === "THROTTLED");
      if (throttled && attempt < 3) { await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt)); continue; }
      throw new ConvexError(throttled ? "Shopify is busy. Try again shortly." : "Shopify could not read the product catalog. Check app permissions.");
    }
    return object(body.data);
  }
  throw new ConvexError("Shopify request failed.");
}
export type Product = { id: string; title: string; status: string; url: string };
export type SearchProduct = Product & {
  totalInventory: number;
  imageUrl: string | null;
  price: string | null;
  currencyCode: string | null;
  sku: string | null;
  condition: string | null;
};

export function productSearchQuery(input: string): string {
  const query = input.trim();
  if (query.length < 2 || query.length > 120) throw new ConvexError("Search for 2 to 120 characters.");
  // Keep search terms literal instead of letting input become Shopify search syntax.
  const terms = query.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)?.map(term => term.toLowerCase()) ?? [];
  if (!terms.length) throw new ConvexError("Enter a product name, SKU, or barcode.");
  terms[terms.length - 1] += "*";
  return terms.join(" ");
}

export async function fetchSearchProducts(shop: string, access: string, input: string): Promise<{ shop: string; products: SearchProduct[] }> {
  const search = productSearchQuery(input);
  const data = await graphql(shop, access, `query SearchProducts($inStock: String!, $outOfStock: String!) {
    inStock: products(first: 30, query: $inStock, sortKey: RELEVANCE) {
      nodes { ...SearchProductFields }
    }
    outOfStock: products(first: 30, query: $outOfStock, sortKey: RELEVANCE) {
      nodes { ...SearchProductFields }
    }
  }
  fragment SearchProductFields on Product {
    id legacyResourceId title status totalInventory tags
    featuredMedia { preview { image { url } } }
    priceRangeV2 { minVariantPrice { amount currencyCode } }
    conditionMetafield: metafield(namespace: "custom", key: "condition") { value }
    variants(first: 3) { nodes { sku } }
  }`, {
    inStock: `${search} status:active,archived,draft,unlisted inventory_total:>0`,
    outOfStock: `${search} status:active,archived,draft,unlisted inventory_total:<=0`,
  });
  const products: SearchProduct[] = [];
  const seen = new Set<string>();
  for (const group of [data.inStock, data.outOfStock]) {
    const nodes = object(group).nodes;
    if (!Array.isArray(nodes)) throw new ConvexError("Shopify returned an invalid product page.");
    for (const value of nodes) {
      const product = object(value);
      const id = string(product.id);
      const legacyId = string(product.legacyResourceId);
      if (!/^gid:\/\/shopify\/Product\/(\d+)$/.test(id) || id !== `gid://shopify/Product/${legacyId}`) {
        throw new ConvexError("Shopify returned an invalid product ID.");
      }
      const inventory = product.totalInventory;
      if (typeof inventory !== "number" || !Number.isSafeInteger(inventory)) throw new ConvexError("Shopify returned invalid inventory.");
      if (seen.has(id)) continue;
      const media = product.featuredMedia === null ? null : object(product.featuredMedia);
      const preview = media?.preview === null || media === null ? null : object(media.preview);
      const image = preview?.image === null || preview === null ? null : object(preview.image);
      const url = image?.url;
      const imageUrl = typeof url === "string" && /^https:\/\//i.test(url) ? url : null;
      const priceRange = product.priceRangeV2 === null || product.priceRangeV2 === undefined ? null : object(product.priceRangeV2);
      const money = priceRange?.minVariantPrice === null || priceRange === null ? null : object(priceRange.minVariantPrice);
      let price: string | null = null;
      let currencyCode: string | null = null;
      if (typeof money?.amount === "string" && /^\d+(?:\.\d+)?$/.test(money.amount)
        && typeof money.currencyCode === "string" && /^[A-Z]{3}$/.test(money.currencyCode)) {
        price = money.amount;
        currencyCode = money.currencyCode;
      }
      const variants = object(product.variants).nodes;
      if (!Array.isArray(variants)) throw new ConvexError("Shopify returned invalid variants.");
      const skus = variants.map(variant => object(variant).sku).filter((sku): sku is string => typeof sku === "string" && sku.trim().length > 0);
      const queryLower = input.trim().toLowerCase();
      const sku = (skus.find(value => value.toLowerCase().includes(queryLower)) ?? skus[0] ?? null)?.slice(0, 255) ?? null;
      const metafield = product.conditionMetafield === null ? null : object(product.conditionMetafield);
      const customCondition = typeof metafield?.value === "string" ? metafield.value.trim() : "";
      const tags = product.tags;
      if (!Array.isArray(tags)) throw new ConvexError("Shopify returned invalid product tags.");
      const conditionTag = tags.find(tag => typeof tag === "string" && /^condition\s*:/i.test(tag));
      const taggedCondition = typeof conditionTag === "string" ? conditionTag.replace(/^condition\s*:/i, "").trim() : "";
      products.push({
        id, title: string(product.title), status: string(product.status), totalInventory: inventory,
        url: `https://admin.shopify.com/store/${shop.split(".")[0]}/products/${legacyId}`, imageUrl,
        price, currencyCode,
        sku, condition: (customCondition || taggedCondition || null)?.slice(0, 200) ?? null,
      });
      seen.add(id);
    }
  }
  return { shop, products: products.sort((a, b) => Number(b.totalInventory > 0) - Number(a.totalInventory > 0)).slice(0, 30) };
}

export async function fetchYesterday(shop: string, access: string, range: { date: string; start: string; end: string }) {
  const products: Product[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const data = await graphql(shop, access, `query YesterdayProducts($search: String!, $cursor: String) {
      products(first: 250, after: $cursor, query: $search, sortKey: CREATED_AT) {
        nodes { id legacyResourceId title status }
        pageInfo { hasNextPage endCursor }
      }
    }`, { search: `created_at:>='${range.start}' created_at:<'${range.end}' status:active,archived,draft,unlisted`, cursor });
    const page = object(data.products);
    if (!Array.isArray(page.nodes)) throw new ConvexError("Shopify returned an invalid product page.");
    for (const value of page.nodes) {
      const product = object(value);
      const id = string(product.id);
      const legacyId = string(product.legacyResourceId);
      if (!/^\d+$/.test(legacyId)) throw new ConvexError("Shopify returned an invalid product ID.");
      if (!seen.has(id)) products.push({ id, title: typeof product.title === "string" ? product.title : string(product.title), status: string(product.status), url: `https://admin.shopify.com/store/${shop.split(".")[0]}/products/${legacyId}` });
      seen.add(id);
    }
    const info = object(page.pageInfo);
    if (typeof info.hasNextPage !== "boolean") throw new ConvexError("Shopify returned invalid pagination.");
    const next = info.hasNextPage ? string(info.endCursor) : null;
    if (next !== null && next === cursor) throw new ConvexError("Shopify pagination did not advance.");
    cursor = next;
  } while (cursor !== null);
  return { shop, date: range.date, products };
}
