# Shopify product audit

Volt Resale has a product audit inside Shopify Admin. After installation, the merchant opens **Volt Resale** in Shopify Admin to review products created yesterday in their local timezone and search the store catalog. Results link to the corresponding Shopify product pages. The Chrome extension has a separate, optional audit workflow that opens yesterday's products in a Chrome tab group.

## App configuration

The checked-in `shopify.app.toml` configures the existing public **Volt Resale** app with `read_products`, an embedded app URL of `https://voltresale.app/shopify`, the legacy extension OAuth callback URLs, and production privacy and uninstall webhooks. The app is intended for limited App Store visibility: merchants install from a direct link after Shopify approval.

| Webhook topic | Production endpoint |
| --- | --- |
| `customers/data_request` | `https://sincere-trout-414.convex.site/api/shopify/webhooks/customers/data_request` |
| `customers/redact` | `https://sincere-trout-414.convex.site/api/shopify/webhooks/customers/redact` |
| `shop/redact` | `https://sincere-trout-414.convex.site/api/shopify/webhooks/shop/redact` |
| `app/uninstalled` | `https://sincere-trout-414.convex.site/api/shopify/webhooks/app/uninstalled` |

The webhook handlers verify Shopify's signature over the raw body. Shop redaction and app uninstall remove the embedded installation and any legacy extension connection for that shop. Customer callbacks acknowledge the request because Volt stores no Shopify customer data.

Validate the configuration with `pnpm dlx @shopify/cli app config validate`. Release a new app version with `pnpm dlx @shopify/cli app deploy` only after the web frontend and Convex backend are live and a Shopify development store installation passes a full audit check.

## Authentication and data

The embedded screen loads App Bridge, requests a short-lived Shopify ID token for each API call, and sends it to the same-origin `/api/shopify/admin/*` endpoints. Vercel forwards those three endpoints to production Convex, so the browser does not need a cross-origin connection to Convex. Convex verifies the signature, audience, expiry, issuer, and shop domain before exchanging the ID token for an expiring offline `read_products` token. The access and refresh tokens are encrypted at rest and keyed by shop. Shopify product data is read on demand; the audit does not copy the catalog into Volt's database. No Volt account or Chrome extension is needed to use the Admin audit.

The extension's existing connection is separate. It uses Clerk sign-in, the authorization code grant, and encrypted tokens keyed by the Volt account. Its connection screen and Chrome tab group audit continue to work independently of the embedded Admin screen.

## Convex configuration

Set these on both development and production Convex deployments:

| Variable | Value |
| --- | --- |
| `SHOPIFY_CLIENT_ID` | Client ID of the corresponding Shopify app |
| `SHOPIFY_CLIENT_SECRET` | Client secret of that Shopify app |
| `SHOPIFY_TOKEN_ENCRYPTION_KEY` | Distinct random 32-byte key encoded as 64 hexadecimal characters per deployment |

Enter secrets interactively with `pnpm exec convex env set NAME` (add `--prod` for production). Do not put them in the repository or browser environment files. During local development, the frontend's `VITE_CONVEX_SITE_URL` may select a corresponding Convex site. Production uses the same-origin routes defined in both Vercel configurations, which forward to the production deployment.

## Merchant check

1. Install the app on a Shopify development store from Shopify's installation flow.
2. Open **Volt Resale** inside Shopify Admin. Confirm that the connection identifies the correct `.myshopify.com` store.
3. Create or find products with known titles. Check search results and product links.
4. Create a product and check that it appears in the previous-day audit on the next local calendar day, or test with a controlled date and timezone.
5. Uninstall the app. Confirm the installation record and any connection for that shop are removed.

Shopify's review requirements and listing preparation are tracked in `docs/shopify-app-store-submission.md`.

## Request recovery

The client obtains a fresh Shopify ID token for each attempt and retries a transient network, session, or service failure once. Permission errors remain visible. If a request still fails, the connection check, previous-day audit, and product search show a retry button; search retries the submitted query. Cancelled or superseded requests do not retry or replace newer results.
