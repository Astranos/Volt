import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AuditAssessment, AuditSnapshot, ItemResult } from "../../price-audit/types";

vi.mock("../../price-audit/runner", () => ({ runPriceAudit: vi.fn() }));
const auth = vi.hoisted(() => ({ isAuthenticated: false, isLoading: false }));
const clerk = vi.hoisted(() => ({ signedIn: false }));
vi.mock("../access/ExtensionAccess", () => ({ useSidepanelSignedIn: () => clerk.signedIn }));
vi.mock("convex/react", () => ({ useConvex: () => ({}), useConvexAuth: () => auth }));
vi.mock("../../price-audit/remote-decisions", () => ({ createRemoteAuditDecisions: vi.fn() }));
vi.mock("./SidepanelLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
import PriceAudit, { configuredAudit, PriceAuditResult, PriceAuditStore, serializePriceAudit } from "./PriceAudit";

function result(assessment: AuditAssessment): ItemResult {
  return {
    item: { id: "item", title: "Camera <script>", variant: "Black", sku: "CAM", description: "Used", url: "https://shop.example/products/camera", priceCents: 12000, currency: "USD" },
    comparables: [{ id: "123", url: "https://www.ebay.com/itm/123", text: "Sold used camera", priceCents: 10000, matchProbability: 0.9, decisionConfidence: 0.8 }],
    assessment, searchUrl: "https://www.ebay.com/sch/i.html?LH_Sold=1&LH_Complete=1", checkedAt: "2026-09-21T00:00:00Z", note: "Search reached page cap.",
  };
}

describe("price audit UI", () => {
  it("keeps setup in Settings and starts disabled without saved configuration", () => {
    const markup = renderToStaticMarkup(<PriceAudit />);
    expect(markup).not.toContain('type="password"');
    expect(markup).not.toContain("API key");
    expect(markup).toContain('type="button" disabled=""');
    expect(markup).not.toContain("<input");
    expect(markup).toContain("No store configured");
    expect(markup).toContain('aria-label="Open price audit settings"');
    expect(markup).not.toContain("API charges");
    expect(markup).toContain("Sign in using the account control");
    expect(markup).toContain("price-audit-content");
    expect(markup).not.toContain("Comparison settings");
    expect(markup).not.toContain("Coverage &amp; session limits");
  });

  it("keeps start disabled while checking account and until consent is given", () => {
    auth.isLoading = true;
    expect(renderToStaticMarkup(<PriceAudit />)).toContain("Checking your account");
    auth.isLoading = false;
    auth.isAuthenticated = true;
    const markup = renderToStaticMarkup(<PriceAudit />);
    expect(markup).not.toContain("Sign in using the account control");
    expect(markup).toContain('type="button" disabled=""');
    expect(markup).toContain("Finish price audit setup in Settings");
    auth.isAuthenticated = false;
  });

  it("distinguishes signed-in server auth failure without allowing the audit", () => {
    clerk.signedIn = true;
    const markup = renderToStaticMarkup(<PriceAudit />);
    expect(markup).toContain("signed in");
    expect(markup).toContain("server connection");
    expect(markup).toContain("Refresh");
    expect(markup).not.toContain("Sign in using the account control");
    expect(markup).toContain('type="button" disabled=""');
    clerk.signedIn = false;
  });

  it("shows the configured store and validates saved consent, URL and bounds", () => {
    const settings = { storeUrl: "taylormi.paymore.com", tolerancePercent: 15, maxSearchPages: 2, consentToProvider: true, usdConfirmed: true };
    const markup = renderToStaticMarkup(<PriceAuditStore settings={settings} />);
    expect(markup).toContain("taylormi.paymore.com");
    expect(markup).not.toContain("<input");
    expect(configuredAudit(settings)).toEqual({ storeUrl: "https://taylormi.paymore.com", tolerancePercent: 15, maxSearchPages: 2 });
    for (const invalid of [{ consentToProvider: false }, { usdConfirmed: false }, { storeUrl: "" }, { storeUrl: "taylormi.paymore.com/admin/products" }, { tolerancePercent: NaN }, { maxSearchPages: 6 }]) {
      expect(configuredAudit({ ...settings, ...invalid })).toBeNull();
    }
  });

  it.each([
    ["high", "Too high"], ["low", "Too low"], ["fair", "Just right"],
  ] as const)("shows %s price findings, exact dollars, and expandable source evidence", (kind, label) => {
    const markup = renderToStaticMarkup(<PriceAuditResult result={result({ kind, medianCents: 10000, lowCents: 8500, highCents: 11500, differencePercent: 20 })} />);
    expect(markup).toContain(label);
    expect(markup).toContain("$120.00 <small>USD</small>");
    expect(markup).toContain("$100.00 USD");
    expect(markup).toContain("+20.0% vs. sold median");
    expect(markup).toContain('<details class="price-audit-evidence">');
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
