# Price Audit reference

The **Price Audit** sidepanel tool compares available public Shopify variants with visible eBay sold listings. It never changes store prices.

## Inputs and privacy

The form accepts a public HTTPS storefront URL, a TypeSafe API key, a price tolerance, and a search-page limit. The default tolerance is 15%. The default search limit is two pages per variant, configurable from one to five.

Users confirm USD prices and consent to sending public catalog descriptions and listing evidence to TypeSafe. The key stays in the sidepanel's memory during a run. It is not stored in Chrome storage, sent to page scripts, logged, or exported. Each new run requires the key again.

## Workflow

`catalog.ts` follows the kiosk's public `products.json` pagination: 250 products per page, at most 20 pages, available variants only. Duplicate pages, malformed records, and a full final page prevent a complete catalog result. This is not private Shopify admin inventory and does not include stock quantities or unpublished products.

`browser.ts` opens dedicated research tabs and reads DOM content through isolated Chrome scripts. It never navigates pre-existing user tabs. A changed research URL stops the scan. Only unchanged research tabs close at the end. eBay verification pages remain open for manual handling; the tool does not bypass them.

`decisions.ts` gives Jev bounded Choice questions for item identity, search queries, observed sold-price candidates, next-page links, and final evidence checks. Jev receives page content as untrusted evidence. Its choices cannot execute arbitrary code or navigate to unobserved destinations.

`jev-client.ts` calls the documented TypeSafe `systemone` endpoint with `jev-latest`. It validates choices and probabilities, limits request size, applies a 30-second request timeout, and retries rate-limit responses at most twice. API requests can incur charges. There is no generative-model fallback.

`runner.ts` processes every available variant sequentially. It records uncertain identities without inventing search terms. It limits eBay traversal and deduplicates sold listing IDs across pages. The sidepanel lifetime owns the run: Stop, panel closure, or a tool switch cancels it. Reports are memory-only until exported as JSON; there is no background continuation or automatic resume.

## Price findings

Both `LH_Sold=1` and `LH_Complete=1` are required. Completed-but-unsold listings are excluded. DOM candidates require a dated Sold label. Hidden prices, price ranges, foreign currency markers, and undisclosed best-offer sale prices are excluded.

Jev must accept exact product, variant, condition, and accessory matches with confidence of at least 0.85. A second Jev check verifies the retained evidence. Confidence is a model signal, not a calibrated guarantee of correctness for this dataset.

`assessment.ts` requires at least three unique accepted comparisons. Code calculates the median in integer USD cents and applies the configured inclusive tolerance band. The labels are **Too high**, **Too low**, **Just right**, and **Insufficient evidence**. Comparisons exclude shipping and tax, and represent the searched sample rather than every historical eBay sale. Store warranties, fees, and local-market differences are not priced automatically.

## Verification

The repeatable checks are `pnpm --filter @volt/extension test:price-audit` and `pnpm --filter @volt/extension compile`.

Tests cover catalog pagination, exact money parsing, duplicate listings, missing evidence, model response validation, uncertainty, partial runs, cancellation, tab ownership, and report rendering. External browser and API boundaries use controlled test doubles.

Live checks on September 21, 2026 confirmed eBay's `.s-card` price markup, dated Sold labels, best-offer labels, and next-page URLs. eBay initially displayed an automatic browser challenge, then loaded without intervention. The sample PayMore catalog returned HTTP 500 to the command-line probe and was blocked in the browser. A full live Shopify-to-Jev-to-eBay audit and the installed extension UI remain unverified. No real API key was used during these checks.

API source: [TypeSafe API reference](https://docs.typesafe.ai/api). Design guidance: [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one).
