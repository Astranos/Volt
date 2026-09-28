# Volt Resale Shopify App Store submission

Status as checked on September 28, 2026: the account owner completed Shopify App Store registration. Shopify Partner Dashboard still shows the Volt Resale listing as **Draft**. The install screen says the app is under review and disables installation, but the Partner Dashboard has not recorded a submitted listing. Do not describe the app as submitted or approved until the dashboard confirms it.

The embedded audit backend is live on production Convex, the Admin page and privacy policy are live at `voltresale.app`, and Shopify app version `volt-resale-3` is active. A development-store installation opened the embedded page, authenticated the store, returned an empty previous-day audit for September 27, and found **The Draft Snowboard** by title with the expected Shopify Admin product link, inventory, status, and price. A populated previous-day result remains to be checked after a product is created on the prior local calendar day.

## Account and distribution choices

- Partner account registration: **Individual**.
- Associated developer accounts: the user's `juanquenga@gmail.com` account is the only one, per the account owner.
- Distribution: public app with **limited App Store visibility** so approved merchants install through a direct link.
- Public support email: `juanquenga@gmail.com`.
- Website: `https://voltresale.app`.
- Privacy policy: `https://voltresale.app/privacy`.
- Pricing: free access to the Shopify Admin product audit. Check the final listing against any future billing changes.

## Listing copy draft

**App name:** Volt Resale

**Short description:** Review yesterday's Shopify products and find listings by title.

**App details:** Open Volt Resale in Shopify Admin to see products added yesterday in your local timezone. Search your catalog and open product records to check listing details, price, inventory, SKU, and condition when available. The audit reads products with Shopify's `read_products` permission. A separate Chrome extension can open yesterday's products in a tab group, but is optional for the Admin audit.

**Feature highlights:**

1. Review products created yesterday in your local timezone.
2. Search products and open their Shopify Admin records.
3. Check price, inventory, SKU, and condition when available.

**Suggested category:** Store management / product management, subject to Shopify's available categories in the listing editor.

Use `assets/shopify-app-store/volt-resale-icon.png` for the 1200 × 1200 listing icon. Create three to six distinct 1600 × 900 screenshots from the real, installed Admin app: previous-day audit, a populated product search, and a product detail link or an empty state. Do not use mock screens as review evidence. Record a short screencast showing installation, opening the Admin app, yesterday's audit, and search. The reviewer instructions should say that no Volt account or Chrome extension is required for those steps.

## Submission progress

Completed in Shopify: registration; app icon and configuration checks; English listing language; no protected customer data declaration; embedded capability; draft listing copy, category, support and reviewer contact, privacy link, testing instructions; a public free plan; and a feature image. Shopify's automated check for common errors passed on September 28, 2026.

The listing editor still requires three genuine desktop screenshots and a publicly accessible screencast URL. The listing remains Draft and the Submit for review button is disabled. The owner requested direct-link visibility; apply that setting before submission.

Before submission:

1. Capture real screenshots and a review screencast from the installed development-store app. Record both the empty previous-day state and a populated product search; capture a populated previous-day audit when test data is available. Do not use mock screens as review evidence.
2. Check the previous-day audit with a product created on the prior local calendar day, and verify uninstall cleanup on a disposable development-store installation.
3. Review the Partner account address visibility setting with the account owner.
4. Complete the remaining listing media, set limited visibility, and submit for Shopify review.
5. Confirm the Partner Dashboard changes from Draft to a submitted review state and record the review status and any Shopify feedback.

Shopify's [App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements), [listing guidance](https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices), and [registration fee guidance](https://shopify.dev/docs/apps/launch/distribution/revenue-share) govern the final submission.
