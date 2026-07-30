/* global window, document */

import { defineContentScript } from "wxt/utils/define-content-script";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { initializeSidePanelContext } from "../src/lib/sidepanel-gesture";
import SoldListingWarning from "../src/components/content/SoldListingWarning";
import {
  buildEbaySoldListingsUrl,
  getEbayListingState,
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
          top: 96px;
          right: 18px;
          z-index: 2147483647;
          width: min(360px, calc(100vw - 32px));
          min-height: 112px;
          padding: 16px 48px 16px 16px;
          border-radius: 16px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
          color: #0f172a;
          box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18), 0 4px 14px rgba(15, 23, 42, 0.12);
          box-sizing: border-box;
          display: grid;
          grid-template-columns: 36px minmax(0, 1fr);
          gap: 12px;
          overflow: hidden;
          isolation: isolate;
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
        }

        #${WARNING_ID}::before {
          content: "";
          position: absolute;
          inset: 0;
          z-index: -1;
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 252, 0.9));
        }

        #${WARNING_ID}::after {
          content: "";
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 5px;
        }

        #${WARNING_ID}.volt-state-active {
          border: 1px solid rgba(234, 88, 12, 0.38);
        }

        #${WARNING_ID}.volt-state-active::after {
          background: #ea580c;
        }

        #${WARNING_ID} .volt-sold-listing-warning__status-icon {
          width: 36px;
          height: 36px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-top: 2px;
        }

        #${WARNING_ID}.volt-state-active .volt-sold-listing-warning__status-icon {
          color: #c2410c;
          background: rgba(249, 115, 22, 0.14);
        }

        #${WARNING_ID} .volt-sold-listing-warning__body {
          min-width: 0;
        }

        #${WARNING_ID} .volt-sold-listing-warning__title {
          font-size: 14px;
          margin: 0;
          font-weight: 800;
          color: #0f172a;
          display: flex;
          align-items: center;
          gap: 7px;
          letter-spacing: 0;
          line-height: 1.2;
        }
        #${WARNING_ID} .volt-sold-listing-warning__title img {
          width: 18px;
          height: 18px;
          border-radius: 4px;
        }
        #${WARNING_ID} .volt-sold-listing-warning__content {
          margin: 6px 0 0;
          font-size: 13px;
          color: #475569;
          line-height: 1.4;
        }
        #${WARNING_ID} .volt-sold-listing-warning__primary {
          margin-top: 12px;
          height: 34px;
          border: 0;
          border-radius: 9px;
          padding: 0 12px;
          background: #0f172a;
          color: #ffffff;
          font-size: 12px;
          font-weight: 800;
          line-height: 1;
          cursor: pointer;
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.18);
          transition: transform 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
        }
        #${WARNING_ID} .volt-sold-listing-warning__primary:hover {
          background: #1e293b;
          box-shadow: 0 10px 22px rgba(15, 23, 42, 0.22);
        }
        #${WARNING_ID} .volt-sold-listing-warning__primary:active {
          transform: translateY(1px);
        }

        #${WARNING_ID} .volt-sold-listing-warning__dismiss {
          position: absolute;
          top: 10px;
          right: 10px;
          background: rgba(15, 23, 42, 0.06);
          border: none;
          border-radius: 8px;
          width: 28px;
          height: 28px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          line-height: 1;
          color: #64748b;
          transition: all 0.2s ease;
          z-index: 10;
        }
        #${WARNING_ID} .volt-sold-listing-warning__dismiss:hover {
          background: rgba(239, 68, 68, 0.1);
          color: #dc2626;
        }
        
        #${WARNING_ID} .volt-sold-listing-warning__settings {
          position: absolute;
          top: 44px;
          right: 10px;
          background: rgba(15, 23, 42, 0.06);
          border: none;
          border-radius: 8px;
          width: 28px;
          height: 28px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          line-height: 1;
          color: #64748b;
          transition: all 0.2s ease;
          z-index: 10;
        }
        #${WARNING_ID} .volt-sold-listing-warning__settings:hover {
          background: rgba(59, 130, 246, 0.1);
          color: #2563eb;
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
          grid-area: price !important;
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
          const price = wrapper.querySelector<HTMLElement>(
            ":scope > .volt-active-listing-price"
          );
          if (price && wrapper.parentNode) {
            price.classList.remove("volt-active-listing-price");
            wrapper.parentNode.insertBefore(price, wrapper);
          }
          wrapper.remove();
        });
    };

    const addPriceProtection = () => {
      document
        .querySelectorAll<HTMLElement>(ACTIVE_PRICE_SELECTOR)
        .forEach((price) => {
          if (price.closest(PRICE_WRAPPER_SELECTOR)) return;

          const parent = price.parentNode;
          if (!parent) return;

          const wrapper = document.createElement("span");
          wrapper.className = "volt-active-listing-price-wrapper";
          wrapper.dataset.voltActivePriceWrapper = "true";

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

          parent.insertBefore(wrapper, price);
          wrapper.append(price, switchButton);
          price.classList.add("volt-active-listing-price");
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
