# Scout Chrome Extension

## Overview

Scout is a versatile Chrome extension built with WXT (Web Extension Toolkit) and React. It provides essential tools for quick navigation, search, and controller testing with a powerful CMDK command palette and settings interface.

**Current Version:** v1.0.1 (Latest Release)

Key features:

- **CMDK Command Palette**: Arc-style command palette (CMD+Shift+K) for quick navigation, tab switching, and multi-provider search
- **Controller Testing**: Dedicated sidepanel (CMD+J) for testing game controllers with real-time input visualization
- **Scout Links**: Cached custom links from Google Sheets with 30-minute caching
- **Tab Switching**: Fast switching between open tabs with search and filter
- **Search Providers**: 14 integrated search providers including PayMore, Google, Amazon, Best Buy, eBay (sold listings), Price Charting, UPC Item DB (UPC - Codes), YouTube, GitHub, Twitter/X, Home Depot, Lowe's, Menards, and Micro Center
- **eBay Taxonomy API**: Direct integration with eBay's category taxonomy for quick category lookups
- **Bookmarks & History**: Access your 20 most recent bookmarks and last 30 visited pages (optionally select a bookmark folder)
- **Settings Page**: Configure which command sources are enabled/disabled with drag-and-drop reordering
- **Background Services**: Handle persistent tasks like API calls, storage, and notifications
- **Thank You Page**: Comprehensive post-installation page with feature documentation and pinning instructions
- **Enhanced Context Menu**: Improved right-click menu with additional quick actions

The project uses Tailwind CSS v4 for styling, TypeScript for type safety, and PNPM for package management.

## Screenshots

Here are some screenshots showcasing the key features of the Scout chrome extension:

### Command Menu

![Command Menu](public/assets/screenshots/command-menu.png)

### Controller Testing

![Controller Testing](public/assets/screenshots/controller-testing.png)

### eBay Price Summary

![eBay Price Summary](public/assets/screenshots/ebay-price-summary.png)

### Quick Actions

![Quick Actions](public/assets/screenshots/quick-actions.png)

### UPC Highlighter

![UPC Highlighter](public/assets/screenshots/upc-highlighter.png)

## Keyboard Shortcuts

The extension includes three keyboard shortcuts:

| Shortcut                       | Action             | Description                                                     |
| ------------------------------ | ------------------ | --------------------------------------------------------------- |
| `CMD+Shift+K` / `CTRL+Shift+K` | Open CMDK Popup    | Launch the command palette for quick navigation and search      |
| `CMD+Shift+O` / `CTRL+Shift+O` | Open Settings      | Access extension settings and configuration                     |
| `CMD+J` / `CTRL+J`             | Controller Testing | Open the controller testing sidepanel for gamepad input testing |

You can customize these shortcuts at `chrome://extensions/shortcuts`.

## CMDK Command Palette

The CMDK (Command Palette) is the fastest way to navigate, search, and access extension features. Press `CMD+Shift+K` to open it.

**Features:**

- **Scout Links** - Custom links from Google Sheets, cached for instant loading
- **Tab Switching** - Jump to any open tab by typing its title or URL
- **Bookmarks** - Search your 20 most recent bookmarks
- **Recent History** - Browse your last 30 visited pages
- **Search Providers** - Type a trigger word (e.g., "ama" + Tab) to search on:
  - Scout Search (`scout`, `search`)
  - Google (`google`, `g`)
  - Amazon (`amazon`, `ama`, `amz`)
  - Best Buy (`bestbuy`, `bb`, `best`)
  - eBay (`ebay`, `eb`) - Includes eBay Taxonomy API integration
  - Price Charting (`pricecharting`, `pc`, `price`)
  - UPC Item DB (`upc`, `upcitemdb`, `barcode`)
  - YouTube (`youtube`, `yt`)
  - GitHub (`github`, `gh`)
  - Twitter/X (`twitter`, `x`)
- **eBay Categories** - Query eBay's Taxonomy API directly for category lookups with copy-to-clipboard functionality
- **Source Ordering** - Drag and drop to reorder command sources in settings

For detailed CMDK documentation, see [CMDK_README.md](./CMDK_README.md).

## Controller Testing

The Controller Testing sidepanel provides real-time visualization and testing for game controllers. Press `CMD+J` to open it.

**Features:**

- **Real-time Input Visualization** - See controller inputs as they happen with color-coded feedback
- **Stick Movement Tracking** - Visual representation of left and right analog stick positions
- **Trigger Pressure** - Real-time display of L2/LT and R2/RT trigger pressure
- **Button State Monitoring** - All 20 controller buttons with press state and value display
- **Auto-Connect Detection** - Automatically detects and connects to available controllers
- **Performance Optimized** - 30fps update rate for smooth real-time feedback
- **Visual Controller Layout** - SVG-based controller diagram with live input highlighting

**Supported Controllers:**

- Xbox controllers (Xbox One, Xbox Series X/S)
- PlayStation controllers (DualShock 4, DualSense)
- Generic gamepads
- Any controller compatible with the Web Gamepad API

## Prerequisites

- Node.js (v18 or higher)
- PNPM (v8 or higher) - Install via `npm install -g pnpm`
- Chrome browser (for testing)

## Installation

1. Clone the repository:

   ```
   git clone https://github.com/JuanQuenga/scout.git
   cd scout
   ```

2. Install dependencies:

   ```
   pnpm install
   ```

