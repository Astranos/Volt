import { expect, test, vi } from "vitest";
import { fetchKioskQueue, kioskProductAdminUrl, normalizeKioskStore, setKioskRequestStatus, waitedFor } from "./kiosk-requests";

test("accepts a store name, its PayMore site, or its kiosk link", () => {
  expect(normalizeKioskStore(" TaylorMI ")).toBe("taylormi");
  expect(normalizeKioskStore("taylormi.paymore.com")).toBe("taylormi");
  expect(normalizeKioskStore("https://southfieldmi.paymore.com/products")).toBe("southfieldmi");
  expect(normalizeKioskStore("pm.voltresale.app/taylormi/requests")).toBe("taylormi");
  expect(normalizeKioskStore("")).toBeNull();
  expect(normalizeKioskStore("evil.example.com")).toBeNull();
  expect(normalizeKioskStore("-bad")).toBeNull();
});

const request = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, storeSlug: "taylormi", productId: "12", variantId: "34", title: "PS5 Slim", variantTitle: "Default Title",
  sku: "MI01-1", imageUrl: "https://cdn.shopify.com/a.jpg", priceCents: 45000, productUrl: "https://taylormi.paymore.com/products/ps5",
  status, createdAt: 1000, updatedAt: 1000, expiresAt: 4600, ...extra,
});

test("reads the active queue and drops closed or malformed requests", async () => {
  const fetcher = vi.fn(async () => Response.json({ requests: [request("a", "waiting"), request("b", "found"), request("c", "shown"), { id: "d" }, request("e", "waiting", { imageUrl: "http://insecure/x.jpg" })], serverNow: 5000 }));
  const queue = await fetchKioskQueue("taylormi", fetcher as unknown as typeof fetch);
  expect(fetcher).toHaveBeenCalledWith("https://pm.voltresale.app/api/requests?store=taylormi", { cache: "no-store" });
  expect(queue.requests.map((item) => item.id)).toEqual(["a", "b", "e"]);
  expect(queue.requests[2].imageUrl).toBeNull();
  expect(queue.serverNow).toBe(5000);
});

test("surfaces the kiosk's own error message", async () => {
  const fetcher = vi.fn(async () => Response.json({ error: "Item requests are temporarily unavailable." }, { status: 503 }));
  await expect(fetchKioskQueue("taylormi", fetcher as unknown as typeof fetch)).rejects.toThrow("Item requests are temporarily unavailable.");
  await expect(setKioskRequestStatus("taylormi", "a", "found", fetcher as unknown as typeof fetch)).rejects.toThrow("temporarily unavailable");
});

test("sends Found and Shown as the staff page does", async () => {
  const fetcher = vi.fn(async () => Response.json({}));
  await setKioskRequestStatus("taylormi", "a", "shown", fetcher as unknown as typeof fetch);
  expect(fetcher).toHaveBeenCalledWith("https://pm.voltresale.app/api/requests", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ storeSlug: "taylormi", id: "a", status: "shown" }) }));
});

test("links to the product in the connected Shopify admin", () => {
  expect(kioskProductAdminUrl("paymore-taylor.myshopify.com", "12")).toBe("https://admin.shopify.com/store/paymore-taylor/products/12");
  expect(kioskProductAdminUrl(null, "12")).toBeNull();
});

test("waiting times read naturally", () => {
  expect(waitedFor(20_000)).toBe("just now");
  expect(waitedFor(4 * 60_000)).toBe("4 min");
  expect(waitedFor(65 * 60_000)).toBe("1 hr 5 min");
});
