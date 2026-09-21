import { describe, expect, it } from "vitest";
import { DEFAULT_PRICE_AUDIT_SETTINGS, DEFAULT_SETTINGS, mergePriceAuditSettings, mergeSettings, structuredCloneSettings } from "./settings";

describe("price audit preferences", () => {
  it("defaults safely for existing installations", () => {
    expect(mergeSettings().priceAudit).toEqual({ storeUrl: "", tolerancePercent: 15, maxSearchPages: 2, consentToProvider: false, usdConfirmed: false });
    expect(mergeSettings({}).priceAudit).toEqual(DEFAULT_PRICE_AUDIT_SETTINGS);
  });
  it("preserves saved values and fills missing nested values", () => {
    const saved = { storeUrl: "https://shop.com", tolerancePercent: 20, maxSearchPages: 4, consentToProvider: true, usdConfirmed: true };
    expect(mergeSettings({ priceAudit: saved }).priceAudit).toEqual(saved);
    expect(mergePriceAuditSettings({ storeUrl: saved.storeUrl })).toEqual({ ...DEFAULT_PRICE_AUDIT_SETTINGS, storeUrl: saved.storeUrl });
    expect(mergePriceAuditSettings({ tolerancePercent: Infinity, maxSearchPages: 10 })).toEqual(DEFAULT_PRICE_AUDIT_SETTINGS);
  });
  it("clones nested settings without mutating defaults or saved state", () => {
    const copy = structuredCloneSettings(DEFAULT_SETTINGS);
    expect(copy.priceAudit).not.toBe(DEFAULT_SETTINGS.priceAudit);
    if (!copy.priceAudit) throw new Error("Missing defaults");
    copy.priceAudit.storeUrl = "https://changed.com";
    expect(DEFAULT_SETTINGS.priceAudit?.storeUrl).toBe("");
    expect(mergeSettings().priceAudit?.storeUrl).toBe("");
  });
});