3. Set up environment variables (if needed):
   - Copy `.env.example` to `.env.local` and fill in API keys (e.g., for PriceCharting API).

## Development

1. Start the development server:

   ```
   pnpm dev
   ```

   This builds the extension and serves it for hot-reloading. The extension will be available in the `.output` directory.

2. Load the extension in Chrome:

   - Open Chrome and go to `chrome://extensions/`.
   - Enable "Developer mode".
   - Click "Load unpacked" and select the `.output` directory.

3. For hot-reloading during development:
   - Changes to source files will trigger rebuilds.
   - Reload the extension in Chrome to see updates.

### Scripts

- `pnpm dev`: Development mode with hot-reloading.
- `pnpm build`: Production build.
- `pnpm preview`: Preview the built extension.

## Project Structure

```
scout/
├── entrypoints/          # Extension entry points
│   ├── background.ts     # Background script & command handlers
│   ├── popup/            # CMDK Command Palette (default popup)
│   ├── sidepanel/        # Controller Testing sidepanel
│   ├── options/          # Settings page
│   └── install/          # Installation page with Thank You content
├── public/               # Static assets (images, icons, etc.)
├── src/                  # Source code
│   ├── components/       # React components
│   │   ├── cmdk-palette/ # CMDK components & search providers
│   │   ├── sidepanel/    # Controller Testing components
│   │   ├── landing/      # Installation page components
│   │   ├── popups/       # Settings popup
│   │   └── ui/           # Reusable UI components
│   ├── lib/              # Utility libraries
│   ├── types/            # TypeScript type definitions
│   └── utils/            # Helper utilities (tab-manager, csv-links, bookmarks, history)
├── docs/                 # Documentation
├── releases/             # Release builds & changelog
├── scripts/              # Build and utility scripts
├── tailwind.config.ts    # Tailwind v4 configuration
├── wxt.config.ts         # WXT configuration (v1.0.2)
├── package.json          # Dependencies and scripts (v1.0.2)
└── tsconfig.json         # TypeScript configuration
```

## Key Configurations

- **WXT Config** ([wxt.config.ts](./wxt.config.ts)): Defines runtime, permissions, keyboard shortcuts, and entry points. Current version: **1.0.1**
- **Tailwind** ([tailwind.config.ts](./tailwind.config.ts)): Tailwind v4 with Vite plugin for class scanning and HMR
- **TypeScript**: Strict mode enabled for better code quality
- **Permissions**: storage, tabs, activeTab, bookmarks, history, contextMenus, sidePanel, scripting, system.display

## Building for Production

1. Build the extension:

   ```
   pnpm build
   ```

2. The output will be in `.output/`, ready for zipping and submission to Chrome Web Store.

3. To zip for store submission:
   ```
   pnpm zip
   ```
   This will create a zip file in the `.output` directory ready for Chrome Web Store submission.

## Testing

- **Manual Testing**: Load in Chrome and test CMDK popup and settings page
- **Unit Tests**: Add Jest or Vitest for component testing (not implemented yet)

## Deployment to Chrome Web Store

1. Create a developer account at [Chrome Web Store](https://chrome.google.com/webstore/devconsole).
2. Prepare assets: icons, screenshots (in `public/assets/`).
3. Upload the zip file generated from build.
4. Fill in store listing details (description provided separately).

## Releases

Stable releases are available in the [releases/](./releases/) folder. Download the latest version (v1.0.1) from the releases section.

See [releases/releases.md](./releases/releases.md) for detailed changelog and installation instructions.

### Quick Installation

1. Download [scout-1.0.1-chrome.zip](./releases/scout-1.0.1-chrome.zip)
2. Unzip the file
3. Open Chrome and navigate to `chrome://extensions/`
4. Enable "Developer mode" (toggle in top right)
5. Click "Load unpacked"
6. Select the unzipped `scout` folder

## Troubleshooting

### General Issues

- **Hot-reload not working**: Restart `pnpm dev` and reload extension
- **Content script issues**: Check console in page inspect (ensure permissions in manifest)
- **Build errors**: Verify Node/PNPM versions; clear cache with `pnpm store prune`
- **Tailwind styles missing**: Ensure PostCSS is configured correctly

### CMDK Issues

- **CMDK doesn't open**: Check `chrome://extensions/shortcuts` for keyboard shortcut conflicts
- **Scout Links not loading**: Check DevTools Console for CSV fetch errors; clear cache via `chrome.storage.local.clear()`
- **Bookmarks/History not showing**: Reload extension to re-request permissions
- **Arrow keys don't work**: Click inside the search input to focus it
- **eBay categories not loading**: Check internet connection and eBay API availability

### Controller Testing Issues

- **Controller not detected**: Ensure controller is connected via USB or Bluetooth and supported by your browser
- **No input visualization**: Check that the controller is properly connected and try refreshing the sidepanel
- **Sidepanel won't open**: Use `CMD+J` / `CTRL+J` or right-click the extension icon and select "Controller Testing"
- **Performance issues**: Close other tabs/applications that might be using the controller

For detailed CMDK troubleshooting, see [docs/CMDK_README.md](./docs/CMDK_README.md#troubleshooting).

## Contributing

1. Fork the repo.
2. Create a feature branch: `git checkout -b feature/amazing-feature`.
3. Commit changes: `git commit -m 'Add amazing feature'`.
4. Push: `git push origin feature/amazing-feature`.
5. Open a Pull Request.

## License

MIT License - see LICENSE file for details.

For issues or questions, open a GitHub issue.
