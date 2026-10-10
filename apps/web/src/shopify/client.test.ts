import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getShopStatus, getYesterday, searchProducts } from "./client";

const range = { date: "2026-10-01", startUtc: "2026-10-01T04:00:00.000Z", endUtc: "2026-10-02T04:00:00.000Z" };
const idToken = vi.fn<() => Promise<string>>();

beforeEach(() => {
  vi.stubEnv("DEV", false);
  idToken.mockReset().mockResolvedValue("test-session-token");
  vi.stubGlobal("window", { shopify: { idToken } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("embedded Shopify product requests", () => {
  test.each([
    { path: "status", call: () => getShopStatus(), payload: { shop: "example.myshopify.com" } },
    { path: "yesterday", call: () => getYesterday(range), payload: { shop: "example.myshopify.com", date: range.date, products: [] } },
    { path: "search", call: () => searchProducts("phone"), payload: { shop: "example.myshopify.com", products: [] } },
  ])("$path stays on the app origin and recovers from a failed fetch", async ({ path, call, payload }) => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.json(payload));
    vi.stubGlobal("fetch", fetcher);
    await expect(call()).resolves.toEqual(payload);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe(`/api/shopify/admin/${path}`);
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe("Bearer test-session-token");
    expect(idToken).toHaveBeenCalledTimes(2);
  });

  test("retries an expired session with a newly obtained token", async () => {
    idToken.mockResolvedValueOnce("expired-test-token").mockResolvedValueOnce("fresh-test-token");
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: "Invalid Shopify ID token" }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ shop: "example.myshopify.com", products: [] }));
    vi.stubGlobal("fetch", fetcher);
    await searchProducts("phone");
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe("Bearer fresh-test-token");
  });

  test("persistent network failures are bounded and give an actionable message", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetcher);
    await expect(getYesterday(range)).rejects.toThrow("Check your connection and retry");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("permission failures are preserved without retrying", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "Shopify did not grant product read access." }, { status: 403 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(searchProducts("phone")).rejects.toThrow("product read access");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("cancelled searches do not retry or send another token", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(searchProducts("phone", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(idToken).toHaveBeenCalledTimes(1);
  });
});
