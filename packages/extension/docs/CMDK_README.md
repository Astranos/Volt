# CMDK Command Palette

Arc-style command palette for quick navigation, tab switching, and site-specific search.

## Features

✅ **Extension Popup** - CMDK opens as the default extension popup (CMD+Shift+K)
✅ **Tab Switching** - Lists all open tabs with favicon, title, and URL
✅ **Volt Links from CSV** - Cached custom links from Google Sheets (30-min cache)
✅ **Sidepanel Tool Launch** - Quick access to Mobile Scanner from the command palette
✅ **Bookmarks** - Shows your 20 most recent bookmarks
✅ **Recent History** - Displays last 30 visited pages
✅ **Search Providers** - Google, Volt Search, Amazon, Best Buy, eBay, PriceCharting, BarcodeLookup, UPCItemDB, YouTube, GitHub, Twitter/X, Home Depot, Lowe's, Menards, and Micro Center
✅ **Auto-complete** - Type "ama" + Tab → activates Amazon search
✅ **Provider Badges** - Visual indicator when provider is active
✅ **Keyboard Navigation** - Arrow keys, Enter, Escape, Tab
✅ **Return to Previous Tab** - Press Enter on empty input (when no items selected)
✅ **Green Accent Colors** - Consistent green theme throughout
✅ **Loading Skeletons** - Smooth loading states for Volt Links
✅ **Empty State** - Helpful icon and message when no results found

## Keyboard Shortcuts

| Shortcut                       | Action                           |
| ------------------------------ | -------------------------------- |
| `CMD+Shift+K` / `CTRL+Shift+K` | Open CMDK popup                  |
| `CMD+Shift+O` / `CTRL+Shift+O` | Open extension options           |
| `CMD+Shift+Z` / `CTRL+Shift+Z` | Reopen last closed tab           |
| `↑` / `↓`                      | Navigate results                 |
| `Enter`                        | Select item / Execute search     |
| `Tab`                          | Activate search provider         |
| `Escape`                       | Close CMDK / Deactivate provider |

## Architecture

### Popup-Based Design

The CMDK is implemented as the **default extension popup** (not a content script overlay). This provides:

