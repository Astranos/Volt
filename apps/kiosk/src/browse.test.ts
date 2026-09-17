import { describe, expect, it } from "vitest";
import {
  browseProducts,
  initialFilters,
  money,
  productPrice,
  routeSlug,
  storeSlugFromInput,
} from "./browse";
import type { Product } from "./catalog";

const phone: Product = {
  id: "1",
  title: "Apple iPhone 13",
  category: "Phones",
  condition: "Good",
  priceCents: 19900,
  priceMaxCents: 24900,
  description: "Unlocked blue phone",
  details: [{ kind: 'paragraph', text: 'Unlocked blue phone' }],
  publishedAt: "2026-09-01T00:00:00Z",
  images: [],
  url: "https://taylormi.paymore.com/products/phone",
  variants: [{ id: "v1", title: "Blue", priceCents: 19900, sku: 'MI01-8773A-E9' }],
};
const tablet: Product = {
  ...phone,
  id: "2",
  title: "Apple iPad",
  category: "Tablets",
  priceCents: 9900,
  priceMaxCents: 9900,
  description: "Silver tablet",
  publishedAt: "2026-09-02T00:00:00Z",
};
describe("kiosk browsing", () => {
  it('turns a PayMore address into a local store route only', () => {
    expect(storeSlugFromInput('https://southfieldmi.paymore.com/')).toBe('southfieldmi');
    expect(storeSlugFromInput('SOUTHFIELDMI.paymore.com')).toBe('southfieldmi');
    expect(storeSlugFromInput('taylormi')).toBe('taylormi');
    for (const input of ['https://evil.example/', 'https://a.b.paymore.com/', 'https://user@taylormi.paymore.com/', 'https://taylormi.paymore.com:8443/', 'https://taylormi.paymore.com/products/item', 'javascript:alert(1)', 'https://taylormi.paymore.com/?next=evil']) {
      expect(storeSlugFromInput(input)).toBeNull();
    }
  });
  it('finds the exact inventory SKU', () => {
    expect(browseProducts([phone], { ...initialFilters, query: 'mi01-8773a-e9' })).toEqual([phone]);
  });
  it("matches all search words across title and description", () => {
    expect(
      browseProducts([phone, tablet], {
        ...initialFilters,
        query: "APPLE blue",
      }).map((item) => item.id),
    ).toEqual(["1"]);
  });
  it("combines budget and category", () => {
    expect(
      browseProducts([phone, tablet], {
        ...initialFilters,
        budget: 10000,
        category: "Phones",
      }),
    ).toEqual([]);
  });
  it("sorts without mutating the source", () => {
    const source = [phone, tablet];
    expect(
      browseProducts(source, initialFilters).map((item) => item.id),
    ).toEqual(["2", "1"]);
    expect(source[0]).toBe(phone);
    expect(browseProducts(source, { ...initialFilters, sort: "high" })[0]).toBe(
      phone,
    );
  });
  it("formats price ranges honestly", () => {
    expect(productPrice(phone)).toBe("From $199");
    expect(productPrice(tablet)).toBe("$99");
    expect(money(9999)).toBe("$99.99");
  });
  it("allows a single public slug only", () => {
    expect(routeSlug("/taylormi/")).toBe("taylormi");
    expect(routeSlug("/")).toBeNull();
    expect(routeSlug("/taylormi/products")).toBeNull();
    expect(routeSlug("/https://example.com")).toBeNull();
  });
});
