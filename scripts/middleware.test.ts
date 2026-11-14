import { describe, expect, it, vi } from "vitest";

vi.mock("@vercel/functions", () => ({ next: () => new Response() }));

import middleware, { config } from "../middleware";

describe("Donut account-domain compatibility", () => {
  it.each(["sign-in", "sign-up", "dashboard", "settings", "handbook", "scanner-results", "clip", "clip.html", "app-sign-in", "app-sign-in.html"])(
    "keeps %s on the existing trusted auth origin and preserves the query",
    (path) => {
      const response = middleware(new Request(`https://donut.juanquenga.com/${path}?code=example&view=photos`));
      expect(response.status).toBe(307);
      expect(response.headers.get("Location")).toBe(`https://voltresale.app/${path}?code=example&view=photos`);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    },
  );

  it.each([
    "https://voltresale.app/dashboard",
    "https://voltresale.app/app-sign-in",
    "https://donut.juanquenga.com/",
    "https://donut.juanquenga.com/privacy",
    "https://donut.juanquenga.com/.well-known/apple-app-site-association",
    "https://donut.juanquenga.com.evil.example/dashboard",
  ])("does not redirect %s", (url) => {
    expect(middleware(new Request(url)).headers.get("Location")).toBeNull();
  });
});

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
