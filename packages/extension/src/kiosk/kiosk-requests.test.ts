import { expect, test, vi } from "vitest";
import { fetchKioskQueue, kioskProductAdminUrl, normalizeKioskStore, setKioskRequestStatus, waitedFor } from "./kiosk-requests";

test("accepts a Shopify handle, domain, URL, or kiosk link", () => {
  expect(normalizeKioskStore(" PayMore-Taylor ")).toBe("paymore-taylor");
  expect(normalizeKioskStore("paymore-taylor.myshopify.com")).toBe("paymore-taylor");
  expect(normalizeKioskStore("https://paymore-southfield.myshopify.com/")).toBe("paymore-southfield");
  expect(normalizeKioskStore("pm.voltresale.app/paymore-taylor/requests")).toBe("paymore-taylor");
  expect(normalizeKioskStore("")).toBeNull();
  expect(normalizeKioskStore("evil.example.com")).toBeNull();
  expect(normalizeKioskStore("-bad")).toBeNull();
  expect(normalizeKioskStore("taylormi")).toBe("paymore-taylor");
  expect(normalizeKioskStore("southfieldmi")).toBe("paymore-southfield");
  expect(normalizeKioskStore("pm.voltresale.app/taylormi/requests")).toBe("paymore-taylor");
  for (const input of ["taylormi.paymore.com", "http://paymore-taylor.myshopify.com", "https://user@paymore-taylor.myshopify.com", "https://paymore-taylor.myshopify.com:8443", "https://paymore-taylor.myshopify.com/products", "pm.voltresale.app/a/other", "pm.voltresale.app/a?x=1"]) {
    expect(normalizeKioskStore(input)).toBeNull();
  }
});

const request = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, storeSlug: "paymore-taylor", productId: "12", variantId: "34", title: "PS5 Slim", variantTitle: "Default Title",
  sku: "MI01-1", imageUrl: "https://cdn.shopify.com/a.jpg", priceCents: 45000, productUrl: "https://paymore-taylor.myshopify.com/products/ps5",
  status, createdAt: 1000, updatedAt: 1000, expiresAt: 4600, ...extra,
});

test("reads the active queue and drops closed or malformed requests", async () => {
  const fetcher = vi.fn(async () => Response.json({ requests: [request("a", "waiting"), request("b", "found"), request("c", "shown"), { id: "d" }, request("e", "waiting", { imageUrl: "http://insecure/x.jpg" })], serverNow: 5000 }));
  const queue = await fetchKioskQueue("paymore-taylor", fetcher as unknown as typeof fetch);
  expect(fetcher).toHaveBeenCalledWith("https://pm.voltresale.app/api/requests?store=paymore-taylor", { cache: "no-store" });
  expect(queue.requests.map((item) => item.id)).toEqual(["a", "b", "e"]);
  expect(queue.requests[2].imageUrl).toBeNull();
  expect(queue.serverNow).toBe(5000);
});

test("surfaces the kiosk's own error message", async () => {
  const fetcher = vi.fn(async () => Response.json({ error: "Item requests are temporarily unavailable." }, { status: 503 }));
  await expect(fetchKioskQueue("paymore-taylor", fetcher as unknown as typeof fetch)).rejects.toThrow("Item requests are temporarily unavailable.");
  await expect(setKioskRequestStatus("paymore-taylor", "a", "found", fetcher as unknown as typeof fetch)).rejects.toThrow("temporarily unavailable");
});

test("sends Found and Shown as the staff page does", async () => {
  const fetcher = vi.fn(async () => Response.json({}));
  await setKioskRequestStatus("paymore-taylor", "a", "shown", fetcher as unknown as typeof fetch);
  expect(fetcher).toHaveBeenCalledWith("https://pm.voltresale.app/api/requests", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ storeSlug: "paymore-taylor", id: "a", status: "shown" }) }));
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
