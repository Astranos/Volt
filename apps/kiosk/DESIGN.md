# A product-first tablet catalog

Customers standing in the store need to find a device, inspect it, and ask for help. Marketing banners, account links, and checkout controls compete with that task. The kiosk keeps PayMore's green, white, and charcoal cues while giving the catalog most of the screen.

## Layout alternatives

Two layouts were considered before implementation:

| Area | Category-first home | Product-first catalog, selected |
| --- | --- | --- |
| First screen | Large tiles for phones, computers, gaming | Search, category controls, current product cards |
| First product | Requires choosing a category | Visible immediately |
| Mixed browsing | Return home to switch categories | Switch categories above the same catalog |
| Small-tablet tradeoff | Very simple, but spends a screen on navigation | More information, with controls kept compact and touch-friendly |

The selected layout keeps products visible without requiring customers to know a category. Search and filters work together, with an explicit reset when the customer wants to start again. Product details stay inside the kiosk.

## Application boundary

Embedding the kiosk inside Volt's existing account-oriented web app would reuse its app shell, but also couple public store browsing to authentication and scanner navigation. A separate workspace app reuses the modern frontend stack without those dependencies. This is a deployment boundary, not a legacy-technology fork.

The browser calls `/api/catalog?store=taylormi`. The server validates the slug, constructs its exact `*.paymore.com` host, fetches Shopify pages, validates their fields, and returns the shared `CatalogResponse` schema. Store metadata is optional enrichment from the same host. The browser owns search, filter, sort, detail, photo enlargement, and inactivity state. The server owns store selection, upstream validation, price ranges, and snapshot freshness.

A manual franchise registry was the initial design. Direct host resolution replaces it so new franchise URLs work without a code change. Arbitrary Shopify domains remain unsupported; requests stay within the PayMore namespace and never follow redirects. Each store has separate cached data, with a 64-store cache cap and 16 concurrent loads per process.

The existing Convex PayMore catalog remains a specification lookup. Its UPC-based merging and lack of store stock make it unsuitable as the kiosk's inventory source.

## Constraints to preserve

- Internal store codes never become public route names automatically.
- Exact public Shopify item SKUs remain visible for staff lookup, even when a SKU contains the internal store-code prefix.
- Listing specifications stay in tables. Included items and exclusions do not collapse into one text block.
- Square photos keep their full contents. Both the main image and thumbnail strip support horizontal photo navigation.
- Customer copy names an action or supplies information. No marketing slogans or decorative eyebrow text.
- No user-supplied upstream hosts, Shopify admin credentials, or private Volt data enter the kiosk.
- An incomplete upstream crawl never replaces a complete snapshot.
- Sold variants do not contribute to available choices or prices.
- Stale data is labeled and expires. An unavailable feed is not an empty store.
- The modern React and TypeScript stack stays intact. Responsive design is not a promise of legacy Safari support.
- No customer login, shared cart, advertising trackers, or persistent customer search history.

## Remaining rollout checks

Confirm permission to use each franchise's feed and branding. Test touch interaction, the on-screen keyboard, portrait and landscape layouts, and kiosk locking on the actual tablet. Set up the separate hosting project and domain only after approving the experience.
