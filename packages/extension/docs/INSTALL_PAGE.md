# Volt Thank You Page

This document describes the thank you page for the Volt Chrome extension.

## Overview

The thank you page provides a user-friendly interface that appears after installing the Volt extension. It thanks the user for installing, provides instructions for pinning the extension, and showcases all the features available in Volt.

## Files

- `src/components/landing/ThankYouPage.tsx` - The main React component for the thank you page
- `entrypoints/install/index.html` - HTML template for the thank you page
- `entrypoints/install/main.tsx` - Entry point that renders the ThankYouPage component

## Features

### Thank You Message

The thank you page displays a welcoming message to users who have just installed Volt, encouraging them to pin the extension for easy access.

### Pinning Instructions

The page includes detailed instructions on how to pin the Volt extension to the Chrome toolbar, with step-by-step guidance and visual cues.

### Feature Highlights

The page showcases all key features of Volt:

#### Core Features

- **Command Menu (CMD+Shift+K)** - Arc-style command palette for quick navigation, tab switching, and multi-provider search
- **Mobile Scanner** - Pair the iPhone app and receive barcode, OCR, dictation, and photo captures through the sidepanel
- **Offer Calculator** - Sidepanel calculator for resale cash-guide offers
- **Volt Links** - Custom links from Google Sheets with 30-minute caching and custom URL support
- **14 Search Providers** - Google, Amazon, Best Buy, eBay, Price Charting, UPC Item DB, YouTube, GitHub, Twitter/X, Home Depot, Lowe's, Menards, Micro Center, and Volt Search
- **eBay Taxonomy API** - Direct integration for quick category lookups with copy-to-clipboard

#### Content Enhancement Features

- **eBay Price Summary** - Automatic price statistics on eBay sold listings (average, median, high, low) with clickable metrics and quick filters
- **UPC Highlighter** - Automatic detection and highlighting of 12-digit UPC codes with click-to-copy functionality
- **Shopify Buttons** - Buttons to quickly view market pricing for products.

#### Navigation & Customization

- **Tab Switching** - Fast switching between open tabs with search and filter
- **Bookmarks & History** - Access your 20 most recent bookmarks and last 30 visited pages with folder filtering
- **Settings Page** - Configure command sources, drag-and-drop reordering, customize search providers
- **Context Menu** - Right-click search actions for eBay, UPC, MPN, and Price Charting
- **Lightning Fast performance** - Optimized with caching and efficient rendering
- **Secure & Private** - No data collection, all processing happens locally

### Download Section

Users can download the latest version directly from the install page with a single click.

## Pinning the Extension

After installing the Volt extension, users should pin it to their Chrome toolbar for quick access:

### Why Pin the Extension?

- Quick access to the extension icon
- Easy visual indicator that Volt is active
- One-click access to extension features
- Faster access to the popup menu

### How to Pin

1. Click the **Extensions icon** (puzzle piece) in the Chrome toolbar
2. Find **Volt** in the list of extensions
3. Click the **pin icon** next to Volt
4. The Volt icon will now appear in your toolbar

Alternatively:

- Navigate to `chrome://extensions/`
- Find Volt and ensure it's enabled
- Click the Extensions icon (puzzle piece) in the toolbar
- Pin Volt from the dropdown

## Accessing the Install Page

### From the Landing Page

1. Open the extension options page
2. Click the "Install Extension" button in the header

### Direct URL

The install page can be accessed directly at:

```
chrome-extension://[EXTENSION_ID]/install.html
```

Replace `[EXTENSION_ID]` with the actual ID of your installed extension.

## Testing

To test the install page functionality:

1. Load the extension in developer mode
2. Open `chrome-extension://[EXTENSION_ID]/install.html`
3. Confirm the page renders the install content and primary call to action
4. Open `chrome-extension://[EXTENSION_ID]/options.html`
5. Confirm the landing/options page links back to the install flow where expected

## Building

The install page is automatically included when building the extension:

```bash
pnpm build:extension
```

The install page will be available at `packages/extension/.output/volt/install.html`.

### WXT Configuration

The install page is automatically detected by WXT as an "unlisted-page" entrypoint. No additional configuration is required in `wxt.config.ts`. The page is accessible via `chrome.runtime.getURL("/install.html")` from within the extension.

## Customization

### Modifying Thank You Message

Edit the thank you message in `ThankYouPage.tsx` to customize the post-installation experience. The component uses a welcoming approach with clear pinning instructions.

### Updating Features

Modify the `mainFeatures` array in `ThankYouPage.tsx` to update the feature highlights. Each feature includes:

- Title and description
- Icon from lucide-react
- Screenshot image path
- How-to-use steps or subsections
- Features list (for simpler features)

### Changing Download Link

If you need to update the download link, modify the reference in `ThankYouPage.tsx`. The current release structure uses the GitHub releases or a direct download link format.

## Browser Compatibility

The thank you page is designed for Google Chrome. A compatibility notice is shown for non-Chrome browsers.

## Styling

The thank you page uses Tailwind CSS for styling and follows the same design system as the rest of the extension.

## Troubleshooting

### Thank You Page Not Loading

1. Ensure the extension is properly loaded in developer mode
2. Check the browser console for any errors
3. Verify that all files are correctly built

### Styling Issues

1. Check that Tailwind CSS is properly configured
2. Verify that the CSS file is correctly imported
3. Check for any CSS conflicts in the browser console
