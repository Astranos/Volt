// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
/* global chrome */

import { defineContentScript } from "wxt/utils/define-content-script";

/**
 * Shopify Quick Actions Content Script
 *
 * Adds a vertical toolbar to the left of the main product card in Shopify Admin.
 * Provides quick access to:
 * 1. eBay Sold Listings (via MPN) - Green Tab
 * 2. PriceCharting (via UPC) - Blue Tab
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
      volt: chrome.runtime.getURL("assets/icons/volt.webp"),
      ebay: chrome.runtime.getURL("assets/logos/ebay.svg"),
      pricecharting: chrome.runtime.getURL("assets/logos/pricecharting.webp"),
    };

    // Styles
    const STYLES = `
      .volt-quick-actions-overlay {
        position: fixed;
        z-index: 100; /* Lowered to allow modals to cover it */
        display: flex;
        flex-direction: column;
        gap: 8px;
        pointer-events: none; /* Allow clicking through gaps */
        transition: opacity 0.2s ease;
      }

      .volt-action-tab {
        width: 48px;
        height: 120px;
        border-top-left-radius: 8px;
        border-bottom-left-radius: 8px;
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
        color: white;
        box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
        pointer-events: auto;
        position: relative;
        flex-shrink: 0;
      }

      .volt-action-tab img {
        width: 32px;
        height: 32px;
        object-fit: contain;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,0.1)) brightness(0) invert(1);
      }

      .volt-volt-badge {
        width: 48px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        pointer-events: auto;
      }

      .volt-volt-badge img {
        width: 20px;
        height: 20px;
        object-fit: contain;
        filter: none;
      }

      .volt-action-tab:hover {
        filter: brightness(0.9);
        box-shadow: -4px 0 12px rgba(0, 0, 0, 0.2);
      }

      .volt-action-tab:active {
        transform: translateX(-2px);
      }

      .volt-action-tab.disabled {
        opacity: 0.5;
        cursor: not-allowed;
        filter: grayscale(1);
        transform: none !important;
      }

      /* eBay Tab - Green */
      .volt-tab-ebay {
        background: linear-gradient(135deg, #10b981 0%, #059669 100%); /* Green */
      }

      /* PriceCharting Tab - Blue */
      .volt-tab-pricecharting {
        background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); /* Blue */
      }

      /* Tooltip */
      .volt-action-tab::after {
        content: attr(data-tooltip);
        position: absolute;
        left: 100%;
        top: 50%;
        transform: translateY(-50%);
        margin-left: 12px;
        background-color: #202223;
        color: white;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: all 0.2s ease;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        visibility: hidden;
      }

      .volt-action-tab:hover::after {
        opacity: 1;
        visibility: visible;
        margin-left: 16px;
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

    // State
    let mainCard = null;
    let productTitle = null;
    let upcValue = null;
    let overlay = null;
    let activePopup = null;
    let activePopupOpenedAt = 0;
    const POPUP_OPENING_GRACE_MS = 700;
    let hasLoggedMissingCard = false;
    let lastUrl = location.href;
    let isInitialized = false;

    const findTitleControl = () => {
      const direct = document.querySelector(
        'input[name="title"], input[id*="title" i], input[aria-label="Title"], input[placeholder="Title"]'
      ) as HTMLElement | null;
      if (direct) return direct;

      const shopifyField = document.querySelector(
        's-internal-text-field[name="title"], s-text-field[name="title"], [name="title"][label="Title"]'
      ) as HTMLElement | null;
      if (shopifyField) return shopifyField;

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

    const looksLikeProductCard = (el) => {
      if (!el || el === document.body) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 300 || rect.height < 120) return false;

      const classes = (el.className || "").toString();
      if (
        classes.includes("Polaris-ShadowBevel") ||
        classes.includes("Polaris-LegacyCard") ||
        classes.includes("Polaris-Card")
      ) {
        return true;
      }

      const style = window.getComputedStyle(el);
      return (
        style.backgroundColor === "rgb(255, 255, 255)" &&
        (style.boxShadow !== "none" ||
          style.borderRadius !== "0px" ||
          style.borderColor !== "rgba(0, 0, 0, 0)")
      );
    };

    // Find the main product card
    const findMainCard = () => {
      // Strategy: Look for the title input and go up to the card
      const titleControl = findTitleControl();
      if (titleControl) {
        const section = titleControl.closest(
          ".Polaris-Layout__Section"
        ) as HTMLElement | null;
        if (section) return section;

        let current = titleControl.parentElement;
        while (current && current !== document.body) {
          if (looksLikeProductCard(current)) {
            return current;
          }
          current = current.parentElement;
        }
      }

      const cards = Array.from(
        document.querySelectorAll(
          'main [class*="Polaris-ShadowBevel"], main [class*="Polaris-LegacyCard"], main [class*="Polaris-Card"], main section'
        )
      );
      const productCard = cards.find((card) => {
        if (!looksLikeProductCard(card)) return false;
        const text = card.textContent || "";
        return text.includes("Title") && text.includes("Description");
      });
      if (productCard) return productCard;

      return null;
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
        Array.from(document.querySelectorAll('[id*="metafields"]')).find(
          (el) => {
            const label = el.querySelector("label");
            return (
              label &&
              (label.textContent.includes("UPC") ||
                label.textContent.includes("Barcode"))
            );
          }
        );

      upcValue = extractMetafieldValue(upcContainer);
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

    // Create Overlay
    const createOverlay = () => {
      if (document.getElementById("volt-quick-actions-overlay")) return;

      overlay = document.createElement("div");
      overlay.id = "volt-quick-actions-overlay";
      overlay.className = "volt-quick-actions-overlay";
      overlay.style.opacity = "0"; // Start hidden until page is loaded

      // Volt Badge (Top)
      const voltBadge = document.createElement("div");
      voltBadge.className = "volt-volt-badge";
      const voltImg = document.createElement("img");
      voltImg.src = LOGO_URLS.volt;
      voltImg.alt = "Volt";
      voltBadge.appendChild(voltImg);

      // PriceCharting Tab (Blue)
      const pcTab = document.createElement("div");
      pcTab.className = "volt-action-tab volt-tab-pricecharting";
      pcTab.id = "volt-tab-pc";
      const pcImg = document.createElement("img");
      pcImg.src = LOGO_URLS.pricecharting;
      pcImg.alt = "PriceCharting";
      pcTab.appendChild(pcImg);
      pcTab.onclick = (e) => {
        e.stopPropagation();
        findFields();
        if (upcValue) {
          const url = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(
            upcValue
          )}&type=videogames`;
          openSearchPopup(url);
        }
      };

      // eBay Tab (Green) - Now searches by product title
      const ebayTab = document.createElement("div");
      ebayTab.className = "volt-action-tab volt-tab-ebay";
      ebayTab.id = "volt-tab-ebay";
      const ebayImg = document.createElement("img");
      ebayImg.src = LOGO_URLS.ebay;
      ebayImg.alt = "eBay";
      ebayTab.appendChild(ebayImg);
      ebayTab.onclick = (e) => {
        e.stopPropagation();
        findFields();
        if (productTitle) {
          const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(
            productTitle
          )}&LH_Sold=1&LH_Complete=1&_dmd=2&rt=nc`;
          openSearchPopup(url);
        }
      };

      overlay.appendChild(voltBadge);
      overlay.appendChild(pcTab);
      overlay.appendChild(ebayTab);
      document.body.appendChild(overlay);
    };

    // Update Overlay Position and State
    const updateOverlay = () => {
      if (!mainCard || !document.contains(mainCard)) {
        mainCard = findMainCard();
        if (!mainCard && !hasLoggedMissingCard) {
          hasLoggedMissingCard = true;
          log(
            "Could not find main product card, showing Shopify quick actions in fallback position."
          );
        }
      }

      if (!overlay) {
        return;
      }

      // If we couldn't find the main card, keep a visible fallback on product
      // pages so Shopify DOM changes do not make the actions disappear.
      if (!mainCard) {
        if (isProductPage()) {
          const titleControl = findTitleControl();
          const titleRect = titleControl?.getBoundingClientRect();
          if (titleRect && titleRect.width > 0 && titleRect.height > 0) {
            overlay.style.left = `${Math.max(16, titleRect.left - 64)}px`;
            overlay.style.top = `${Math.max(96, titleRect.top - 28)}px`;
            overlay.style.opacity = "1";
          } else {
            overlay.style.opacity = "0";
          }
        } else {
          overlay.style.opacity = "0";
        }
        return;
      }

      // Check if card is visible and has reasonable dimensions
      const rect = mainCard.getBoundingClientRect();
      const minWidth = 300; // Minimum width to consider card as "loaded"
      const minHeight = 200; // Minimum height to consider card as "loaded"

      if (
        rect.width === 0 ||
        rect.height === 0 ||
        rect.width < minWidth ||
        rect.height < minHeight
      ) {
        overlay.style.opacity = "0";
        return;
      }

      // Position logic: Left of the card
      const tabWidth = 48; // base width
      const gap = 8;
      const left = Math.max(16, rect.left - tabWidth - gap);
      const top = Math.max(96, rect.top + 24); // Offset from top of card

      overlay.style.left = `${left}px`;
      overlay.style.top = `${top}px`;
      overlay.style.opacity = "1";

      // Update States
      const pcTab = document.getElementById("volt-tab-pc");
      const ebayTab = document.getElementById("volt-tab-ebay");

      if (pcTab) {
        if (upcValue) {
          pcTab.classList.remove("disabled");
          pcTab.setAttribute(
            "data-tooltip",
            `Search PriceCharting with UPC: ${upcValue}`
          );
        } else {
          pcTab.classList.add("disabled");
          pcTab.setAttribute("data-tooltip", "No UPC found");
        }
      }

      if (ebayTab) {
        if (productTitle) {
          ebayTab.classList.remove("disabled");
          ebayTab.setAttribute(
            "data-tooltip",
            `Search eBay sold prices: ${
              productTitle.length > 40
                ? productTitle.slice(0, 40) + "..."
                : productTitle
            }`
          );
        } else {
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
      mainCard = null;
      productTitle = null;
      upcValue = null;
      hasLoggedMissingCard = false;
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
        const enabled = settings.shopifyButtons?.enabled ?? true;

        if (enabled) {
          init();
        }
      });
    };

    // Listen for settings changes
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "shopify-buttons-settings-changed") {
        if (message.enabled) {
          // Re-enable: check if already running or needs init
          if (!document.getElementById("volt-quick-actions-overlay")) {
            init();
          } else {
            // If overlay exists but was hidden/removed, ensure it's visible
            const overlay = document.getElementById(
              "volt-quick-actions-overlay"
            );
            if (overlay) {
              overlay.style.display = "flex";
            }
          }
        } else {
          // Disable: remove or hide overlay
          const overlay = document.getElementById(
            "volt-quick-actions-overlay"
          );
          if (overlay) {
            overlay.style.display = "none";
          }
        }
      }
    });

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", checkSettingsAndInit);
    } else {
      checkSettingsAndInit();
    }
  },
});
