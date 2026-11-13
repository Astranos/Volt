# In-store browsing

A customer-facing catalog for mounted tablets and smaller screens, hosted at `https://pm.voltresale.app`. A store's public path is `/<handle>`, using the handle from its `.myshopify.com` domain.

The app uses React 19, TypeScript, Vite, Tailwind 4, and Base UI. It is a separate workspace package so kiosk customers do not load Volt's account, scanner, or billing screens. Volt's existing application and deployment stay unchanged.

## Run locally

From the repository root, run:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm dev:kiosk
```

Open `http://127.0.0.1:4175/<handle>`. The local API fetches that store's public Shopify listings directly from `https://<handle>.myshopify.com/products.json`. Setup accepts a shop handle, `.myshopify.com` domain or HTTPS URL, or `pm.voltresale.app/<handle>` kiosk link. No Shopify admin credentials or Convex configuration are required. The catalog requires network access; it never substitutes sample products.

## Verify a change

```sh
pnpm --filter @volt/kiosk typecheck
pnpm test:kiosk
pnpm --filter @volt/kiosk check:live
pnpm --filter @volt/kiosk check:requests
```

The live check requires the local server. It checks Taylor and Southfield products, prices, SKUs, structured specifications, timestamps, store isolation, and API errors. Unit tests cover malformed Shopify responses, pagination, available variants, cache expiry, store resolution, listing markup, browsing rules, and gallery gestures.

The requests check is development-only. It creates a temporary request, verifies duplicate protection and store isolation, marks it found and shown, and leaves no active test request.

## Use the staff request queue

Open `/<store>/requests`, for example `/<handle>/requests`. Customers use **Ask to see item** beside the SKU. The staff page updates every three seconds and shows the requested product, variant, photo, exact SKU, and waiting time.

**Found** keeps a request active. **Shown**, **Given to customer**, and **Clear** remove it from the active queue. Every request expires one hour after creation; changing its status does not extend that deadline. Convex also deletes expired records with a scheduled function.

The queue and its controls are intentionally public, as requested. Anyone who knows the URL can view or change requests. It collects no customer names, contact information, or IP addresses. A temporary anonymous browsing-session identifier supplies duplicate protection and request limits.

## Configure request storage

The kiosk uses the existing Volt Convex project for durable request storage. Add `KIOSK_CONVEX_URL` and `KIOSK_REQUEST_SECRET` to the kiosk server environment. The same `KIOSK_REQUEST_SECRET` must exist in that Convex deployment. This is an internal service credential, not a staff access code. Never prefix it with `VITE_` or expose it in browser configuration.

For development, run `node apps/kiosk/scripts/configure-requests.ts DEPLOYMENT https://DEPLOYMENT.convex.cloud` from the repo root after confirming the intended deployment. The script creates a credential only when absent and writes an ignored, mode-600 `apps/kiosk/.env.local`. It does not print the credential. Restart the kiosk dev server after changing its environment.

Deploy the additive `kioskRequests` schema and functions before deploying the frontend. Use separate development and production credentials. The production backend changes and Vercel environment configuration need explicit approval before publishing.

Check the UI at 1024 × 768 and 768 × 1024, plus a narrow phone viewport. Search for a product, choose a category and budget, change sorting, open product details, then start over. Test on the actual mounted iPad before rollout; viewport testing does not establish support for an unknown Safari version.

## Open another franchise

Visit `/<handle>` for any store with an accessible public feed at `https://<handle>.myshopify.com/products.json`. No registry entry or redeployment is required.

The server validates a single DNS label and constructs the Shopify hostname itself. It rejects arbitrary custom domains, ports, credentials, reserved hosts, internal store codes, and nested subdomains. Redirects are not followed. Product URLs use the same Shopify origin. A missing or inaccessible store never falls back to another store.

