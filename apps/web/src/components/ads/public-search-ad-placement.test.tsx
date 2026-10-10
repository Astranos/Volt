import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { PublicSearchState } from "../../lib/upc-search";

vi.mock("./public-search-ad", () => ({
  PublicSearchAd: ({ usefulResults }: { usefulResults: boolean }) =>
    usefulResults ? <i data-ad-candidate="true" /> : null,
}));

import { PublicSearchResults } from "../upc-search/public-upc-search";

describe("public result advertising placement", () => {
  test.each([
    { kind: "idle" },
    { kind: "loading", query: "game" },
    { kind: "error", query: "game", message: "Unavailable" },
    {
      kind: "success",
      query: "missing",
      result: { products: [], hasMore: false },
    },
  ] satisfies PublicSearchState[])(
    "does not offer a placement for $kind",
    (state) => {
      const html = renderToStaticMarkup(
        <PublicSearchResults state={state} retry={() => {}} />,
      );
      expect(html).not.toContain("data-ad-candidate");
    },
  );

  test("offers one placement after useful product content", () => {
    const state: PublicSearchState = {
      kind: "success",
      query: "game",
      result: {
        hasMore: false,
        products: [
          {
            upc: "012345678905",
            qualityStatus: "unreviewed",
            title: "A useful catalog match",
            brand: null,
            model: null,
            mpn: null,
            platform: null,
            edition: null,
            storage: null,
            color: null,
            carrier: null,
            updatedAt: 1,
          },
        ],
      },
    };
    const html = renderToStaticMarkup(
      <PublicSearchResults state={state} retry={() => {}} />,
    );
    expect(html.match(/data-ad-candidate/g)).toHaveLength(1);
    expect(html.indexOf("data-ad-candidate")).toBeGreaterThan(
      html.indexOf("Copy UPC 012345678905"),
    );
  });
});
