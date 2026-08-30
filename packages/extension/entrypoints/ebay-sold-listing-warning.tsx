/* global window, document */

import { defineContentScript } from "wxt/utils/define-content-script";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { initializeSidePanelContext } from "../src/lib/sidepanel-gesture";
import SoldListingWarning from "../src/components/content/SoldListingWarning";
import {
  buildEbaySoldListingsUrl,
  getEbayListingState,
  getPrimaryEbayPriceElements,
  isEbaySearchUrl,
} from "../src/domain/ebay-sold-listings";
import type { SyncStorageResult } from "../src/types/settings";

/**
 * Adds a fixed pricing warning to eBay search result pages when
 * the user is viewing active or completed asking prices.
 *
 * This script runs on eBay search pages (https://www.ebay.com/sch/*).
 */
export default defineContentScript({
  matches: ["https://www.ebay.com/sch/*"],
  runAt: "document_idle",
  allFrames: false,
  main() {
    // Early safety check: ensure we're on an eBay search page
    if (
      !isEbaySearchUrl(window.location.href)
    ) {
      console.log("⚡ [Volt Sold Listing Warning] Not on eBay search page, exiting");
      return;
    }

    // Initialize side panel context early
    initializeSidePanelContext();

    console.log("⚡ [Volt Sold Listing Warning] SCRIPT LOADED");

    const WARNING_ID = "volt-sold-listing-warning";
    const STYLE_ID = "volt-sold-listing-warning-style";
    const CONTAINER_ID = "volt-sold-listing-warning-container";
    const PRICE_WRAPPER_SELECTOR = "[data-volt-active-price-wrapper]";
    const RESULT_CARD_SELECTOR = ".s-item, .s-card";
    const ACTIVE_PRICE_SELECTOR = [
      ".srp-results .s-item__price",
      ".srp-results .s-card__price",
      ".srp-river-results .s-item__price",
      ".srp-river-results .s-card__price",
      "[data-testid='srp-river-results'] .s-item__price",
      "[data-testid='srp-river-results'] .s-card__price",
      ".s-item .s-item__price",
      ".s-card .s-card__price",
    ].join(", ");
    let root: Root | null = null;
    let isDismissed = false;
    let isEnabled = true;
    let lastUrl = window.location.href;
    let updateQueued = false;

    const log = (...args: unknown[]) => {
      try {
        console.log("[Volt Sold Listing Warning]", ...args);
      } catch {}
    };

    // Inject CSS styles (required for content scripts on external pages)
    const ensureStyles = () => {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        #${WARNING_ID} {
          position: fixed;
          top: 84px;
          right: 16px;
          z-index: 2147483647;
          width: min(336px, calc(100vw - 32px));
          padding: 14px;
          border: 1px solid #d7d9dc;
          border-radius: 10px;
          background: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
          color: #111820;
          box-shadow: 0 6px 18px rgba(17, 24, 32, 0.14);
          box-sizing: border-box;
        }

        #${WARNING_ID}.volt-state-active {
          border-color: #e3c19e;
        }

        #${WARNING_ID} .volt-sold-listing-warning__header {
          display: flex;
          align-items: center;
          min-height: 24px;
          gap: 8px;
        }

        #${WARNING_ID} .volt-sold-listing-warning__status-icon {
          flex: none;
          color: #a5480b;
        }

        #${WARNING_ID} .volt-sold-listing-warning__title {
          font-size: 14px;
          margin: 0;
          font-weight: 650;
          color: #111820;
          letter-spacing: 0;
          line-height: 1.3;
        }

        #${WARNING_ID} .volt-sold-listing-warning__content {
          margin: 7px 0 12px 25px;
          font-size: 13px;
          color: #52606d;
          line-height: 1.42;
        }

        #${WARNING_ID} .volt-sold-listing-warning__primary {
          height: 32px;
          margin-left: 25px;
          border: 0;
          border-radius: 7px;
          padding: 0 12px;
          background: #19783d;
          color: #ffffff;
          font-size: 12px;
          font-weight: 650;
          line-height: 1;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        #${WARNING_ID} .volt-sold-listing-warning__primary:hover {
          background: #125f30;
        }

        #${WARNING_ID} .volt-sold-listing-warning__primary:active {
          background: #0f5128;
        }

        #${WARNING_ID} .volt-sold-listing-warning__actions {
          display: flex;
          align-items: center;
          gap: 2px;
          margin-left: auto;
        }

        #${WARNING_ID} .volt-sold-listing-warning__dismiss,
        #${WARNING_ID} .volt-sold-listing-warning__settings {
          background: transparent;
          border: none;
          border-radius: 5px;
          width: 26px;
          height: 26px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
          color: #667481;
          transition: background 0.15s ease, color 0.15s ease;
        }

        #${WARNING_ID} .volt-sold-listing-warning__dismiss:hover {
          background: #f1f2f3;
          color: #111820;
        }

        #${WARNING_ID} .volt-sold-listing-warning__settings:hover {
          background: #f1f2f3;
          color: #111820;
        }

        .volt-active-listing-price-wrapper {
          position: relative !important;
          display: inline-grid !important;
          grid-template-areas: "price" !important;
          align-items: center !important;
          justify-items: center !important;
          width: max-content !important;
          max-width: 100% !important;
          isolation: isolate !important;
        }

        .volt-active-listing-price {
          pointer-events: none !important;
          user-select: none !important;
        }

        .volt-active-listing-price-values {
          grid-area: price !important;
          display: inline-flex !important;
          align-items: baseline !important;
          filter: blur(7px) !important;
          opacity: 0.72 !important;
          pointer-events: none !important;
          user-select: none !important;
        }

        .volt-active-listing-price-switch {
          grid-area: price !important;
          z-index: 1 !important;
          min-height: 26px !important;
          margin: 0 !important;
          padding: 4px 9px !important;
          border: 1px solid rgba(15, 23, 42, 0.22) !important;
          border-radius: 999px !important;
          background: rgba(255, 255, 255, 0.94) !important;
          color: #0f172a !important;
          box-shadow: 0 2px 8px rgba(15, 23, 42, 0.14) !important;
          font: 700 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif !important;
          white-space: nowrap !important;
          cursor: pointer !important;
        }

        .volt-active-listing-price-switch:hover {
          background: #0f172a !important;
          color: #ffffff !important;
        }

        @media (max-width: 640px) {
          #${WARNING_ID} {
            top: auto;
            right: 12px;
            bottom: 14px;
            left: 12px;
            width: auto;
          }
        }
      `;
      document.head.appendChild(style);
    };

    const ensureContainer = () => {
      // Check if already exists
      let container = document.getElementById(CONTAINER_ID);
      if (container) {
        return container;
      }

      // Create container
      container = document.createElement("div");
      container.id = CONTAINER_ID;

      // Keep the overlay out of eBay's page flow so loading it never shifts results.
      document.body.appendChild(container);

      log("✓ Sold listing warning container inserted");
      return container;
    };

    const removePriceProtection = () => {
      document
        .querySelectorAll<HTMLElement>(PRICE_WRAPPER_SELECTOR)
        .forEach((wrapper) => {
          const prices = wrapper.querySelectorAll<HTMLElement>(
            ":scope > .volt-active-listing-price-values > .volt-active-listing-price"
          );
          prices.forEach((price) => {
            price.classList.remove("volt-active-listing-price");
            wrapper.parentNode?.insertBefore(price, wrapper);
          });
          wrapper.remove();
        });
    };

    const addPriceProtection = () => {
      document
        .querySelectorAll<HTMLElement>(RESULT_CARD_SELECTOR)
        .forEach((card) => {
          if (card.querySelector(PRICE_WRAPPER_SELECTOR)) return;

          const cardPrices = Array.from(
            card.querySelectorAll<HTMLElement>(ACTIVE_PRICE_SELECTOR)
          ).filter((price) => price.closest(RESULT_CARD_SELECTOR) === card);
          const prices = getPrimaryEbayPriceElements(cardPrices);
          const parent = prices[0]?.parentNode;
          if (!parent) return;

          const wrapper = document.createElement("span");
          wrapper.className = "volt-active-listing-price-wrapper";
          wrapper.dataset.voltActivePriceWrapper = "true";

          const values = document.createElement("span");
          values.className = "volt-active-listing-price-values";

          const switchButton = document.createElement("button");
          switchButton.type = "button";
          switchButton.className = "volt-active-listing-price-switch";
          switchButton.textContent = "View sold prices";
          switchButton.setAttribute(
            "aria-label",
            "Switch this search to sold listings"
          );
          switchButton.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            window.location.href = buildEbaySoldListingsUrl(
              window.location.href
            );
          });

          parent.insertBefore(wrapper, prices[0]);
          prices.forEach((price) => {
            price.classList.add("volt-active-listing-price");
            values.appendChild(price);
          });
          wrapper.append(values, switchButton);
        });
    };

    const syncPriceProtection = () => {
      const shouldProtect =
        isEnabled &&
        getEbayListingState(window.location.href) === "active";

      if (!shouldProtect) {
        removePriceProtection();
        return;
      }

      ensureStyles();
      addPriceProtection();
    };

    const mountComponent = () => {
      if (isDismissed) {
        unmountComponent();
        return;
      }

      const container = ensureContainer();
      if (!container) {
        return;
      }

      // Check if already mounted
      if (root) {
        return;
      }

      // Create React root and render
      root = createRoot(container);
      root.render(
        <SoldListingWarning
          onDismiss={() => {
            isDismissed = true;
            unmountComponent();
          }}
        />
      );
    };

    const unmountComponent = () => {
      if (root) {
        root.unmount();
        root = null;
      }

      const container = document.getElementById(CONTAINER_ID);
      if (container) {
        container.remove();
      }
    };

    const renderWarning = async () => {
      updateQueued = false;

      // Check if the feature is enabled in settings
      try {
        const result = (await chrome.storage.sync.get([
          "cmdkSettings",
        ])) as SyncStorageResult;
        isEnabled = result.cmdkSettings?.soldListingWarning?.enabled ?? true;

        if (!isEnabled) {
          log("✗ Sold Listing Warning feature is disabled in settings");
          unmountComponent();
          syncPriceProtection();
          return;
        }
      } catch (err) {
        log("⚠️ Failed to check settings, assuming enabled", err);
        isEnabled = true;
      }

      syncPriceProtection();

      // Check if user has dismissed this warning
      if (isDismissed) {
        unmountComponent();
        return;
      }

      ensureStyles();
      mountComponent();
    };

    // Use MutationObserver to detect when results load
    const observer = new MutationObserver(() => {
      if (updateQueued) return;

      // Debounce updates
      updateQueued = true;
      requestAnimationFrame(() => {
        updateQueued = false;
        syncPriceProtection();
        if (!isDismissed && !document.getElementById(CONTAINER_ID)) {
          void renderWarning();
        }
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Listen for settings changes
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === "sold-listing-warning-settings-changed") {
        if (message.enabled) {
          isEnabled = true;
          isDismissed = false;
          void renderWarning();
        } else {
          isEnabled = false;
          unmountComponent();
          syncPriceProtection();
        }
      }
    });

    // eBay can replace the URL without a full page load. Keep the protection
    // scoped to active /sch/ results and remove it immediately elsewhere.
    window.setInterval(() => {
      if (window.location.href === lastUrl) return;
      lastUrl = window.location.href;
      syncPriceProtection();

      if (!isEbaySearchUrl(lastUrl)) {
        unmountComponent();
      } else if (!isDismissed) {
        void renderWarning();
      }
    }, 500);

    // Initial render
    void renderWarning();
  },
});
