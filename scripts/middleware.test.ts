import { describe, expect, it, vi } from "vitest";

vi.mock("@vercel/functions", () => ({ next: () => new Response() }));

import middleware, { config, handle, UNDER_CONSTRUCTION } from "../middleware";

describe("under-construction notice", () => {
  it("is switched on", () => {
    expect(UNDER_CONSTRUCTION).toBe(true);
  });

  it.each(["/", "/privacy", "/upc-search?q=123", "/shopify?shop=demo-shop.myshopify.com", "/app.html"])(
    "serves a temporary 503 notice for %s",
    async (path) => {
      const response = middleware(new Request(`https://voltresale.app${path}`));
      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("86400");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.text()).toContain("Sorry, the site is under construction");
    },
  );

  it("leaves the API proxy, app association files, robots.txt and service worker reachable", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const path of ["/", "/privacy", "/shopify", "/shopify.html", "/clip", "/app-sign-in", "/assets/index.js"]) {
      expect(matcher.test(path), path).toBe(true);
    }
    for (const path of [
      "/api/shopify/admin/status",
      "/.well-known/apple-app-site-association",
      "/apple-app-site-association",
      "/robots.txt",
      "/sw.js",
    ]) {
      expect(matcher.test(path), path).toBe(false);
    }
  });
});

describe("Shopify Admin frame policy (when the site is live)", () => {
  it("permits only the requested Shopify store and Shopify Admin", () => {
    const response = handle(new Request("https://voltresale.app/shopify?shop=demo-shop.myshopify.com"), false);
    expect(response.headers.get("Content-Security-Policy"))
      .toBe("frame-ancestors https://demo-shop.myshopify.com https://admin.shopify.com");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it.each([
    "https://voltresale.app/shopify",
    "https://voltresale.app/shopify?shop=bad.example.com",
    "https://voltresale.app/shopify?shop=demo.myshopify.com.evil.example",
  ])("refuses framing without a valid shop: %s", (url) => {
    const response = handle(new Request(url), false);
    expect(response.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
  });

  it("leaves other pages alone", () => {
    const response = handle(new Request("https://voltresale.app/privacy"), false);
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
  });
});
