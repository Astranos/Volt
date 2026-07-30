import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildEbaySoldListingsUrl,
  getEbayListingState,
  isEbaySearchUrl,
} from "./ebay-sold-listings.ts";

const warningEntrypoint = await readFile(
  new URL("../../entrypoints/ebay-sold-listing-warning.tsx", import.meta.url),
  "utf8"
);

test("eBay listing state is scoped to eBay search pages", () => {
  assert.equal(isEbaySearchUrl("https://www.ebay.com/sch/i.html?_nkw=phone"), true);
  assert.equal(isEbaySearchUrl("https://www.ebay.com/itm/123"), false);
  assert.equal(isEbaySearchUrl("https://example.com/sch/i.html"), false);

  assert.equal(
    getEbayListingState("https://www.ebay.com/sch/i.html?_nkw=phone"),
    "active"
  );
  assert.equal(
    getEbayListingState(
      "https://www.ebay.com/sch/i.html?_nkw=phone&LH_Complete=1"
    ),
    "completed"
  );
  assert.equal(
    getEbayListingState(
      "https://www.ebay.com/sch/i.html?_nkw=phone&LH_Complete=1&LH_Sold=1"
    ),
    "sold"
  );
  assert.equal(getEbayListingState("https://www.ebay.com/itm/123"), "unknown");
});

test("sold listings URL preserves the search and enables sold results", () => {
  const result = new URL(
    buildEbaySoldListingsUrl(
      "https://www.ebay.com/sch/i.html?_nkw=game+boy&_sacat=0"
    )
  );

  assert.equal(result.searchParams.get("_nkw"), "game boy");
  assert.equal(result.searchParams.get("_sacat"), "0");
  assert.equal(result.searchParams.get("LH_Complete"), "1");
  assert.equal(result.searchParams.get("LH_Sold"), "1");
});

test("only active eBay result cards receive the sold-prices overlay", () => {
  assert.match(
    warningEntrypoint,
    /getEbayListingState\(window\.location\.href\) === "active"/
  );
  assert.match(warningEntrypoint, /\.s-item \.s-item__price/);
  assert.match(warningEntrypoint, /\.s-card \.s-card__price/);
  assert.match(warningEntrypoint, /switchButton\.textContent = "View sold prices"/);
  assert.match(warningEntrypoint, /removePriceProtection/);
});
