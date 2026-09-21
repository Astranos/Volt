import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PRICE_AUDIT_SETTINGS, mergeSettings } from "../../domain/settings";
import { PriceAuditSettings, changePriceAuditStore, preparePriceAuditSettings } from "./PriceAuditSettings";

describe("Price Audit settings", () => {
  it("keeps all configuration and consent disclosures in the Settings section", () => {
    const markup = renderToStaticMarkup(<PriceAuditSettings settings={mergeSettings()} saveSettings={vi.fn()} />);
    for (const copy of ["priceaudit", "Shopify store URL", "Fair-price tolerance", "eBay pages per item", "TypeSafe via Volt", "USD prices", "read-only", "at least 3 confident unique sold matches", "exclude shipping and tax", "Closing the panel", "in-flight server call", "does not add a per-minute or daily Jev quota", "provider availability"]) expect(markup).toContain(copy);
    expect(markup.match(/type="checkbox"/g)).toHaveLength(2);
    expect(markup).not.toContain("API key");
  });

  it("normalizes a bare domain and requires reconfirmation when the store changes", () => {
    const changed = changePriceAuditStore({ ...DEFAULT_PRICE_AUDIT_SETTINGS, consentToProvider: true, usdConfirmed: true }, "shop.com/products/camera");
    const prepared = preparePriceAuditSettings(changed);
    expect(prepared.storeUrl).toBe("https://shop.com");
    expect(prepared.consentToProvider).toBe(false);
    expect(prepared.usdConfirmed).toBe(false);
    expect(preparePriceAuditSettings({ ...changed, consentToProvider: true, usdConfirmed: true })).toMatchObject({ storeUrl: "https://shop.com", consentToProvider: true, usdConfirmed: true });
  });

  it("clearing the store clears consents and changing only comparison preferences preserves them", () => {
    const saved = { ...DEFAULT_PRICE_AUDIT_SETTINGS, storeUrl: "https://shop.com", consentToProvider: true, usdConfirmed: true };
    expect(preparePriceAuditSettings({ ...saved, tolerancePercent: 20, maxSearchPages: 3 })).toEqual({ ...saved, tolerancePercent: 20, maxSearchPages: 3 });
    expect(preparePriceAuditSettings({ ...saved, storeUrl: "" })).toMatchObject({ storeUrl: "", consentToProvider: false, usdConfirmed: false });
  });

  it.each(["http://shop.com", "https://admin.shopify.com/store/name", "https://localhost", "not a domain"])("rejects invalid store %s before saving", (storeUrl) => {
    expect(() => preparePriceAuditSettings({ ...DEFAULT_PRICE_AUDIT_SETTINGS, storeUrl })).toThrow();
  });

  it("rejects invalid numeric preferences", () => {
    for (const tolerancePercent of [-1, 51, NaN, Infinity]) expect(() => preparePriceAuditSettings({ ...DEFAULT_PRICE_AUDIT_SETTINGS, tolerancePercent })).toThrow(/tolerance/);
    for (const maxSearchPages of [0, 6, 1.5, NaN]) expect(() => preparePriceAuditSettings({ ...DEFAULT_PRICE_AUDIT_SETTINGS, maxSearchPages })).toThrow(/pages/);
  });
});
