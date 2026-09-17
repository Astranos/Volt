# PayMore in-store browsing

A customer-facing catalog for mounted tablets and smaller screens. Taylor's public path is `/taylormi`. The proposed production address is `https://pm.juanquenga.com/taylormi`; this repository does not configure that domain.

The app uses React 19, TypeScript, Vite, Tailwind 4, and Base UI. It is a separate workspace package so kiosk customers do not load Volt's account, scanner, or billing screens. Volt's existing application and deployment stay unchanged.

## Run locally

From the repository root, run:

```sh
pnpm install --ignore-scripts
pnpm dev:kiosk
```

Open `http://127.0.0.1:4175/taylormi`. The local API fetches Taylor's public Shopify listings. No Shopify admin credentials or Convex configuration are required. The catalog requires network access; it never substitutes sample products.

## Verify a change

```sh
pnpm --filter @volt/kiosk typecheck
pnpm test:kiosk
pnpm --filter @volt/kiosk check:live
```

The live check requires the local server. It checks current Taylor products, prices, SKUs, structured specifications, timestamps, approved-store isolation, and API errors. Unit tests cover malformed Shopify responses, pagination, available variants, cache expiry, listing markup, browsing rules, and gallery gestures.

Check the UI at 1024 × 768 and 768 × 1024, plus a narrow phone viewport. Search for a product, choose a category and budget, change sorting, open product details, then start over. Test on the actual mounted iPad before rollout; viewport testing does not establish support for an unknown Safari version.

## Add a franchise

Add an approved store in `server/stores.ts`. Keep the internal store code separate from its public slug. Only allowlisted stores can supply catalog data. The API never accepts an arbitrary Shopify hostname from the browser.

Use the public slug for the kiosk address. Taylor uses `taylormi`. The registry's `internalCode` field stays server-side. Item SKUs are different: their exact public Shopify values, such as `MI01-8773A-E9`, appear on cards and in product details so staff can locate the item. Search accepts those SKUs.

Confirm the franchise permits using its listings and branding before rollout. The public Shopify feed is an initial read-only integration, not a guarantee that Shopify will keep that endpoint available. A store with unpublished stock or multiple inventory locations needs an authorized location-aware integration before claiming that all physical stock is represented.

## Publish as a separate project

Do not deploy this folder over the existing Volt project. The separate project is `paymore-kiosk` in `juanquengas-projects`. It builds with `pnpm build`, serves `dist`, and runs `api/catalog.ts` as a server function.

For a CLI deployment, run `node apps/kiosk/scripts/prepare-deploy.ts` from the repository root. The script prints a temporary directory containing only this app and a standalone lockfile derived from the workspace lockfile. Link that directory to `paymore-kiosk` before deploying it. This avoids uploading unrelated Volt source and keeps dependency versions reproducible. Do not deploy the app folder without the workspace lockfile.

For a Git-connected project instead, set its root directory to `apps/kiosk`. Keep Node 24 and pnpm 10.14.0. Vercel must detect the pnpm 9-format lockfile or use `ENABLE_EXPERIMENTAL_COREPACK=1`; an older default pnpm fails under Node 24.

After approving a preview and testing the physical tablet, attach `pm.juanquenga.com` to that project and apply the DNS record Vercel supplies. Domain changes and publishing are separate rollout steps, not performed by local development.

## Inventory behavior

The server reads all pages before replacing a catalog snapshot. Products retain Shopify identities instead of merging by UPC. Only available variants contribute to the displayed price range. Condition is shown only when the source states it.

Successful snapshots are fresh for 60 seconds. If Shopify fails, the API can return an explicitly stale snapshot for up to five minutes from the last successful check. After that it returns an unavailable response. The browser also expires displayed data when it cannot refresh, so a network failure cannot leave old products looking current indefinitely.

The cache is in-memory and per server instance. It reduces repeat requests but is not durable or shared across Vercel instances. A cold instance refetches rather than inventing a cached state. For larger franchise rollouts, measure upstream traffic and add a shared cache or an authorized Shopify webhook integration if needed.

Product details preserve specification rows, headings, included-item lists, accessory exclusions, and condition notes as structured text. Upstream HTML never runs in the browser. Product photos use square frames without cropping, with thumbnail selection and horizontal swipe navigation.

This is browse-only. It does not reserve stock, place orders, collect customer details, or prove physical availability. Staff should confirm price, condition, and stock before a sale.
