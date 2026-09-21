# Price Audit reference

The **Price Audit** sidepanel tool compares available public Shopify variants with visible eBay sold listings. It never changes store prices.

## Inputs and privacy

The form accepts a public HTTPS storefront URL, a price tolerance, and a search-page limit. The default tolerance is 15%. The default search limit is two pages per variant, configurable from one to five. A signed-in Volt account is required.

Users confirm USD prices and consent to sending public catalog descriptions and listing evidence to TypeSafe through Volt. `JEV_API_KEY` is a Convex environment variable. The key never reaches the extension, page scripts, logs, or exports. There is no client-key fallback.

## Workflow

`catalog.ts` follows the kiosk's public `products.json` pagination: 250 products per page, at most 20 pages, available variants only. Duplicate pages, malformed records, and a full final page prevent a complete catalog result. This is not private Shopify admin inventory and does not include stock quantities or unpublished products.

`browser.ts` opens dedicated research tabs and reads DOM content through isolated Chrome scripts. It never navigates pre-existing user tabs. A changed research URL stops the scan. Only unchanged research tabs close at the end. The reader waits passively for eBay's automatic browser verification within the navigation's 30-second deadline. It resumes only on the requested sold search. If verification does not finish, the tab remains open for manual handling; the tool does not click or bypass challenges.

`remote-decisions.ts` uses the sidepanel's authenticated Convex client to call `priceAudit:decide`. The action verifies identity and validates bounded evidence before any provider request. Clients cannot supply prompts, model names, or provider destinations. Server-owned `convex/priceAudit/decisions.ts` gives Jev bounded Choice questions for item identity, search queries, observed sold-price candidates, next-page links, and final evidence checks. Jev receives page content as untrusted evidence. Its choices cannot execute arbitrary code or navigate to unobserved destinations.

Server-only `convex/priceAudit/jevClient.ts` calls the TypeSafe `systemone` endpoint with `jev-latest`. It validates choices and probabilities, limits request size, applies a 30-second request timeout, and retries transient overload responses at most twice. Each provider attempt reserves capacity through the Convex rate-limiter component. Limits are 120 attempts per minute per account with a 30-attempt burst, 4,000 per account per day, and 20,000 shared per day. Keys use the authenticated token identifier, never a caller-provided user ID. There is no generative-model fallback.

`runner.ts` processes every available variant sequentially. It records uncertain identities without inventing search terms. It limits eBay traversal and deduplicates sold listing IDs across pages. Stop, sign-out, panel closure, or a tool switch cancels local work and prevents new decisions. An in-flight server call can still finish, including its bounded retries, and incur provider charges. Reports are memory-only until exported as JSON; there is no background continuation or automatic resume.

## Price findings

Both `LH_Sold=1` and `LH_Complete=1` are required. Completed-but-unsold listings are excluded. DOM candidates require a dated Sold label. Hidden prices, price ranges, foreign currency markers, and undisclosed best-offer sale prices are excluded.

Jev must accept exact product, variant, condition, and accessory matches with confidence of at least 0.85. A second Jev check verifies the retained evidence. Confidence is a model signal, not a calibrated guarantee of correctness for this dataset.

`assessment.ts` requires at least three unique accepted comparisons. Code calculates the median in integer USD cents and applies the configured inclusive tolerance band. The labels are **Too high**, **Too low**, **Just right**, and **Insufficient evidence**. Comparisons exclude shipping and tax, and represent the searched sample rather than every historical eBay sale. Store warranties, fees, and local-market differences are not priced automatically.

## Verification

The repeatable checks are `pnpm --filter @volt/extension test:price-audit`, `pnpm exec vitest run convex/priceAudit.test.ts`, `pnpm --filter @volt/extension compile`, and `pnpm exec tsc -p convex/tsconfig.json --noEmit`.

Tests cover catalog pagination, exact money parsing, duplicate listings, missing evidence, model response validation, uncertainty, partial runs, cancellation, tab ownership, and report rendering. External browser and API boundaries use controlled test doubles.

Live checks on September 21, 2026 confirmed eBay's `.s-card` price markup, dated Sold labels, best-offer labels, and next-page URLs. eBay initially displayed an automatic browser challenge, then loaded without intervention. A CLI smoke test of the deployed dev action with a simulated authenticated identity reached Jev using the server key and returned a typed review decision. This checks the server-provider path, not the browser's Clerk handshake. The earlier sample PayMore catalog probe failed. A full live Shopify-to-Jev-to-eBay audit remains unverified.

API source: [TypeSafe API reference](https://docs.typesafe.ai/api). Design guidance: [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one).
