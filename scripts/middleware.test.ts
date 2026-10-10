import { describe, expect, it, vi } from "vitest";

vi.mock("@vercel/functions", () => ({ next: () => new Response() }));

import middleware, { config } from "../middleware";

describe("Shopify Admin frame policy", () => {
  it("permits only the requested Shopify store and Shopify Admin", () => {
    const response = middleware(new Request("https://voltresale.app/shopify?shop=demo-shop.myshopify.com"));
    expect(response.headers.get("Content-Security-Policy"))
      .toBe("frame-ancestors https://demo-shop.myshopify.com https://admin.shopify.com");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(config.matcher).toContain("/shopify.html");
  });

  it.each([
    "https://voltresale.app/shopify",
    "https://voltresale.app/shopify?shop=bad.example.com",
    "https://voltresale.app/shopify?shop=demo.myshopify.com.evil.example",
  ])("refuses framing without a valid shop: %s", (url) => {
    const response = middleware(new Request(url));
    expect(response.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
  });
});
