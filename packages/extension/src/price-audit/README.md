# Price Audit reference

The **Price Audit** sidepanel tool compares available public Shopify variants with visible eBay sold listings. It never changes store prices.

## Inputs and privacy

The extension's **Settings → Price Audit** section stores the public storefront, consent confirmations, comparison tolerance, and search-page limit in `chrome.storage.sync.cmdkSettings.priceAudit`. Bare domains normalize to HTTPS. Editing the store clears its confirmations; they can be reconfirmed and saved in the same form. The default tolerance is 15%, with two search pages per variant, configurable from one to five.

The sidepanel contains the saved store, a Settings shortcut, Start/Stop controls, progress, and results. It subscribes to saved settings changes and cancels a running audit if its configuration or consent changes. A signed-in account must also have a server-authenticated Convex session. The UI distinguishes a signed-out account from a signed-in account whose server connection failed.

Users confirm USD prices and consent to sending public catalog descriptions and listing evidence to TypeSafe through Volt. `JEV_API_KEY` is a Convex environment variable. The key never reaches the extension, page scripts, logs, or exports. There is no client-key fallback.

`convex/auth.config.ts` always trusts `CLERK_JWT_ISSUER_DOMAIN` and can additionally trust an explicitly configured `CLERK_ADDITIONAL_JWT_ISSUER_DOMAIN`. Both require the `convex` audience. The development deployment uses the additional issuer for the extension's existing production Clerk sign-in, while retaining development sign-ins. Production's environment was not changed.

## Workflow

`catalog.ts` follows the kiosk's public `products.json` pagination: 250 products per page, at most 20 pages, available variants only. Duplicate pages, malformed records, and a full final page prevent a complete catalog result. This is not private Shopify admin inventory and does not include stock quantities or unpublished products.

`browser.ts` opens dedicated research tabs and reads DOM content through isolated Chrome scripts. It never navigates pre-existing user tabs. A changed research URL stops the scan. Only unchanged research tabs close at the end. The reader waits passively for eBay's automatic browser verification within the navigation's 30-second deadline. It resumes only on the requested sold search. If verification does not finish, the tab remains open for manual handling; the tool does not click or bypass challenges.

`remote-decisions.ts` uses the sidepanel's authenticated Convex client to call `priceAudit:decide`. The action verifies identity and validates bounded evidence before any provider request. Clients cannot supply prompts, model names, or provider destinations. Server-owned `convex/priceAudit/decisions.ts` gives Jev bounded Choice questions for item identity, search queries, observed sold-price candidates, next-page links, and final evidence checks. Jev receives page content as untrusted evidence. Its choices cannot execute arbitrary code or navigate to unobserved destinations.

Server-only `convex/priceAudit/jevClient.ts` calls the TypeSafe `systemone` endpoint with `jev-latest`. It validates choices and probability distributions, limits request size, applies a 30-second request timeout, and retries transient overload responses at most twice. The extension has no custom per-minute or daily Jev quota; provider-side limits still apply. There is no generative-model fallback.

`runner.ts` processes every available variant sequentially. It records uncertain identities without inventing search terms. It limits eBay traversal and deduplicates sold listing IDs across pages. Stop, sign-out, panel closure, or a tool switch cancels local work and prevents new decisions. An in-flight server call can still finish, including its bounded retries, and incur provider charges. Reports are memory-only until exported as JSON; there is no background continuation or automatic resume.

## Price findings

Both `LH_Sold=1` and `LH_Complete=1` are required. Completed-but-unsold listings are excluded. DOM candidates require a dated Sold label. Hidden prices, price ranges, foreign currency markers, and undisclosed best-offer sale prices are excluded.

Jev uses the selected option's probability for each bounded decision. Review and verification stages use stage-specific minimums. Sold comparisons require at least 0.70 match probability, and the final pass rechecks each comparison independently before the three-match rule runs. Jev's separate confidence field remains diagnostic; it is not treated as the selected option's probability.

`assessment.ts` requires at least three unique accepted comparisons. Code calculates the median in integer USD cents and applies the configured inclusive tolerance band. The labels are **Too high**, **Too low**, **Just right**, and **Insufficient evidence**. Comparisons exclude shipping and tax, and represent the searched sample rather than every historical eBay sale. Store warranties, fees, and local-market differences are not priced automatically.

## Verification

The repeatable checks are `pnpm --filter @volt/extension test:price-audit`, `pnpm exec vitest run convex/priceAudit.test.ts`, `pnpm --filter @volt/extension compile`, and `pnpm exec tsc -p convex/tsconfig.json --noEmit`.

Tests cover catalog pagination, exact money parsing, duplicate listings, missing evidence, model response validation, uncertainty, partial runs, cancellation, tab ownership, and report rendering. External browser and API boundaries use controlled test doubles.

Live checks on September 21, 2026 confirmed eBay's `.s-card` price markup, dated Sold labels, best-offer labels, and next-page URLs. eBay initially displayed an automatic browser challenge, then loaded without intervention. The exact `taylormi.paymore.com` catalog page returned 250 products. Replays with the configured Jev key accepted representative catalog items and retained four eligible sold matches for an iPhone 16 Pro Max sample. This checks the catalog, Jev, and live eBay evidence boundaries; the browser's full signed-in sidepanel run still requires manual extension testing.

API source: [TypeSafe API reference](https://docs.typesafe.ai/api). Design guidance: [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one).