- **No CSS conflicts** with webpage styles
- **Consistent styling** across all pages
- **Works on all Chrome pages** (including chrome:// URLs)
- **Better performance** with isolated context

### Content Script vs Popup

- **Old Setup**: CMDK was injected into webpages (had CSS conflicts)
- **New Setup**: CMDK is the extension popup (clean separation)
- **Options Page**: Previous popup moved to dedicated options page

## Display Order

When you open the CMDK, items appear in this order:

1. **Volt Links** - Grouped by category, sorted alphabetically (Warranty category first)
2. **Open Tabs** - Currently open browser tabs
3. **Tools** - Selected sidepanel tools
4. **Bookmarks** - Your 20 most recent bookmarks
5. **Recent History** - Last 30 visited pages
6. **Search Providers** - When typing search triggers

## Volt Links (CSV)

Volt Links are loaded from Google Sheets and **cached for 30 minutes** for instant loading.

**CSV Configuration**: [../src/utils/csv-links.ts](../src/utils/csv-links.ts)

**CSV Format**:

```csv
Category,Title,URL,Description
Warranty,Apple Warranty,https://checkcoverage.apple.com,Check Apple device warranty
Tools,Price Charting,https://pricecharting.com,View market prices
```

**Features**:

- Cached in Chrome storage (30-minute TTL)
- Background refresh when cache exists
- Sorted alphabetically by category
- "Warranty" category always appears first
- Skeleton loading UI on first load

## Search Providers

Type a trigger word and press **Tab** to activate:

| Provider       | Triggers                       | URL                                           |
| -------------- | ------------------------------ | --------------------------------------------- |
| Volt Search   | `volt`, `search`              | https://google.com/search/                    |
| Google         | `google`, `g`                  | https://www.google.com/search                 |
| Amazon         | `amazon`, `ama`, `amz`         | https://www.amazon.com/s                      |
| Best Buy       | `bestbuy`, `bb`, `best`        | https://www.bestbuy.com/site/searchpage.jsp   |
| eBay           | `ebay`, `eb`                   | eBay sold listings search                     |
| Price Charting | `pricecharting`, `pc`, `price` | https://www.pricecharting.com/search-products |
| UPC Item DB    | `upc`, `upcitemdb`, `barcode`  | https://www.upcitemdb.com/search              |
| YouTube        | `youtube`, `yt`                | https://www.youtube.com/results               |
| GitHub         | `github`, `gh`                 | https://github.com/search                     |
| Twitter/X      | `twitter`, `x`                 | https://twitter.com/search                    |

**Add more in**: [../src/components/cmdk-palette/SearchProviders.tsx](../src/components/cmdk-palette/SearchProviders.tsx)

## Sidepanel Tool Integration

The command palette exposes selected sidepanel tools. Press Enter to open the tool in the Chrome sidepanel.

- Mobile Scanner

The sidepanel tool registry lives in [../src/lib/sidepanel-tools.ts](../src/lib/sidepanel-tools.ts). The command-palette allowlist is in [../src/components/cmdk-palette/CMDKPalette.tsx](../src/components/cmdk-palette/CMDKPalette.tsx).

## File Structure

```
src/
├── components/
│   ├── cmdk-palette/
│   │   ├── CMDKPalette.tsx       # Main CMDK component
│   │   ├── TabItem.tsx           # Tab display component
│   │   ├── CSVLinkItem.tsx       # Quick link display
│   │   ├── BookmarkItem.tsx      # Bookmark display
│   │   ├── HistoryItem.tsx       # History display
│   │   ├── SearchProviders.tsx   # Provider configs
│   │   └── styles.css            # CMDK styling
│   └── ui/
│       └── skeleton.tsx          # Loading skeleton
└── utils/
    ├── tab-manager.ts            # Tab operations
    ├── csv-links.ts              # CSV fetching & caching
    ├── bookmarks.ts              # Bookmark fetching
    └── history.ts                # History fetching

entrypoints/
├── popup/
│   ├── index.html                # Popup HTML
│   └── main.tsx                  # Popup entry
├── options/                      # Settings page
├── newtab/                       # New-tab replacement
├── sidepanel/                    # Unified sidepanel
└── background.ts                 # Message handlers
```

## Implementation Details

### Caching Strategy

Volt Links use a smart caching system:

```typescript
// First open: Show skeleton → Fetch CSV → Cache for 30 min
// Subsequent opens: Load from cache instantly → Refresh in background
```

**Cache location**: `chrome.storage.local`
**Cache duration**: 30 minutes
**Cache keys**: `csvLinksCache`, `csvLinksCacheTimestamp`

### Arrow Key Selection

The CMDK tracks user navigation to determine behavior:

- **No arrow keys used** + Empty input + Enter → Return to previous tab
- **Arrow keys used** + Enter → Select highlighted item
- **Search provider active** + Enter → Execute search

### Styling

- **Accent color**: Green (`text-green-500`, `bg-green-100`, etc.)
- **Icons**: From `lucide-react` library
- **Empty state**: Search icon with helpful message
- **Dark mode**: Full support via `prefers-color-scheme`

### Permissions Required

```json
{
  "permissions": [
    "storage", // Cache Volt Links
    "tabs", // Tab switching
    "bookmarks", // Show bookmarks
    "history" // Show recent history
  ]
}
```

## Usage Examples

### Basic Tab Switching

1. Press `CMD+Shift+K`
2. Start typing tab name
3. Press `↓` to select
4. Press `Enter` to switch

### Search on Amazon

1. Press `CMD+Shift+K`
2. Type `ama` then press `Tab`
3. Type `iPhone 15`
4. Press `Enter` → Opens Amazon search in new tab

### Access Volt Links

1. Press `CMD+Shift+K`
2. Volt Links appear at top (cached instantly)
3. Type to filter or use arrow keys
4. Press `Enter` to open

### Open Mobile Scanner

1. Press `CMD+Shift+K`
2. Type `mobile scanner`
3. Press `Enter` → Opens Mobile Scanner in the sidepanel

### Browse Bookmarks

1. Press `CMD+Shift+K`
2. Scroll to "Bookmarks" section
3. Use arrow keys to navigate
4. Press `Enter` to open

## Troubleshooting

### CMDK doesn't open

- **Check**: Extension is loaded and active
- **Check**: Keyboard shortcut isn't conflicting
- **Fix**: Go to `chrome://extensions/shortcuts` to verify/change shortcuts

### Volt Links not loading

- **Check**: DevTools Console for CSV fetch errors
- **Fix**: Clear cache via `chrome.storage.local.clear()` in DevTools
- **Check**: CSV URL is accessible (view raw CSV in browser)

### Bookmarks/History not showing

- **Check**: Extension has required permissions
- **Fix**: Reload extension to re-request permissions

### Styling looks broken

- **Check**: Tailwind classes are loading
- **Fix**: Rebuild extension (`pnpm build:extension` from the repo root or `pnpm build` from `packages/extension`)
- **Fix**: Hard refresh the popup (close and reopen)

### Arrow keys don't work

- **Check**: Focus is in the CMDK input
- **Fix**: Click inside the search input first

## Performance

- **Tab list**: Fetched on-demand from Chrome Tabs API (~5ms)
- **Volt Links**: Cached, instant load after first fetch
- **Bookmarks**: Fetched on-demand, limited to 20 items
- **History**: Fetched on-demand, limited to 30 items
- **No virtualizing**: Works well up to ~500 total items
- **Filtering**: Client-side, instant with `Array.filter()`

## Development

### Adding a New Search Provider

Edit [SearchProviders.tsx](../src/components/cmdk-palette/SearchProviders.tsx):

```typescript
{
  id: "mysite",
  name: "My Site",
  trigger: ["mysite", "ms"],
  searchUrl: "https://mysite.com/search?q={query}",
  icon: Search,
  color: "bg-purple-500",
}
```

### Changing Cache Duration

Edit [csv-links.ts](../src/utils/csv-links.ts):

```typescript
const CACHE_DURATION = 1000 * 60 * 30; // 30 minutes
// Change to: 1000 * 60 * 60 for 1 hour
```

### Modifying Display Order

Reorder the `Command.Group` sections in [CMDKPalette.tsx](../src/components/cmdk-palette/CMDKPalette.tsx):

```tsx
{
  /* Volt Links - appears first */
}
{
  /* Tabs - appears second */
}
{
  /* Tools - appears third */
}
{
  /* Bookmarks - appears fourth */
}
{
  /* History - appears fifth */
}
```

## Known Limitations

1. **Chrome limits popup size** to 800px width max
2. **History API** limited to last 3 months by default
3. **Bookmark folders** not shown (flat list only)
4. **No fuzzy search** - uses simple substring matching

## Future Improvements

- [ ] Fuzzy search for better matching
- [ ] Bookmark folder navigation
- [ ] History with timestamps
- [ ] Recent searches persistence
- [ ] Custom keyboard shortcuts per action
- [ ] Export/import Volt Links
- [ ] Quick Link categories customization
