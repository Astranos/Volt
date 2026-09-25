# Connect Shopify for product audits

Volt's new tab page can open every Shopify product created on the previous calendar date in a named Chrome tab group. It uses the computer's timezone. The product query includes active, archived, draft, and unlisted products. Each tab opens the product's Shopify admin page.

## Configure the Shopify app

Use a standalone app in the Shopify Dev Dashboard. Set its app URL to `https://voltresale.app`, turn off embedding in Shopify admin, request only `read_products`, and allow these callback URLs:

- Development: `https://adorable-hornet-19.convex.site/api/shopify/callback`
- Production: `https://sincere-trout-414.convex.site/api/shopify/callback`

Register the required [privacy webhooks](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance) for both deployments as appropriate:

| Shopify topic | Development URL | Production URL |
| --- | --- | --- |
| `customers/data_request` | `https://adorable-hornet-19.convex.site/api/shopify/webhooks/customers/data_request` | `https://sincere-trout-414.convex.site/api/shopify/webhooks/customers/data_request` |
| `customers/redact` | `https://adorable-hornet-19.convex.site/api/shopify/webhooks/customers/redact` | `https://sincere-trout-414.convex.site/api/shopify/webhooks/customers/redact` |
| `shop/redact` | `https://adorable-hornet-19.convex.site/api/shopify/webhooks/shop/redact` | `https://sincere-trout-414.convex.site/api/shopify/webhooks/shop/redact` |

The webhook handlers verify Shopify's signature over the raw request body. Shop redaction removes all saved connections and pending authorizations for that store. Customer callbacks acknowledge the request because Volt stores no Shopify customer data.

The app uses Shopify's [authorization code grant](https://shopify.dev/docs/apps/build/authentication-authorization/authenticate-standalone-apps) and expiring offline tokens. Volt stores encrypted access and refresh tokens in Convex, scoped to the signed-in Clerk account. The extension never receives a Shopify token.

To let merchants from unrelated stores install the app, select [public distribution](https://shopify.dev/docs/apps/launch/distribution). Shopify requires an app review before general distribution. Custom distribution is limited to one store or one Plus organization.

## Set Convex environment variables

Set these variables on both the development and production Convex deployments:

| Variable | Value |
| --- | --- |
| `SHOPIFY_CLIENT_ID` | The app's client ID from Shopify Dev Dashboard |
| `SHOPIFY_CLIENT_SECRET` | The app's client secret from Shopify Dev Dashboard |
| `SHOPIFY_TOKEN_ENCRYPTION_KEY` | A distinct, random 32-byte key encoded as 64 hexadecimal characters per deployment |

Use `pnpm exec convex env set NAME` to enter secrets interactively. Add `--prod` to target the production deployment. Do not put secrets in extension environment files or the repository. Convex supplies `CONVEX_SITE_URL`, which the OAuth flow uses to build the exact callback URL.

## Connect and review

1. Sign in to Volt with Clerk.
2. Open extension settings and find **Shopify product audit**.
3. Enter the store's permanent `.myshopify.com` domain and select **Connect Shopify**.
4. Approve read-only product access in Shopify. Return to settings to see the connected store.
5. On the new tab page, select **Audit**. Volt opens yesterday's products in one Chrome tab group.

If you disconnect the store in Volt, the saved token is deleted. You can also uninstall the app from Shopify. If Shopify rejects an expired or revoked token, reconnect the store.
