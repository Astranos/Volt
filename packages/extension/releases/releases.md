# Scout Chrome Extension Releases

Download the latest version of the Scout Chrome Extension.

## Latest Release

### v1.0.2 (Current)

**Release Date:** October 16, 2025
**Download:** [scout-1.0.2-chrome.zip](./scout-1.0.2-chrome.zip)

**What's New:**

This update includes bug fixes and usability improvements based on user feedback, focusing on context menu behavior and settings stability.

### Fixes

- **Context Menu Shortcut**: Changed from `Alt+Right-click` to `Ctrl+Right-click` to show native browser menu instead of Scout menu
- **Settings Stability**: Fixed potential undefined error in bookmark folder settings initialization
- **Code Cleanup**: Removed unused radial menu code and improved overall code organization

### Improvements

- **Better User Experience**: More intuitive keyboard shortcut for accessing native context menu
- **Enhanced Reliability**: Improved error handling in settings management
- **Performance**: Streamlined code by removing deprecated features

## Previous Release

### v1.0.0

**Release Date:** October 12, 2025
**Download:** [scout-1.0.0-chrome.zip](./scout-1.0.0-chrome.zip)

**What's New:**

This was the first release of Scout, a versatile browser extension with command palette, controller testing, and multi-provider search capabilities.

### Features

- **CMDK Command Palette**: Arc-style command palette accessible via `CMD+Shift+K` / `CTRL+Shift+K`
- **Controller Testing**: Real-time game controller input visualization via `CMD+J` / `CTRL+J`
- **Scout Links**: Cached custom links from Google Sheets with 30-minute caching for instant access
- **Tab Switching**: Fast switching between open tabs with search and filter
- **Search Providers**: 10 integrated search engines including Google, Amazon, Best Buy, eBay, Price Charting, UPC Item DB, YouTube, GitHub, and Twitter/X
- **Bookmarks & History**: Access your 20 most recent bookmarks and last 30 visited pages
- **Settings Page**: Configure which command sources are enabled/disabled via `CMD+Shift+O` / `CTRL+Shift+O`
- **Auto-Save Settings**: Changes to settings are automatically saved
- **Smart Navigation**: Backspace to exit search providers, arrow keys for navigation
- **Enhanced Context Menu Options**: Right-click search options for selected text including:
  - Search on UPCItemDB
  - Search for UPC on Google
  - Search on PriceCharting
  - Search for MPN on Google
- **eBay Taxonomy Integration**: Query eBay's category taxonomy directly from the command palette

### Keyboard Shortcuts

- `CMD+Shift+K` / `CTRL+Shift+K` - Open CMDK popup
- `CMD+Shift+O` / `CTRL+Shift+O` - Open settings page
- `CMD+J` / `CTRL+J` - Open controller testing sidepanel

### Installation

1. Download [scout-1.0.0-chrome.zip](./scout-1.0.0-chrome.zip)
2. Unzip the file
3. Open Chrome and navigate to `chrome://extensions/`
4. Enable "Developer mode" (toggle in top right)
5. Click "Load unpacked"
6. Select the unzipped `scout` folder

## Installation Instructions

1. Download `scout-1.0.0-chrome.zip`
2. Extract the ZIP file to a folder on your computer
3. Open Chrome and go to `chrome://extensions/`
4. Enable "Developer mode" in the top right
5. Click "Load unpacked"
6. Navigate to the extracted folder and select the `scout` folder
7. The extension will be installed and ready to use

### For Chrome Web Store Submission

The packed version is ready for Chrome Web Store upload via the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)

## Keyboard Shortcuts Setup

After installation, you can customize keyboard shortcuts:

1. Go to `chrome://extensions/shortcuts`
2. Find "Scout" extension
3. Customize shortcuts for:
   - Open CMDK popup (default: `CMD+Shift+K`)
   - Open settings page (default: `CMD+Shift+O`)

## Notes

- Always download from official releases to ensure security
- For the latest features and bug fixes, use the current release (v1.0.0)
- CMDK requires `bookmarks` and `history` permissions (granted on install)
- Scout Links are cached for 30 minutes in Chrome storage
- If you encounter issues, check the [CMDK_README.md](../CMDK_README.md) for troubleshooting
- Settings changes are automatically saved

## Changelog Summary

**v1.0.2** - Bug fixes and usability improvements including context menu shortcut changes and settings stability
**v1.0.1** - Enhanced user experience with install page, improved context menu, and better controller detection  
**v1.0.0** - Initial Release with CMDK Command Palette, Controller Testing, Settings Page, and Multi-Platform Search

For questions or support, open an issue on the GitHub repository.
