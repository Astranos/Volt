import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import {
  AdEligibilityBoundary,
  freeWorkspaceAllowsAds,
  PublicSearchAd,
} from "./public-search-ad";

describe("public search ad eligibility", () => {
  test("paid and unresolved workspace plans never allow ads", () => {
    expect(freeWorkspaceAllowsAds("workspace")).toBe(false);
    expect(freeWorkspaceAllowsAds(undefined)).toBe(false);
    expect(freeWorkspaceAllowsAds("free")).toBe(true);
  });
  test("eligibility failures suppress the placement", () => {
    expect(AdEligibilityBoundary.getDerivedStateFromError()).toEqual({
      failed: true,
    });
    const boundary = new AdEligibilityBoundary({
      children: <p>Advertisement</p>,
    });
    boundary.state = { failed: true };
    expect(boundary.render()).toBeNull();
  });
  test.each([true, false])(
    "server rendering never loads ads or auth queries with results=%s",
    (usefulResults) => {
      vi.stubEnv("VITE_ADSENSE_ENABLED", "true");
      vi.stubEnv("VITE_ADSENSE_PUBLISHER_ID", "ca-pub-1234567890123456");
      vi.stubEnv("VITE_ADSENSE_PUBLIC_SEARCH_SLOT", "1234567890");
      vi.stubEnv("VITE_ADSENSE_CERTIFIED_CMP_ID", "300");
      try {
        expect(
          renderToStaticMarkup(
            <PublicSearchAd usefulResults={usefulResults} />,
          ),
        ).toBe("");
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
});
