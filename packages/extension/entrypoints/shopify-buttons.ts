// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
/* global chrome */

import { defineContentScript } from "wxt/utils/define-content-script";

/**
 * Shopify Quick Actions Content Script
 *
 * Adds product research actions in a reserved gutter, with a compact inline fallback.
 * Provides quick access to:
 * 1. eBay Sold Listings (via product title) - Green Tab
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
        position: relative;
        display: flex;
        flex-direction: row;
        justify-content: flex-end;
        align-items: center;
        gap: 6px;
        margin-bottom: 4px;
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .volt-action-tab {
        height: 28px;
        padding: 0 9px;
        gap: 5px;
        border: 0;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: white;
        font-size: 11px;
        font-weight: 600;
        line-height: 1;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
        pointer-events: auto;
        position: relative;
        flex-shrink: 0;
      }

      .volt-action-tab img {
        width: 16px;
        height: 16px;
        object-fit: contain;
        filter: brightness(0) invert(1);
      }

      .volt-volt-badge {
        width: 18px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .volt-volt-badge img {
        width: 16px;
        height: 16px;
        object-fit: contain;
      }

      .volt-quick-actions-overlay[data-layout="gutter"] {
        position: fixed;
        flex-direction: column;
        gap: 8px;
        width: 36px;
        margin: 0;
        z-index: 40;
      }

      .volt-quick-actions-overlay[data-layout="gutter"] .volt-action-tab {
        width: 36px;
        height: 36px;
        padding: 0;
        border-radius: 8px;
      }

      .volt-quick-actions-overlay[data-layout="gutter"] .volt-action-tab img {
        width: 22px;
        height: 22px;
      }

      .volt-quick-actions-overlay[data-layout="gutter"] .volt-action-label {
        display: none;
      }

      .volt-action-tab:hover {
        filter: brightness(0.9);
        box-shadow: -4px 0 12px rgba(0, 0, 0, 0.2);
      }

      .volt-action-tab:focus-visible {
        outline: 2px solid #202223;
        outline-offset: 3px;
      }

      .volt-action-tab:active {
        transform: translateY(1px);
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
        right: 0;
        top: 100%;
        margin-top: 8px;
        background-color: #202223;
        color: white;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        white-space: normal;
        width: max-content;
        max-width: 160px;
        box-sizing: border-box;
        overflow-wrap: anywhere;
        opacity: 0;
        pointer-events: none;
        transition: all 0.2s ease;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        visibility: hidden;
      }

      .volt-quick-actions-overlay[data-layout="gutter"] .volt-action-tab::after {
        left: calc(100% + 8px);
        right: auto;
        top: 0;
        margin-top: 0;
      }

      .volt-action-tab:hover::after {
        opacity: 1;
        visibility: visible;
        margin-top: 10px;
      }

      .volt-quick-actions-overlay[data-layout="gutter"] .volt-action-tab:hover::after {
        margin-top: 0;
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
    const GUTTER_WIDTH = 52;
    const MIN_GUTTER_CARD_WIDTH = 560;
    let reservedCard = null;
    let reservedStyles = [];
    let mainCard = null;

    // Only undo values we still own; Shopify may update inline styles during navigation.
    const releaseGutter = () => {
      if (reservedCard) {
        for (const saved of reservedStyles) {
          if (reservedCard.style.getPropertyValue(saved.name) !== saved.applied ||
            reservedCard.style.getPropertyPriority(saved.name) !== saved.appliedPriority) continue;
          if (saved.value) reservedCard.style.setProperty(saved.name, saved.value, saved.priority);
          else reservedCard.style.removeProperty(saved.name);
        }
      }
      reservedCard = null;
      reservedStyles = [];
    };

    const reserveGutter = (card) => {
      if (reservedCard === card) return;
      releaseGutter();
      const computed = window.getComputedStyle(card);
      const startMargin = parseFloat(computed.marginInlineStart) || 0;
      const endMargin = parseFloat(computed.marginInlineEnd) || 0;
      const cap = `calc(100% - ${GUTTER_WIDTH + startMargin + endMargin}px)`;
      const maxWidth = computed.maxWidth && computed.maxWidth !== "none"
        ? `min(${computed.maxWidth}, ${cap})` : cap;
      reservedCard = card;
      reservedStyles = [
        ["margin-inline-start", `${startMargin + GUTTER_WIDTH}px`],
        ["max-width", maxWidth],
      ].map(([name, applied]) => ({
        name, applied, value: card.style.getPropertyValue(name),
        priority: card.style.getPropertyPriority(name),
      }));
      for (const saved of reservedStyles) {
        card.style.setProperty(saved.name, saved.applied);
        // CSSOM can canonicalize nested calc() in min(); compare the stored value.
        saved.applied = card.style.getPropertyValue(saved.name);
        saved.appliedPriority = card.style.getPropertyPriority(saved.name);
      }
    };
    let productTitle = null;
    let upcValue = null;
    let overlay = null;
    let activePopup = null;
    let activePopupOpenedAt = 0;
    const POPUP_OPENING_GRACE_MS = 700;
    let hasLoggedMissingCard = false;
    let lastUrl = location.href;
    let isInitialized = false;
    let buttonsEnabled = false;

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
      const shopifySection =
        findShopifyTitleField()?.closest("s-internal-section");
      const sectionCard =
        shopifySection?.shadowRoot?.querySelector("section");
      if (sectionCard && looksLikeProductCard(sectionCard)) {
        return shopifySection;
      }

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
      const pcTab = document.createElement("button");
      pcTab.type = "button";
      pcTab.setAttribute("aria-label", "Search PriceCharting by UPC");
      pcTab.className = "volt-action-tab volt-tab-pricecharting";
      pcTab.id = "volt-tab-pc";
      const pcImg = document.createElement("img");
      pcImg.src = LOGO_URLS.pricecharting;
      pcImg.alt = "PriceCharting";
      pcTab.appendChild(pcImg);
      const pcLabel = document.createElement("span");
      pcLabel.className = "volt-action-label";
      pcLabel.textContent = "UPC";
      pcTab.appendChild(pcLabel);
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
      const ebayTab = document.createElement("button");
      ebayTab.type = "button";
      ebayTab.setAttribute("aria-label", "Search eBay sold listings");
      ebayTab.className = "volt-action-tab volt-tab-ebay";
      ebayTab.id = "volt-tab-ebay";
      const ebayImg = document.createElement("img");
      ebayImg.src = LOGO_URLS.ebay;
      ebayImg.alt = "eBay";
      ebayTab.appendChild(ebayImg);
      const ebayLabel = document.createElement("span");
      ebayLabel.className = "volt-action-label";
      ebayLabel.textContent = "eBay";
      ebayTab.appendChild(ebayLabel);
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
      overlay.setAttribute("role", "toolbar");
      overlay.setAttribute("aria-label", "Volt product research");
    };

    // Update Overlay Position and State
    const updateOverlay = () => {
      if (!mainCard || !document.contains(mainCard)) {
        mainCard = findMainCard();
        if (!mainCard && !hasLoggedMissingCard) {
          hasLoggedMissingCard = true;
          log(
            "Could not find main product card, placing Shopify quick actions above the title field."
          );
        }
      }

      if (!overlay) {
        return;
      }

      if (!buttonsEnabled || !isProductPage()) {
        releaseGutter();
        overlay.remove();
        return;
      }

      // Keep Shopify-owned nodes in place. Reserve a gutter on the light-DOM card
      // and position the actions outside its shadow section's clipping boundary.
      const titleField = findShopifyTitleField() || findTitleControl();
      const container = mainCard || titleField?.parentElement;
      if (!container) {
        releaseGutter();
        overlay.remove();
        return;
      }
      if (reservedCard && reservedCard !== mainCard) releaseGutter();
      const bounds = container.getBoundingClientRect();
      const unreservedWidth = bounds.width + (reservedCard === container ? GUTTER_WIDTH : 0);
      const gutterFitsViewport = bounds.left >= 0 &&
        (!window.innerWidth || bounds.left + 36 <= window.innerWidth);
      const useGutter = mainCard && bounds.height > 0 && gutterFitsViewport &&
        unreservedWidth >= MIN_GUTTER_CARD_WIDTH;
      if (useGutter) {
        reserveGutter(mainCard);
        const cardBounds = mainCard.getBoundingClientRect();
        if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
        overlay.dataset.layout = "gutter";
        const left = `${cardBounds.left - GUTTER_WIDTH}px`;
        const top = `${cardBounds.top + 16}px`;
        if (overlay.style.left !== left) overlay.style.left = left;
        if (overlay.style.top !== top) overlay.style.top = top;
      } else {
        releaseGutter();
        overlay.dataset.layout = "inline";
        overlay.style.removeProperty("left");
        overlay.style.removeProperty("top");
        if (overlay.parentElement !== container) container.insertBefore(overlay, container.firstChild);
      }
      overlay.style.opacity = "1";

      // Update States
      const pcTab = document.getElementById("volt-tab-pc");
      const ebayTab = document.getElementById("volt-tab-ebay");

      if (pcTab) {
        if (upcValue) {
          pcTab.disabled = false;
          pcTab.classList.remove("disabled");
          pcTab.setAttribute(
            "data-tooltip",
            `Search PriceCharting with UPC: ${upcValue}`
          );
        } else {
          pcTab.disabled = true;
          pcTab.classList.add("disabled");
          pcTab.setAttribute("data-tooltip", "No UPC found");
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
            }`
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
        buttonsEnabled = settings.shopifyButtons?.enabled ?? true;

        if (buttonsEnabled) {
          init();
        }
      });
    };

    // Listen for settings changes
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
