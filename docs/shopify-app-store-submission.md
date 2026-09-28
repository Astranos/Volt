# Volt Resale Shopify App Store submission

Status as checked on September 28, 2026: Shopify Partner Dashboard shows the Volt Resale listing as **Draft**. The install screen says the app is under review and disables installation, but the Partner Dashboard has not recorded a submitted listing. Shopify requires the one-time $19 App Store registration before the listing can proceed. Do not describe the app as submitted or approved until the dashboard confirms it.

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

## Before registration payment and submission

1. Finish and release the embedded frontend, Convex endpoints, and Shopify app configuration as one coherent version.
2. Install on a development store and run the merchant check in `docs/shopify-product-audit.md`.
3. Capture real screenshots and a review screencast from that installation.
4. Complete the Partner account's required emergency phone contact. The account owner should enter it directly into Shopify; never put it in this repository.
5. Review the Partner account address visibility setting and the legal registration agreement with the account owner.
6. Have the account owner enter payment details in Shopify's secure payment form and pay the $19 registration fee. Never send card details in chat or store them locally.
7. Set the listing to limited visibility, enter the reviewed listing copy and support details, attach media, and submit for Shopify review.
8. Confirm the Partner Dashboard changes from Draft to a submitted review state and record the review status and any Shopify feedback.

Shopify's [App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements), [listing guidance](https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices), and [registration fee guidance](https://shopify.dev/docs/apps/launch/distribution/revenue-share) govern the final submission.
