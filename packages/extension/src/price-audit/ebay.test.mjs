import test from "node:test";
import assert from "node:assert/strict";
import { ebayItemUrl, eligibleSoldText, isSoldSearch, sameSearch, soldSearchUrl, usdPriceCandidates, validNextPage } from "./ebay.ts";
import { normalizeSearchPage } from "./browser.ts";

test("all searches and pagination require both filters and the same query", () => {
  const first = soldSearchUrl("Canon EOS & lens");
  const next = new URL(first); next.searchParams.set("_pgn", "2");
  assert.ok(isSoldSearch(first));
  assert.ok(validNextPage(first, next.href));
  assert.ok(sameSearch(first, first));
  assert.ok(!sameSearch(first, next.href));
  const modified = new URL(first); modified.searchParams.set("LH_ItemCondition", "1000");
  assert.ok(!sameSearch(first, modified.href), "user-added condition filter changes ownership");
  next.searchParams.set("_nkw", "Different");
  assert.ok(!validNextPage(first, next.href));
  for (const url of [first.replace("LH_Sold=1", "LH_Sold=0"), first.replace("LH_Complete=1", "LH_Complete=0"), first.replace("www.ebay.com", "www.ebay.com.evil.com"), first.replace("https:", "http:")]) assert.ok(!isSoldSearch(url));
});

test("prices are exact USD candidates, never shipping, ranges, conversion or financing", () => {
  const prices = usdPriceCandidates(["US $1,234.56", "$100.00", "USD 5.00", "$100.00", "$100 to $200", "+$8.00 shipping", "C $10.00", "AU $10.00", "EUR 5.00", "$5.00/mo", "$0.00", "$1,23.00", "$1.234"]);
  assert.deepEqual(prices.map((p) => p.cents), [123456, 10000, 500]);
});

test("completed-unsold and undisclosed best offers cannot supply sold evidence", () => {
  assert.ok(eligibleSoldText("Sold Sep 20, 2026 Canon camera US $100.00"));
  for (const text of ["Ended Sep 20, 2026 US $100.00", "7 sold US $100.00", "Sold Sep 20, 2026 Best offer accepted", "Sold Sep 20, 2026 C $100.00", "Sold Sep 20, 2026 €100.00"]) assert.ok(!eligibleSoldText(text));
});

test("DOM normalization excludes non-item URLs, duplicates, unsold and hidden sale prices", () => {
  const card = { href: "https://www.ebay.com/itm/camera/123456789012?hash=123", text: "Sold Sep 20, 2026 Canon camera US $100.00", prices: ["US $100.00"], truncated: false };
  const first = soldSearchUrl("camera");
  const next = new URL(first); next.searchParams.set("_pgn", "2");
  const parsed = normalizeSearchPage({ url: first, cards: [card, card, { ...card, href: "https://evil.com/itm/123456789013" }, { ...card, href: "https://www.ebay.com/itm/123456789014", text: "Ended Sep 20, 2026" }], links: [{ id: "next", text: "Next page", url: next.href }, { id: "bad", text: "Next", url: "https://evil.com" }], noResults: false, truncated: false });
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].id, "123456789012");
  assert.equal(parsed.candidates[0].url, "https://www.ebay.com/itm/123456789012");
  assert.equal(parsed.nextLinks.length, 1);
  assert.equal(ebayItemUrl("https://www.ebay.com/itm/garbage"), null);
});
