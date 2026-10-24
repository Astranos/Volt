/** The kiosk's public JSON API, shared with the in-store web portal and the iPad app. */
export const KIOSK_API_BASE = "https://pm.voltresale.app";
/** chrome.storage.sync key for the kiosk store whose requests the new tab shows. */
export const KIOSK_STORE_KEY = "kioskStoreSlug";

export type KioskRequestStatus = "waiting" | "found" | "shown" | "given" | "cleared";
/** What staff can set; every one but "found" closes the request. */
export type KioskStaffStatus = Exclude<KioskRequestStatus, "waiting">;
export type KioskRequest = {
  id: string;
  productId: string;
  variantId: string;
  title: string;
  variantTitle: string;
  sku: string | null;
  imageUrl: string | null;
  priceCents: number;
  status: KioskRequestStatus;
  createdAt: number;
  expiresAt: number;
};
export type KioskQueue = { requests: KioskRequest[]; serverNow: number };

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** "taylormi", "taylormi.paymore.com", or a kiosk link like "pm.voltresale.app/taylormi" → "taylormi". */
export function normalizeKioskStore(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;
  if (SLUG.test(value)) return value;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    const paymore = /^([a-z0-9-]+)\.paymore\.com$/.exec(url.hostname)?.[1];
    const kioskPath = url.hostname === new URL(KIOSK_API_BASE).hostname ? url.pathname.split("/")[1] : undefined;
    const slug = paymore ?? kioskPath;
    return slug && SLUG.test(slug) ? slug : null;
  } catch {
    return null;
  }
}

const STATUSES: readonly KioskRequestStatus[] = ["waiting", "found", "shown", "given", "cleared"];

function parseRequest(value: unknown): KioskRequest | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const text = (key: string) => (typeof item[key] === "string" ? item[key] as string : null);
  const id = text("id");
  const productId = text("productId");
  const title = text("title");
  const status = item.status as KioskRequestStatus;
  if (!id || !productId || !/^\d+$/.test(productId) || !title || !STATUSES.includes(status)
    || typeof item.createdAt !== "number" || typeof item.expiresAt !== "number") return null;
  const image = text("imageUrl");
  return {
    id, productId, title, status,
    variantId: text("variantId") ?? "",
    variantTitle: text("variantTitle") ?? "",
    sku: text("sku"),
    imageUrl: image && image.startsWith("https://") ? image : null,
    priceCents: typeof item.priceCents === "number" ? item.priceCents : 0,
    createdAt: item.createdAt,
    expiresAt: item.expiresAt,
  };
}

async function readJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : null;
    throw new Error(message ?? `Kiosk requests failed (${response.status}).`);
  }
  return body;
}

/** Active (waiting or found) requests for a store, oldest first. */
export async function fetchKioskQueue(store: string, fetcher: typeof fetch = fetch): Promise<KioskQueue> {
  const body = await readJson(await fetcher(`${KIOSK_API_BASE}/api/requests?store=${encodeURIComponent(store)}`, { cache: "no-store" }));
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (!Array.isArray(record.requests) || typeof record.serverNow !== "number") throw new Error("Kiosk requests returned an invalid response.");
  const requests = record.requests.map(parseRequest).filter((item): item is KioskRequest => item !== null)
    .filter((item) => item.status === "waiting" || item.status === "found");
  return { requests, serverNow: record.serverNow };
}

export async function setKioskRequestStatus(store: string, id: string, status: KioskStaffStatus, fetcher: typeof fetch = fetch): Promise<void> {
  await readJson(await fetcher(`${KIOSK_API_BASE}/api/requests`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storeSlug: store, id, status }),
  }));
}

/** Shopify admin page for a requested product, given the connected shop (e.g. paymore-taylor.myshopify.com). */
export function kioskProductAdminUrl(shop: string | null, productId: string): string | null {
  const handle = shop?.replace(/\.myshopify\.com$/, "");
  return handle && /^[a-z0-9-]+$/.test(handle) && /^\d+$/.test(productId) ? `https://admin.shopify.com/store/${handle}/products/${productId}` : null;
}

/** "just now", "4 min", "1 hr 5 min". */
export function waitedFor(milliseconds: number): string {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}
