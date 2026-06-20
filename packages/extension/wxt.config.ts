import { defineConfig, type WxtViteConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  // Use the official Tailwind v4 Vite plugin for class scanning + HMR.
  vite: () => ({ plugins: [tailwindcss()] }) as WxtViteConfig,
  outDir: ".output", // Base output directory
  outDirTemplate: "volt", // Custom output directory name (removes browser/manifest folder nesting)
  manifest: {
    content_scripts: [
      {
        matches: ["<all_urls>"],
        js: ["context-menu.js"],
        run_at: "document_idle",
        all_frames: true,
        match_about_blank: true,
      },
      {
        matches: ["<all_urls>"],
        js: ["upc-highlighter.js"],
        run_at: "document_idle",
        all_frames: true,
      },
      {
        matches: [
          "https://admin.shopify.com/*",
          "https://*.myshopify.com/admin/*",
        ],
        js: ["shopify-buttons.js", "shopify-product-search.js"],

        run_at: "document_idle",
      },
      {
        matches: ["https://www.ebay.com/sch/*"],
        js: ["ebay-sold-listing-warning.js"],
        run_at: "document_idle",
      },
      {
        matches: ["<all_urls>"],
        js: ["link-previewer.js"],
        run_at: "document_start",
      },
    ],
    name: "Volt",
    version: "1.0.40",
    description:
      "A versatile Chrome extension with command palette, mobile scanner pairing, and multi-provider search capabilities.",
    permissions: [
      "storage",
      "tabs",
      "activeTab",
      "scripting",
      "sidePanel",
      "offscreen",
      "system.display",
      // Needed for adding right-click context menu actions
      "contextMenus",
      "clipboardRead",
      "clipboardWrite",
      // Needed for CMDK bookmarks and history
      "bookmarks",
      "history",
      // Needed for Save As button in context menu
      "downloads",
      // Needed for accessing recently closed tabs
      "sessions",
      // Needed to wake the service worker so saved mobile sessions can reconnect without opening extension UI
      "alarms",
      // Needed by Chrome Push API so Convex signaling can wake the service worker for saved mobile scanner reconnects
      "notifications",
      "favicon",
    ],
    host_permissions: ["<all_urls>"],
    icons: {
      16: "assets/icons/logo-16.png",
      32: "assets/icons/logo-32.png",
      48: "assets/icons/logo-48.png",
      128: "assets/icons/logo-128.png",
    },
    action: {
      default_icon: {
        16: "assets/icons/logo-16.png",
        32: "assets/icons/logo-32.png",
        48: "assets/icons/logo-48.png",
        128: "assets/icons/logo-128.png",
      },
    },
    side_panel: {
      default_path: "sidepanel.html",
    },
    options_page: "options.html",
    web_accessible_resources: [
      {
        resources: ["assets/images/*"],
        matches: ["<all_urls>"],
      },
      {
        resources: ["assets/icons/*"],
        matches: ["<all_urls>"],
      },
      {
        resources: ["assets/logos/*"],
        matches: ["<all_urls>"],
      },
    ],
    commands: {
      _execute_action: {
        suggested_key: {
          default: "Ctrl+Shift+K",
          mac: "Command+Shift+K",
        },
        description: "Open Volt Command Palette",
      },
      "open-options": {
        suggested_key: {
          default: "Ctrl+Shift+O",
          mac: "Command+Shift+O",
        },
        description: "Open Volt Web Extension Options",
      },
      "reopen-last-tab": {
        suggested_key: {
          default: "Ctrl+Shift+Z",
          mac: "Command+Shift+Z",
        },
        description: "Reopen last closed tab",
      },
      "promote-preview": {
        description: "Promote preview popup to a full tab",
      },
    },
    chrome_url_overrides: {
      newtab: "newtab.html",
    },
  },
} as any);
