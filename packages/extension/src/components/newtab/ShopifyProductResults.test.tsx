import React from "react";
import { Command } from "cmdk";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { ShopifyCompareTray, ShopifyProductResults } from "./ShopifyProductResults";

test("shows stock, price, condition, and SKU in Shopify result cards", () => {
  const html = renderToStaticMarkup(<Command shouldFilter={false}><Command.List>
    <ShopifyProductResults
      query="camera"
      state={{ kind: "ready", query: "camera", result: { shop: "sample.myshopify.com", products: [
        { id: "gid://shopify/Product/1", title: "Canon EOS", status: "ACTIVE", totalInventory: 3, url: "https://admin.shopify.com/store/sample/products/1", imageUrl: null, price: "299.99", currencyCode: "USD", sku: "CANON-1", condition: "Used - Good" },
      ] } }}
      onOpenProduct={vi.fn()}
      onHideProduct={vi.fn()}
      compareIds={new Set(["gid://shopify/Product/1"])}
      compareFull={false}
      onToggleCompare={vi.fn()}
      onRetry={vi.fn()}
      onOpenSettings={vi.fn()}
    />
  </Command.List></Command>);
  expect(html).toContain("Canon EOS");
  expect(html).toContain("SKU CANON-1");
  expect(html).toContain("From $299.99");
  expect(html).toContain("3 in stock");
  expect(html).toContain("Used - Good");
  expect(html).toContain("Hide Canon EOS from results");
  expect(html).toContain("Remove Canon EOS from compare");
  expect(html).toContain('aria-pressed="true"');
});

test("compare tray needs at least two products", () => {
  const product = { id: "gid://shopify/Product/1", title: "Canon EOS", status: "ACTIVE", totalInventory: 3, url: "https://admin.shopify.com/store/sample/products/1", imageUrl: null, price: null, currencyCode: null, sku: null, condition: null };
  const one = renderToStaticMarkup(<ShopifyCompareTray products={[product]} onRemove={vi.fn()} onClear={vi.fn()} onCompare={vi.fn()} />);
  expect(one).toMatch(/<button[^>]*disabled=""[^>]*>.*Compare 1/);
  const two = renderToStaticMarkup(<ShopifyCompareTray products={[product, { ...product, id: "gid://shopify/Product/2", title: "Nikon Z" }]} onRemove={vi.fn()} onClear={vi.fn()} onCompare={vi.fn()} />);
  expect(two).not.toContain('disabled=""');
  expect(two).toContain("Nikon Z");
});
