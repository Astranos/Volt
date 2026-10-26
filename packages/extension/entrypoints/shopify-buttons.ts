// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
/* global chrome */

import { defineContentScript } from "wxt/utils/define-content-script";

/**
 * Shopify Quick Actions Content Script
 *
 * Adds compact product research actions on the Title label row. It never moves
 * or resizes Shopify's own layout.
 * Provides quick access to:
 * 1. eBay Sold Listings (via product title)
 * 2. PriceCharting (via UPC)
 */
export default defineContentScript({
  matches: ["https://admin.shopify.com/*", "https://*.myshopify.com/*"],
  runAt: "document_idle",
  allFrames: false,
  main() {
    const log = (...args) => {
      try {
        console.log("[Volt - Shopify Buttons]", ...args);
      } catch (_) {}
    };

    // Logo URLs
    const LOGO_URLS = {
      ebay: chrome.runtime.getURL("assets/logos/ebay-wordmark.svg"),
      pricecharting: chrome.runtime.getURL("assets/logos/pricecharting.webp"),
    };

    // Styles
    const STYLES = `
      .volt-quick-actions-overlay {
        position: fixed;
        /* Shopify's AppFrameBevel paints at 100, above body-level siblings. */
        z-index: 101;
        display: flex;
        flex-direction: row;
        justify-content: flex-end;
        align-items: center;
        width: max-content;
        height: 28px;
        margin: 0;
        box-sizing: border-box;
        border: 1px solid #d6d8da;
        border-radius: 7px;
        background: #fff;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .volt-action-tab {
        height: 26px;
        padding: 0 8px;
        gap: 5px;
        border: 0;
        border-radius: 0;
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: #45474a;
        font-size: 11px;
        font-weight: 500;
        line-height: 1;
        position: relative;
        flex-shrink: 0;
        box-sizing: border-box;
        transition: background-color 0.15s ease;
      }

      .volt-action-tab:first-child {
        border-radius: 6px 0 0 6px;
      }

      .volt-action-tab:last-child {
        border-radius: 0 6px 6px 0;
      }

      .volt-action-tab + .volt-action-tab {
        border-left: 1px solid #e6e7e8;
      }

      .volt-action-tab img {
        width: 16px;
        height: 16px;
        object-fit: contain;
      }

      .volt-tab-ebay img {
        width: 34px;
        height: 14px;
      }

      /* Compact enough to share the label row without crowding the input. */
      .volt-quick-actions-overlay[data-layout="title"] {
        height: 24px;
      }

      .volt-quick-actions-overlay[data-layout="title"] .volt-action-tab {
        height: 22px;
        padding: 0 7px;
      }

      .volt-quick-actions-overlay[data-layout="title"] .volt-action-tab img {
        width: 14px;
        height: 14px;
      }

      .volt-quick-actions-overlay[data-layout="title"] .volt-tab-ebay img {
        width: 30px;
        height: 12px;
      }

      .volt-action-tab:hover:not(:disabled) {
        background: #f3f4f5;
      }

      .volt-action-tab:focus-visible {
        outline: 2px solid #5c6ac4;
        outline-offset: 2px;
        z-index: 1;
      }

      .volt-action-tab:active:not(:disabled) {
        background: #e8eaed;
      }

      .volt-action-tab.disabled {
        cursor: not-allowed;
      }

      /* Fade only the contents: opacity on the button would also fade its tooltip. */
      .volt-action-tab.disabled > * {
        opacity: 0.45;
      }

      .volt-action-tab::after {
        content: attr(data-tooltip);
        position: absolute;
        right: 0;
        top: calc(100% + 8px);
        background-color: #202223;
        color: white;
        padding: 6px 10px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 400;
        line-height: 1.4;
        white-space: pre-line;
        width: max-content;
        max-width: 180px;
        box-sizing: border-box;
        overflow-wrap: anywhere;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s ease;
        z-index: 1000;
        box-shadow: 0 2px 6px rgba(0,0,0,0.12);
        visibility: hidden;
      }

      .volt-action-tab:hover::after,
      .volt-action-tab:focus-visible::after {
        opacity: 1;
        visibility: visible;
      }
    `;

    // Inject styles
    const injectStyles = () => {
      if (!document.getElementById("volt-quick-actions-styles")) {
        const styleElement = document.createElement("style");
        styleElement.textContent = STYLES;
        styleElement.id = "volt-quick-actions-styles";
        (document.head || document.documentElement).appendChild(styleElement);
      }
    };

    // Shopify's web-component hosts (s-internal-section, s-internal-text-field)
    // can be display: contents, so they measure 0x0 and ignore margins. Measure
    // and pad the first element that actually renders, searching shadow children
    // before slotted ones.
    const renderedBox = (el, depth = 0) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return el;
      if (depth >= 4) return null;
      for (const child of [...(el.shadowRoot?.children || []), ...(el.children || [])]) {
        const found = renderedBox(child, depth + 1);
        if (found) return found;
      }
      return null;
    };

    // State
    let productTitle = null;
    let upcValue = null;
    // Used for PriceCharting when a product has no UPC.
    let gameName = null;
    let platform = null;
    let overlay = null;
    let activePopup = null;
    let activePopupOpenedAt = 0;
    const POPUP_OPENING_GRACE_MS = 700;
    let lastUrl = location.href;
    let isInitialized = false;
    let buttonsEnabled = false;
    // Always a popup, ignoring the menus' open-in setting: a modifier or middle click opens a tab.
    const NEW_TAB_HINT = `${/Mac/i.test(globalThis.navigator?.platform || "") ? "\u2318-click" : "Ctrl+click"} or middle-click to open in a new tab`;

    const findShopifyTitleField = () =>
      document.querySelector(
        's-internal-text-field[name="title"], s-text-field[name="title"], [name="title"][label="Title"]'
      ) as HTMLElement | null;

    const findTitleControl = () => {
      const direct = document.querySelector(
        'input[name="title"], input[id*="title" i], input[aria-label="Title"], input[placeholder="Title"]'
      ) as HTMLElement | null;
      if (direct) return direct;

      const shopifyField = findShopifyTitleField();
      if (shopifyField) {
        const shadowInput = shopifyField.shadowRoot?.querySelector("input");
        return shadowInput || shopifyField;
      }

      const titleLabel = Array.from(document.querySelectorAll("label")).find(
        (label) => label.textContent?.trim().toLowerCase() === "title"
      );
      const labelledId = titleLabel?.getAttribute("for");
      if (labelledId) {
        const labelledInput = document.getElementById(
          labelledId
        ) as HTMLElement | null;
        if (labelledInput?.tagName === "INPUT") return labelledInput;
      }

      const labelledWrapper = titleLabel?.closest("div");
      return (
        (labelledWrapper?.querySelector("input") as HTMLInputElement | null) ||
        null
      );
    };

    const getControlValue = (control) => {
      if (!control) return "";
      const value = control.value || control.getAttribute?.("value") || "";
      if (value) return String(value).trim();

      const input = control.querySelector?.("input");
      if (input?.value) return input.value.trim();

      const shadowInput = control.shadowRoot?.querySelector?.("input");
      if (shadowInput?.value) return shadowInput.value.trim();

      return "";
    };

    // Generic function to extract value from a metafield container
    const extractMetafieldValue = (container) => {
      if (!container) return null;

      const readField = container.querySelector('[class*="_ReadField_"]');
      if (readField && !readField.className.includes("placeholder")) {
        return readField.textContent?.trim() || null;
      }

      const input = container.querySelector("input");
      if (input) return input.value;

      // Shopify's quick metafield keeps its value input inside an open shadow
      // root. Read the input, including an empty edit, rather than display text.
      const quickField = container.querySelector("s-internal-quick-text-field");
      const shadowInput = quickField?.shadowRoot?.querySelector("input");
      if (shadowInput) return shadowInput.value.trim() || null;

      return null;
    };

    // Find Metafields
    const findFields = () => {
      // Find product title
      const titleInput = findTitleControl();
      productTitle =
        getControlValue(titleInput) ||
        document.querySelector("h1")?.textContent?.replace(/\s+Active$/, "") ||
        null;

      // Find UPC
      const upcContainer =
        document.querySelector('[id*="metafields.custom.upc"]') ||
        document.querySelector('[id*="metafields.custom.barcode"]') ||
        document.querySelector('[id*="metafields.barcode"]') ||
        findMetafieldByLabel(/UPC|Barcode/);

      upcValue = extractMetafieldValue(upcContainer);
      gameName = extractMetafieldValue(findMetafieldByLabel(/\bgame\s*(name|title)\b/i));
      platform = extractMetafieldValue(findMetafieldByLabel(/\b(platform|console)\b/i));
    };

    const findMetafieldByLabel = (pattern) =>
      Array.from(document.querySelectorAll('[id*="metafields"]')).find((el) => {
        const label = el.querySelector("label");
        return label && pattern.test(label.textContent);
      });

    // UPC first; otherwise the game name (or product title) plus its platform.
    const getPriceChartingQuery = () => {
      if (upcValue) return { query: upcValue, by: "UPC" };
      const name = gameName || productTitle;
      if (!name) return null;
      const withPlatform = platform && !name.toLowerCase().includes(platform.toLowerCase());
      return {
        query: withPlatform ? `${name} ${platform}` : name,
        by: gameName ? (withPlatform ? "game name + platform" : "game name") : (withPlatform ? "title + platform" : "title"),
      };
    };

    // Open Popup Helper
    const openSearchPopup = (url) => {
      const width = 1100;
      const height = 800;
      const x = window.screen.width / 2;
      const y = window.screen.height / 2;

      try {
        chrome.runtime.sendMessage(
          {
            action: "openPreviewPopup",
            url,
            x,
            y,
          },
          () => {
            const err = chrome.runtime.lastError;
            if (!err) return;

            if (activePopup && !activePopup.closed) {
              activePopup.close();
            }

            const left = x - width / 2;
            const top = y - height / 2;
            activePopup = window.open(
              url,
              "volt_search_popup",
              `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
            );
            activePopupOpenedAt = Date.now();
          }
        );
      } catch (_) {
        if (activePopup && !activePopup.closed) {
          activePopup.close();
        }

        const left = x - width / 2;
        const top = y - height / 2;
        activePopup = window.open(
          url,
          "volt_search_popup",
          `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
        );
        activePopupOpenedAt = Date.now();
      }
    };

    // Modifier and middle clicks follow browser link conventions.
    const openResearch = (url, event) => {
      const newTab = event?.metaKey || event?.ctrlKey ||
        event?.button === 1;
      if (!newTab) {
        openSearchPopup(url);
        return;
      }
      try {
        chrome.runtime.sendMessage({ action: "openUrl", url }, (response) => {
          if (chrome.runtime.lastError || response?.success === false) window.open(url, "_blank", "noopener");
        });
      } catch (_) {
        window.open(url, "_blank", "noopener");
      }
    };

    const getPriceChartingUrl = () => {
      const search = getPriceChartingQuery();
      return search && `https://www.pricecharting.com/search-products?q=${encodeURIComponent(search.query)}&type=videogames`;
    };
    const getEbayUrl = () => productTitle &&
      `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(productTitle)}&LH_Sold=1&LH_Complete=1&_dmd=2&rt=nc`;

    const bindResearchAction = (button, getUrl) => {
      const run = (e) => {
        e.preventDefault?.();
        e.stopPropagation();
        findFields();
        const url = getUrl();
        if (url) openResearch(url, e);
      };
      button.onclick = run;
      button.onauxclick = (e) => {
        if (e.button === 1) run(e);
      };
      // Stop middle-click autoscroll so the auxclick reaches the button.
      button.onmousedown = (e) => {
        if (e.button === 1) e.preventDefault();
      };
    };

    // Create Overlay
    const createOverlay = () => {
      if (document.getElementById("volt-quick-actions-overlay")) return;

      overlay = document.createElement("div");
      overlay.id = "volt-quick-actions-overlay";
      overlay.className = "volt-quick-actions-overlay";
      overlay.dataset.layout = "title";
      overlay.style.visibility = "hidden"; // Hidden until placed

      // PriceCharting search
      const pcTab = document.createElement("button");
      pcTab.type = "button";
      pcTab.setAttribute("aria-label", "Search PriceCharting");
      pcTab.className = "volt-action-tab volt-tab-pricecharting";
      pcTab.id = "volt-tab-pc";
      const pcImg = document.createElement("img");
      pcImg.src = LOGO_URLS.pricecharting;
      pcImg.alt = "PriceCharting";
      pcTab.appendChild(pcImg);
      const pcLabel = document.createElement("span");
      pcLabel.className = "volt-action-label";
      pcLabel.textContent = "PriceCharting";
      pcTab.appendChild(pcLabel);
      bindResearchAction(pcTab, getPriceChartingUrl);

      // eBay sold listings search
      const ebayTab = document.createElement("button");
      ebayTab.type = "button";
      ebayTab.setAttribute("aria-label", "Search eBay sold listings");
      ebayTab.className = "volt-action-tab volt-tab-ebay";
      ebayTab.id = "volt-tab-ebay";
      const ebayImg = document.createElement("img");
      ebayImg.src = LOGO_URLS.ebay;
      ebayImg.alt = "eBay";
      ebayTab.appendChild(ebayImg);
      bindResearchAction(ebayTab, getEbayUrl);

      overlay.appendChild(pcTab);
      overlay.appendChild(ebayTab);
      overlay.setAttribute("role", "toolbar");
      overlay.setAttribute("aria-label", "Volt product research");
    };

    // Bounds of the label's visible text, wherever Shopify nests it.
    const findLabelTextBounds = (titleField, input) => {
      const label = titleField.shadowRoot?.querySelector("label") ||
        (input?.id ? Array.from(document.querySelectorAll("label[for]"))
          .find((candidate) => candidate.htmlFor === input.id) : null);
      if (!label || !document.createRange) return null;
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const bounds = range.getBoundingClientRect?.();
        if (bounds?.height > 0) return bounds;
      }
      return null;
    };

    // Sit at the right end of the title's label row: bottom-aligned with the
    // "Title" text so the gap above the input matches the label's. Only the
    // input's box is required, so unknown label markup can't strand the toolbar.
    const findTitlePlacement = (titleField) => {
      if (!titleField || !overlay) return null;
      const input = titleField.tagName === "INPUT" ? titleField :
        titleField.shadowRoot?.querySelector("input");
      const inputBounds = (input || titleField).getBoundingClientRect();
      const fieldBounds = (renderedBox(titleField) || input || titleField).getBoundingClientRect();
      const toolbar = overlay.getBoundingClientRect();
      if (!inputBounds.width || !inputBounds.height || !toolbar.width) return null;
      const fieldRight = fieldBounds.right ?? fieldBounds.left + fieldBounds.width;
      const labelText = findLabelTextBounds(titleField, input);
      const bottom = labelText && labelText.bottom <= inputBounds.top
        ? labelText.bottom : inputBounds.top - 8;
      return {
        left: Math.max(fieldBounds.left, fieldRight - toolbar.width),
        top: Math.min(bottom, inputBounds.top - 4) - toolbar.height,
      };
    };

    // Update Overlay Position and State
    const updateOverlay = () => {
      const titleField = findShopifyTitleField() || findTitleControl();
      if (!overlay) {
        return;
      }

      if (!buttonsEnabled || !isProductPage()) {
        overlay.remove();
        return;
      }

      // Keep Shopify-owned nodes in place: the toolbar always lives in <body> with
      // fixed coordinates, so it escapes shadow-root clipping and can be measured.
      if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
      const placement = findTitlePlacement(titleField);
      if (!placement) {
        overlay.style.visibility = "hidden";
      } else {
        const left = `${placement.left}px`;
        const top = `${placement.top}px`;
        if (overlay.style.left !== left) overlay.style.left = left;
        if (overlay.style.top !== top) overlay.style.top = top;
        overlay.style.visibility = "";
      }

      // Update States
      const pcTab = document.getElementById("volt-tab-pc");
      const ebayTab = document.getElementById("volt-tab-ebay");
      const tooltipHint = `\n${NEW_TAB_HINT}`;

      if (pcTab) {
        const search = getPriceChartingQuery();
        if (search) {
          pcTab.disabled = false;
          pcTab.classList.remove("disabled");
          const query = search.query.length > 40 ? search.query.slice(0, 40) + "..." : search.query;
          pcTab.setAttribute(
            "data-tooltip",
            `Search PriceCharting by ${search.by}: ${query}${tooltipHint}`
          );
        } else {
          pcTab.disabled = true;
          pcTab.classList.add("disabled");
          pcTab.setAttribute("data-tooltip", "No UPC or product name found");
        }
      }

      if (ebayTab) {
        if (productTitle) {
          ebayTab.disabled = false;
          ebayTab.classList.remove("disabled");
          ebayTab.setAttribute(
            "data-tooltip",
            `Search eBay sold prices: ${
              productTitle.length > 40
                ? productTitle.slice(0, 40) + "..."
                : productTitle
            }${tooltipHint}`
          );
        } else {
          ebayTab.disabled = true;
          ebayTab.classList.add("disabled");
          ebayTab.setAttribute("data-tooltip", "No product title found");
        }
      }
    };

    // Animation Loop for smooth positioning
    const loop = () => {
      updateOverlay();
      requestAnimationFrame(loop);
    };

    // Reset state for new page navigation
    const resetState = () => {
      productTitle = null;
      upcValue = null;
      gameName = null;
      platform = null;
      log("State reset for new page navigation");
    };

    // Check if current URL is a product page
    const isProductPage = () => {
      const url = location.href;
      // Match product pages like /products/123 or /products/123/variants
      return /\/products\/\d+/.test(url);
    };

    // Handle URL changes (for SPA navigation)
    const handleUrlChange = () => {
      const currentUrl = location.href;
      if (currentUrl !== lastUrl) {
        log("URL changed:", lastUrl, "->", currentUrl);
        lastUrl = currentUrl;
        resetState();
        // Re-find fields after a short delay to let the DOM update
        setTimeout(findFields, 500);
        setTimeout(findFields, 1500); // Check again after more DOM updates
      }
    };

    // Initialize
    const init = () => {
      if (isInitialized) {
        log("Already initialized, skipping");
        return;
      }
      isInitialized = true;
      log("Initializing Shopify Quick Actions content script");
      injectStyles();

      // Listen for window focus to close popup
      window.addEventListener("focus", () => {
        if (
          activePopup &&
          !activePopup.closed &&
          Date.now() - activePopupOpenedAt >= POPUP_OPENING_GRACE_MS
        ) {
          activePopup.close();
          activePopup = null;
        }
      });

      // Listen for SPA navigation events
      window.addEventListener("popstate", handleUrlChange);

      // Intercept pushState and replaceState for SPA navigation detection
      const originalPushState = history.pushState;
      const originalReplaceState = history.replaceState;

      history.pushState = function (...args) {
        originalPushState.apply(this, args);
        handleUrlChange();
      };

      history.replaceState = function (...args) {
        originalReplaceState.apply(this, args);
        handleUrlChange();
      };

      // Observe for DOM changes
      const observer = new MutationObserver(() => {
        findFields();
        // Also check for URL changes in case they weren't caught by history API
        handleUrlChange();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["value", "class"],
      });

      // Start loop
      createOverlay();
      requestAnimationFrame(loop);

      // Periodic check for fields and URL changes
      setInterval(() => {
        findFields();
        handleUrlChange();
      }, 2000);
    };

    const checkSettingsAndInit = () => {
      chrome.storage.sync.get(["cmdkSettings"], (result) => {
        const settings = result.cmdkSettings || {};
        buttonsEnabled = settings.shopifyButtons?.enabled ?? true;

        if (buttonsEnabled) {
          init();
        }
      });
    };

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "shopify-buttons-settings-changed") {
        buttonsEnabled = Boolean(message.enabled);
        if (buttonsEnabled) init();
        updateOverlay();
      }
    });

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", checkSettingsAndInit);
    } else {
      checkSettingsAndInit();
    }
  },
});
