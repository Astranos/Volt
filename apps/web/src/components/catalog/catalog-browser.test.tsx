import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { CatalogResult } from "../../lib/catalog";
import {
  CatalogContent,
  CatalogError,
  CatalogErrorBoundary,
  type CatalogContentProps,
} from "./catalog-browser";
import { CatalogResults } from "./catalog-results";
import { CatalogCompare, toggleComparison } from "./catalog-compare";

function row(upc: string): CatalogResult {
  return {
    upc,
    title: `Phone ${upc}`,
    brand: "Apple",
    model: null,
    mpn: null,
    color: null,
    storage: "128 GB",
    carrier: null,
    platform: null,
    edition: null,
    updatedAt: 1,
  };
}
const noop = () => {};
const props: CatalogContentProps = {
  products: [row("1")],
  status: "Exhausted",
  searchQuery: "",
  onSearch: noop,
  selectedUpc: null,
  onSelect: noop,
  product: undefined,
  onLoadMore: noop,
};

describe("catalog browser", () => {
  test("renders useful tools without auth providers and labels loaded-result scope", () => {
    const html = renderToStaticMarkup(<CatalogContent {...props} />);
    expect(html).toContain("Product catalog");
    expect(html).toContain("Sort loaded rows");
    expect(html).toContain("Export loaded rows");
    expect(html).toContain("1 shown of 1 loaded");
    expect(html).toContain("Select a product");
    expect(html).toContain("price or stock");
  });
  test("loading hides stale rows and disables export", () => {
    const html = renderToStaticMarkup(
      <CatalogContent {...props} status="LoadingFirstPage" />,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("Phone 1");
    expect(html).toContain("Loading products");
    expect(html).toMatch(/disabled=""[^>]*>.*?Export loaded rows/s);
  });
  test("empty search still offers pagination when available", () => {
    const html = renderToStaticMarkup(
      <CatalogContent
        {...props}
        products={[]}
        status="CanLoadMore"
        searchQuery="nothing"
      />,
    );
    expect(html).toContain("No matching products");
    expect(html).toContain("Clear search and filters");
    expect(html).toContain("Load 25 more products");
  });
  test("filtered empty state explains how to recover", () => {
    const html = renderToStaticMarkup(
      <CatalogResults
        products={[]}
        loading={false}
        selectedUpc={null}
        comparison={[]}
        onSelect={noop}
        onCompare={noop}
        hasSearch={false}
        hasFilters
        onReset={noop}
      />,
    );
    expect(html).toContain("No loaded products match these filters");
    expect(html).toContain("load more results below");
  });
  test("selection uses UPC and full comparison disables only unselected rows", () => {
    const html = renderToStaticMarkup(
      <CatalogResults
        products={[row("1"), row("4")]}
        loading={false}
        selectedUpc="1"
        comparison={[row("1"), row("2"), row("3")]}
        onSelect={noop}
        onCompare={noop}
        hasSearch={false}
        hasFilters={false}
        onReset={noop}
      />,
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toMatch(/disabled=""[^>]*aria-label="Compare Phone 4"/);
    expect(html).toContain('aria-label="Compare Phone 1"');
  });
  test("error boundary exposes a sanitized retry page", () => {
    expect(CatalogErrorBoundary.getDerivedStateFromError()).toEqual({
      failed: true,
    });
    const html = renderToStaticMarkup(<CatalogError retry={noop} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Try again");
    expect(html).not.toContain("ConvexError");
    expect(html).not.toContain("subscription");
  });
});

describe("catalog comparison", () => {
  test("retains snapshots, caps at three, and toggles by UPC", () => {
    const first = row("1");
    const selected = [first, row("2"), row("3")];
    expect(toggleComparison(selected, row("4"))).toBe(selected);
    expect(toggleComparison(selected, { ...first, title: "Renamed" })).toEqual(
      selected.slice(1),
    );
    expect(toggleComparison([], first)).toEqual([first]);
    expect(selected).toHaveLength(3);
  });
  test("renders absent facts honestly and exposes removal actions", () => {
    const html = renderToStaticMarkup(
      <CatalogCompare
        products={[row("1"), row("2")]}
        onRemove={noop}
        onClear={noop}
      />,
    );
    expect(html).toContain("2/3");
    expect(html).toContain("Not provided");
    expect(html).toContain("Remove Phone 1 from comparison");
    expect(html).toContain("Clear comparison");
  });
});
