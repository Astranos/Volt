import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { CatalogProduct } from "../../lib/catalog";
import { ProductDetail } from "./product-detail";

const product: CatalogProduct = {
  upc: "123456789012", title: "Pocket console", platform: null,
  edition: null, collection: null, brand: null, model: null, mpn: null,
  color: null, storage: null, carrier: null, publisher: null, genre: null,
  rating: null, releaseYear: null, attributes: {}, upcs: ["123456789012"], collections: [],
  sourceUrls: [], listings: [], createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
};

describe("catalog product research", () => {
  test("renders loading and unavailable without querying authentication", () => {
    expect(renderToStaticMarkup(<ProductDetail product={undefined} />)).toContain("Loading product details");
    expect(renderToStaticMarkup(<ProductDetail product={null} />)).toContain("Product details unavailable");
  });

  test("explains missing catalog data and retains useful identifier actions", () => {
    const html = renderToStaticMarkup(<ProductDetail product={product} />);
    expect(html).toContain("No product photos");
    expect(html).toContain("No specifications have been imported");
    expect(html).toContain("No source links available");
    expect(html).toContain('aria-label="Copy UPC"');
    expect(html).toContain("Copy spec summary");
    expect(html).not.toContain('aria-label="Copy MPN"');
    expect(html).not.toContain("Also indexed under");
    expect(html).not.toContain("null");
  });

  test("shows rich facts, aliases, gallery and deduplicated safe source links", () => {
    const html = renderToStaticMarkup(<ProductDetail product={{
      ...product,
      brand: "Nintendo", mpn: "HDH-001", publisher: "Nintendo", genre: "Adventure",
      rating: "E", releaseYear: "2020", attributes: { "Screen size": "5.5 inches" },
      collection: "Consoles", collections: ["Consoles", "Handheld"],
      upcs: [product.upc, "123456789013", "123456789013"],
      sourceUrls: ["https://example.com/listing", "https://other.example.com/item", "javascript:alert(1)"],
      listings: [
        { sourceUrl: "https://example.com/listing", imageUrl: "https://example.com/front.jpg", updatedAt: product.updatedAt },
        { sourceUrl: "https://example.com/listing", imageUrl: "https://example.com/back.jpg" },
        { sourceUrl: "javascript:alert(2)", imageUrl: "javascript:alert(3)" },
      ],
    }} />);
    for (const value of ["Publisher", "Genre", "Release year", "Screen size", "5.5 inches", "Handheld", "Also indexed under", "Import date unavailable", "Imported", "Reference data only"]) {
      expect(html).toContain(value);
    }
    expect(html).toContain('aria-label="View photo 2"');
    expect(html).toContain('aria-label="Copy MPN"');
    expect(html.match(/aria-label="Copy UPC 123456789013"/g)).toHaveLength(1);
    expect(html.match(/href="https:\/\/example.com\/listing"/g)).toHaveLength(1);
    expect(html).toContain('href="https://other.example.com/item"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("$0");
  });
});