Store display names and regions come from optional `/meta.json` JSON on that Shopify origin. Custom domain fields in metadata never change the fetch target. If metadata lacks a street address, the kiosk leaves it empty. Product descriptions still use Cheerio to extract structured listing content; store metadata no longer scrapes a homepage.

Exact public Shopify SKUs, such as `MI01-8773A-E9`, appear on cards and in product details so staff can locate the item. Search accepts those SKUs.

## Existing store migration

One small compatibility map covers the two production stores. Legacy `taylormi` and `southfieldmi` identities resolve to the corresponding Taylor and Southfield Shopify handles. Vercel permanently redirects both catalog and requests paths before SPA rewrites. The client also normalizes legacy paths if they reach the app.

The HTTP APIs accept those legacy identities but fetch, cache, and persist requests under the canonical handle. Catalog responses echo the requested legacy slug, as do queue rows and status updates, because installed native clients compare response slugs to their request. Product links still point at Shopify. The native app migrates `kiosk.storeSlug` in UserDefaults on launch and saves the new handle. Extension settings normalize saved legacy slugs when read.

Convex canonicalizes enqueue, list, and update identities, and accepts product snapshots only on the canonical Shopify host. Existing queue rows need no data migration because they expire within one hour. A row created under a legacy identity before rollout may disappear from the active queue during that transition.

Confirm the franchise permits using its listings and branding before rollout. The public Shopify feed is an initial read-only integration, not a guarantee that Shopify will keep that endpoint available. A store with unpublished stock or multiple inventory locations needs an authorized location-aware integration before claiming that all physical stock is represented.

## Publish as a separate project

Do not deploy this folder over the existing Volt project. Use the existing separate kiosk project in `juanquengas-projects`. It builds with `pnpm build`, serves `dist`, and runs `api/catalog.ts` as a server function.

For a CLI deployment, run `node apps/kiosk/scripts/prepare-deploy.ts` from the repository root. The script prints a temporary directory containing only this app and a standalone lockfile derived from the workspace lockfile. Link that directory to the existing kiosk project before deploying it. This avoids uploading unrelated Volt source and keeps dependency versions reproducible. Do not deploy the app folder without the workspace lockfile.

For a Git-connected project instead, set its root directory to `apps/kiosk`. Keep Node 24 and pnpm 10.14.0. Vercel must detect the pnpm 9-format lockfile or use `ENABLE_EXPERIMENTAL_COREPACK=1`; an older default pnpm fails under Node 24.

After approving a preview and testing the physical tablet, attach `pm.voltresale.app` to that project and apply the DNS record Vercel supplies. Domain changes and publishing are separate rollout steps, not performed by local development.

## Inventory behavior

The server reads all pages before replacing a catalog snapshot. Products retain Shopify identities instead of merging by UPC. Only available variants contribute to the displayed price range. Condition is shown only when the source states it.

Successful snapshots are fresh for 60 seconds. If Shopify fails, the API can return an explicitly stale snapshot for up to five minutes from the last successful check. After that it returns an unavailable response. The browser also expires displayed data when it cannot refresh, so a network failure cannot leave old products looking current indefinitely.

The cache is in-memory and per server instance. It reduces repeat requests but is not durable or shared across Vercel instances. A cold instance refetches rather than inventing a cached state. For larger franchise rollouts, measure upstream traffic and add a shared cache or an authorized Shopify webhook integration if needed.

Product details preserve specification rows, headings, included-item lists, accessory exclusions, and condition notes as structured text. Cosmetic and functionality notes sit below the photo carousel. Price, SKU, included items, and specifications sit on the right; narrow screens put the price and SKU before the gallery and condition notes. Upstream HTML never runs in the browser. Product photos use square frames without cropping, with thumbnail selection and horizontal swipe navigation. Tap the main photo to enlarge it in a full-screen viewer; Back to item or Escape returns to the same item and photo.

Requests ask staff for assistance. They do not reserve stock, place orders, collect customer details, or prove physical availability. Staff should confirm price, condition, and stock before a sale.
