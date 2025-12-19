# Omnibox Commands Plan (New Tab Search Modes)

## Goal

Add **custom omnibox commands** that match the three search buttons at the top of the New Tab page:

- **PriceCharting**
- **eBay (sold/completed listings)**
- **Shopify Admin inventory search** (current store)

Users should be able to type a keyword in Chrome’s address bar, then a short command + query, and have the extension open the correct destination.

## Current Behavior to Mirror

- **New Tab buttons** live in `src/components/newtab/ClosedTabsPanel.tsx` and set `activeMode` to one of:
  - `pricecharting`
  - `ebay`
  - `shopify`
- **Provider URLs** for eBay + PriceCharting already exist in `src/components/cmdk-palette/SearchProviders.tsx`:
  - `ebay`: `https://www.ebay.com/sch/i.html?_nkw={query}&LH_Sold=1&LH_Complete=1&_dmd=2&rt=nc`
  - `pricecharting`: `https://www.pricecharting.com/search-products?q={query}&type=videogames`
- **Shopify inventory search** is built dynamically in `entrypoints/newtab/NewTab.tsx`:
  - Uses cached `chrome.storage.local` key: `scout_shopify_store`
  - If missing, attempts to resolve store name by scanning open tabs (`admin.shopify.com/store/<name>` or `<name>.myshopify.com`)
  - Final URL format:
    - `https://admin.shopify.com/store/${storeName}/products?query=${query}&order=inventory_total%20desc`

## Proposed Omnibox UX

### Keyword

Use a single omnibox keyword (Chrome limitation: 1 keyword per extension).

Recommendation: **`volt`**

Alternative: **`volt`** (matches extension name in `wxt.config.ts`)

### Command grammar (after the keyword)

Examples assume keyword `volt`:

- **PriceCharting**:
  - `volt pc <query>`
  - `volt pricecharting <query>`
- **eBay**:
  - `volt eb <query>`
  - `volt ebay <query>`
- **Shopify inventory**:
  - `volt inv <query>`
  - `volt shopify <query>`

### Quality-of-life

- **Empty input**: show help suggestions (command list).
- **Unknown command**: treat entire input as a query and show suggestions for “Search eBay / PriceCharting / Inventory for: …”.
- **Disposition support**: respect `chrome.omnibox.onInputEntered`’s `disposition`:
  - `currentTab`: update active tab URL
  - `newForegroundTab` / `newBackgroundTab`: open a new tab accordingly

## Manifest + Wiring (WXT)

### 1) Add `omnibox` key to the manifest

Update `wxt.config.ts`:

- Add:
  - `omnibox: { keyword: "scout" }` (or `"volt"`)

Notes:

- No `"omnibox"` permission is required; omnibox is configured via manifest key.
- Existing permissions (`tabs`, `storage`) are already sufficient for URL navigation + Shopify store lookup.

### 2) Add omnibox listeners in the MV3 service worker

Update `entrypoints/background.ts`:

- Register:
  - `chrome.omnibox.onInputChanged.addListener((text, suggest) => { ... })`
  - `chrome.omnibox.onInputEntered.addListener((text, disposition) => { ... })`

Implementation approach:

- Create a small parser:
  - Split input into: `cmd` + `query`
  - Normalize `cmd` to one of: `ebay | pricecharting | shopify | null`
- Build URLs:
  - eBay + PriceCharting: reuse templates from `SearchProviders.tsx` (copy the strings OR export a small shared helper in `src/lib/` to avoid duplication).
  - Shopify inventory:
    - Try `chrome.storage.local.get("scout_shopify_store")`
    - If missing, `chrome.tabs.query({})` and extract store name from URLs (same regex approach as New Tab)
    - If still missing:
      - Suggest opening `https://admin.shopify.com/` (so the user signs in / lands on a store), and/or
      - Provide an omnibox suggestion explaining “Open Shopify Admin to detect store”

## File-Level Plan

### A) `wxt.config.ts`

- Add `manifest.omnibox.keyword`.

### B) `entrypoints/background.ts`

- Add omnibox handlers (parser + `suggest()` + open/update tab logic).
- Add a shared helper inside the file or extracted helper functions:
  - `parseOmniboxInput(text)`
  - `buildEbayUrl(query)`
  - `buildPriceChartingUrl(query)`
  - `resolveShopifyStoreName()` (storage-first, tabs-second)
  - `buildShopifyInventoryUrl(storeName, query)`
  - `navigateTo(url, disposition)`

### C) (Optional) `src/lib/omnibox-search.ts`

If we want to avoid duplicating strings/logic across UI + background:

- Export URL builders for eBay + PriceCharting using the same constants as `SearchProviders.tsx`.
- Export Shopify store-resolution helper (can be reused later by other entrypoints).

## Testing Checklist

- **Manual smoke**:
  - Type: `scout eb iphone 15` → navigates to eBay sold/completed results for “iphone 15”
  - Type: `scout pc mario kart` → navigates to PriceCharting search
  - Type: `scout inv airpods` with a known store cached → opens Shopify inventory products search
- **Shopify resolution**:
  - With an existing tab on `admin.shopify.com/store/<store>`: `scout inv socks` resolves store and navigates
  - With no Shopify tabs and no cached store: suggestion/behavior is sensible (opens Shopify Admin or instructs user)
- **Tab disposition**:
  - Enter vs Cmd+Enter behavior (foreground/background) works as expected.

## Alternatives (if you want different UX)

- **Separate keywords per provider**: not possible with a single extension (Chrome omnibox supports one keyword).
- **Use `chrome.commands` instead**: could map hotkeys to “Search eBay / Search PriceCharting / Search Inventory” and prompt for input via a small popup UI; still keep omnibox as the primary fast-path.


