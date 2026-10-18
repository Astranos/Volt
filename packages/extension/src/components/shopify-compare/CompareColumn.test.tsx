import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { ShopifyProductDetails } from "../../domain/shopify-audit";
import { buildCompareModel } from "../../shopify-compare/compare-model";
import type { DetailBlock } from "../../shopify-compare/listing";
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

function render(products: ShopifyProductDetails[], details: DetailBlock[] = []) {
  const model = buildCompareModel(products, () => details);
  return renderToStaticMarkup(
    <CompareColumn facts={model.facts} hasDetails={model.hasDetails} hasNotes={model.hasNotes} index={0} item={model.items[0]} onRemove={vi.fn()} specs={model.specs} />,
  );
}

test("renders a product like the Kiosk popup with condition notes and aligned specs", () => {
  const html = render([product], [
    { kind: "heading", text: "Cosmetic Condition:" },
    { kind: "paragraph", text: "Light scratches" },
    { kind: "heading", text: "Items included" },
    { kind: "list", items: ["Phone", "Cable"] },
    { kind: "specifications", rows: [{ label: "Storage", value: "128GB" }] },
  ]);
  expect(html).toContain("$199.00 – $249.00");
  expect(html).toContain("2 in stock");
  expect(html).toContain("Used - Good");
  expect(html).toContain("Copy SKU IP13-128");
  expect(html).toContain("No SKU");
  expect(html).toContain("Photo 2 of 2");
  expect(html).toMatch(/aria-label="Item condition">.*Light scratches/);
  expect(html).toMatch(/aria-label="Listing details">.*Items included.*<li>Cable<\/li>/);
  expect(html).toMatch(/Specifications<\/h3>.*Storage.*128GB/);
  expect(html).toContain("Remove iPhone 13 from comparison");
});

test("shows a single SKU, out of stock, and the lowest price badge", () => {
  const single = { ...product, totalInventory: 0, variants: [product.variants[0]], minPrice: "199.00", maxPrice: "199.00" };
  const html = render([single, { ...product, id: "2", minPrice: "300.00" }]);
  expect(html).toContain("Out of stock");
  expect(html).not.toContain("–");
  expect(html).toContain("Lowest price");
  expect(html).not.toContain("Listing details");
});
