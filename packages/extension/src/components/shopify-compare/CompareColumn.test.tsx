import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { ShopifyProductDetails } from "../../domain/shopify-audit";
import { CompareColumn } from "./CompareColumn";

const product: ShopifyProductDetails = {
  id: "gid://shopify/Product/1", title: "iPhone 13", status: "ACTIVE", totalInventory: 2,
  url: "https://admin.shopify.com/store/sample/products/1", images: ["https://cdn.shopify.com/a.jpg", "https://cdn.shopify.com/b.jpg"],
  currencyCode: "USD", minPrice: "199.00", maxPrice: "249.00", condition: "Used - Good", vendor: "Apple", productType: "Phones",
  descriptionHtml: "", variants: [
    { id: "v1", title: "128GB", sku: "IP13-128", price: "199.00" },
    { id: "v2", title: "256GB", sku: null, price: "249.00" },
  ],
};

test("renders a product like the Kiosk popup with condition notes split out", () => {
  const html = renderToStaticMarkup(<CompareColumn product={product} onRemove={vi.fn()} details={[
    { kind: "heading", text: "Cosmetic Condition:" },
    { kind: "paragraph", text: "Light scratches" },
    { kind: "heading", text: "Items included" },
    { kind: "list", items: ["Phone", "Cable"] },
    { kind: "specifications", rows: [{ label: "Storage", value: "128GB" }] },
  ]} />);
  expect(html).toContain("$199.00 – $249.00");
  expect(html).toContain("2 in stock");
  expect(html).toContain("Used - Good");
  expect(html).toContain("IP13-128");
  expect(html).toContain("Not provided");
  expect(html).toContain("Photo 2 of 2");
  expect(html).toMatch(/aria-label="Item condition">.*Light scratches/);
  expect(html).toMatch(/aria-label="Listing details">.*Items included.*<li>Cable<\/li>.*Storage/);
  expect(html).toContain("Remove iPhone 13 from comparison");
});

test("shows a single SKU and an empty details message", () => {
  const html = renderToStaticMarkup(<CompareColumn product={{ ...product, totalInventory: 0, variants: [product.variants[0]], minPrice: "199.00", maxPrice: "199.00" }} onRemove={vi.fn()} details={[]} />);
  expect(html).toContain("Out of stock");
  expect(html).not.toContain("–");
  expect(html).toContain("No additional details provided.");
});
