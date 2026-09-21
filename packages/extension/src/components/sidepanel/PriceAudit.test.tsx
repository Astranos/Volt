import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AuditAssessment, AuditSnapshot, ItemResult } from "../../price-audit/types";

vi.mock("../../price-audit/runner", () => ({ runPriceAudit: vi.fn() }));
vi.mock("./SidepanelLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
import PriceAudit, { PriceAuditResult, serializePriceAudit } from "./PriceAudit";

function result(assessment: AuditAssessment): ItemResult {
  return {
    item: { id: "item", title: "Camera <script>", variant: "Black", sku: "CAM", description: "Used", url: "https://shop.example/products/camera", priceCents: 12000, currency: "USD" },
    comparables: [{ id: "123", url: "https://www.ebay.com/itm/123", text: "Sold used camera", priceCents: 10000, confidence: 0.9 }],
    assessment, searchUrl: "https://www.ebay.com/sch/i.html?LH_Sold=1&LH_Complete=1", checkedAt: "2026-09-21T00:00:00Z", note: "Search reached page cap.",
  };
}

describe("price audit UI", () => {
  it("starts disabled with explicit consent, USD, privacy and coverage notices", () => {
    const markup = renderToStaticMarkup(<PriceAudit />);
    expect(markup).toContain('type="password"');
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain('type="submit" disabled=""');
    expect(markup).toContain("TypeSafe AI/Jev");
    expect(markup).toContain("API charges may apply");
    expect(markup).toContain("use USD prices");
    expect(markup).toContain("switching tools ends the scan");
    expect(markup).toContain("at least 3 confident unique sold matches");
    expect(markup).toContain("exclude shipping and tax");
    expect(markup).toContain("not all historical eBay sales");
  });

  it.each([
    ["high", "Too high"], ["low", "Too low"], ["fair", "Just right"],
  ] as const)("shows %s price findings, exact dollars, and expandable source evidence", (kind, label) => {
    const markup = renderToStaticMarkup(<PriceAuditResult result={result({ kind, medianCents: 10000, lowCents: 8500, highCents: 11500, differencePercent: 20 })} />);
    expect(markup).toContain(label);
    expect(markup).toContain("$120.00 USD");
    expect(markup).toContain("$100.00 USD");
    expect(markup).toContain("+20.0% vs. sold median");
    expect(markup).toContain("<details>");
    expect(markup).toContain("https://www.ebay.com/itm/123");
    expect(markup).toContain("Search reached page cap.");
    expect(markup).toContain("Camera &lt;script&gt;");
    expect(markup).not.toContain("<script>");
  });

  it("shows insufficient evidence without implying a market valuation", () => {
    const markup = renderToStaticMarkup(<PriceAuditResult result={result({ kind: "insufficient", reason: "Only one confident match." })} />);
    expect(markup).toContain("Insufficient evidence");
    expect(markup).toContain("Only one confident match.");
    expect(markup).not.toContain("Sold median:");
    expect(markup).not.toContain("Fair band:");
  });

  it("exports settings, partial coverage and observed evidence without credentials", () => {
    const snapshot: AuditSnapshot = { status: "stopped", phase: "Stopped", processed: 1, total: 4, requests: 3, catalogComplete: true, results: [result({ kind: "insufficient", reason: "Only one confident match." })], error: null, startedAt: "2026-09-21T00:00:00Z" };
    const text = serializePriceAudit(snapshot, { storeUrl: "https://shop.example", tolerancePercent: 15, maxSearchPages: 2 });
    const exported = JSON.parse(text);
    expect(exported.snapshot.status).toBe("stopped");
    expect(exported.snapshot.results[0].comparables[0].id).toBe("123");
    expect(exported.settings.maxSearchPages).toBe(2);
    expect(exported.coverage).toContain("not all historical sales");
    expect(text).not.toContain("apiKey");
    expect(text).not.toContain("password");
  });
});
