import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("./app-providers", () => ({ authConfigured: false }));

import { SiteFooter, SiteHeader } from "../site-chrome";

describe("public discovery navigation", () => {
  test("makes UPC search discoverable without an account", () => {
    const header = renderToStaticMarkup(<SiteHeader />);
    const footer = renderToStaticMarkup(<SiteFooter />);
    expect(header).toContain('href="/upc-search"');
    expect(header).toContain("UPC search");
    expect(footer).toContain('href="/upc-search"');
    expect(footer).toContain("Free UPC search");
  });

  test("keeps the scanner header focused on support", () => {
    const header = renderToStaticMarkup(<SiteHeader variant="scanner" />);
    expect(header).not.toContain('href="/upc-search"');
    expect(header).toContain("Support");
  });
});
