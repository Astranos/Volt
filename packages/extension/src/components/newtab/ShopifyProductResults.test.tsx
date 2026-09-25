import React from "react";
import { Command } from "cmdk";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { ShopifyProductResults } from "./ShopifyProductResults";

test("shows stock, price, condition, and SKU in Shopify result cards", () => {
  const html = renderToStaticMarkup(<Command shouldFilter={false}><Command.List>
    <ShopifyProductResults
      query="camera"
      state={{ kind: "ready", query: "camera", result: { shop: "sample.myshopify.com", products: [
        { id: "gid://shopify/Product/1", title: "Canon EOS", status: "ACTIVE", totalInventory: 3, url: "https://admin.shopify.com/store/sample/products/1", imageUrl: null, price: "299.99", currencyCode: "USD", sku: "CANON-1", condition: "Used - Good" },
      ] } }}
      onOpenProduct={vi.fn()}
      onRetry={vi.fn()}
      onOpenSettings={vi.fn()}
    />
  </Command.List></Command>);
  expect(html).toContain("Canon EOS");
  expect(html).toContain("SKU CANON-1");
  expect(html).toContain("From $299.99");
  expect(html).toContain("3 in stock");
  expect(html).toContain("Used - Good");
});
