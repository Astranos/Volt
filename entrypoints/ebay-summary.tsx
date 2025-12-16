// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
/* global window, document */

import { defineContentScript } from "wxt/utils/define-content-script";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { initializeSidePanelContext } from "../src/lib/sidepanel-gesture";
import EbaySummary from "../src/components/content/EbaySummary";

/**
 * Adds an inline summary to eBay search result pages showing
 * the current search context (Sold vs Active, Condition).
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
      !window.location.hostname.includes("ebay.com") ||
      !window.location.pathname.startsWith("/sch/")
    ) {
      console.log("⚡ [Volt eBay Summary] Not on eBay search page, exiting");
      return;
    }

    // Initialize side panel context early
    initializeSidePanelContext();

    console.log("⚡ [Volt eBay Summary] SCRIPT LOADED");

    const SUMMARY_ID = "volt-ebay-summary";
    const STYLE_ID = "volt-ebay-summary-style";
    const CONTAINER_ID = "volt-ebay-summary-container";
    let root: Root | null = null;
    let isDismissed = false;
    let updateQueued = false;

    const log = (...args: any[]) => {
      try {
        console.log("[Volt eBay Summary]", ...args);
      } catch {}
    };

    // Inject CSS styles (required for content scripts on external pages)
    const ensureStyles = () => {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        #${SUMMARY_ID} {
          width: 100%;
          padding: 12px 16px;
          padding-right: 110px; /* Make space for buttons */
          border-radius: 10px;
          margin: 12px 0 0 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
          color: #0f172a;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);
          position: relative;
          box-sizing: border-box;
          display: flex;
          flex-direction: row;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
        }
        
        /* Green theme for Sold Listings */
        #${SUMMARY_ID}.volt-state-sold {
          border: 1px solid #16a34a; /* Green-600 */
          background: #f0fdf4; /* Green-50 */
        }
        
        /* Orange theme for Active/Completed Listings (Warning) */
        #${SUMMARY_ID}.volt-state-active {
          border: 1px solid #f97316; /* Orange-500 */
          background: #fff7ed; /* Orange-50 */
        }

        #${SUMMARY_ID} .volt-ebay-summary__title {
          font-size: 16px;
          margin: 0;
          font-weight: 700;
          color: #1e293b;
          display: flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
          flex-shrink: 0;
        }
        #${SUMMARY_ID} .volt-ebay-summary__title img {
          width: 20px;
          height: 20px;
        }
        #${SUMMARY_ID} .volt-ebay-summary__content {
          font-size: 15px;
          color: #334155;
          line-height: 1.5;
          display: inline;
        }
        #${SUMMARY_ID} .volt-ebay-summary__content strong {
          color: #0f172a;
          font-weight: 700;
        }

        #${SUMMARY_ID} .volt-ebay-summary__links {
          display: inline;
          margin-left: 6px;
          color: #475569;
        }
        #${SUMMARY_ID} .volt-ebay-summary__links a {
          color: #15803d; /* Green-700 */
          text-decoration: underline;
          font-weight: 600;
          cursor: pointer;
        }
        #${SUMMARY_ID} .volt-ebay-summary__links a:hover {
          color: #166534; /* Green-800 */
        }

        #${SUMMARY_ID} .volt-ebay-summary__dismiss {
          position: absolute;
          top: 12px;
          right: 12px;
          background: rgba(0, 0, 0, 0.05);
          border: none;
          border-radius: 6px;
          width: 24px;
          height: 24px;
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
        #${SUMMARY_ID} .volt-ebay-summary__dismiss:hover {
          background: rgba(239, 68, 68, 0.1);
          color: #dc2626;
        }
        
        #${SUMMARY_ID} .volt-ebay-summary__sidepanel {
          position: absolute;
          top: 12px;
          right: 76px;
          background: rgba(0, 0, 0, 0.05);
          border: none;
          border-radius: 6px;
          width: 24px;
          height: 24px;
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
        #${SUMMARY_ID} .volt-ebay-summary__sidepanel:hover {
          background: rgba(59, 130, 246, 0.1);
          color: #2563eb;
        }
        
        #${SUMMARY_ID} .volt-ebay-summary__settings {
          position: absolute;
          top: 12px;
          right: 44px;
          background: rgba(0, 0, 0, 0.05);
          border: none;
          border-radius: 6px;
          width: 24px;
          height: 24px;
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
        #${SUMMARY_ID} .volt-ebay-summary__settings:hover {
          background: rgba(59, 130, 246, 0.1);
          color: #2563eb;
        }
      `;
      document.head.appendChild(style);
    };

    const findInsertionPoint = () => {
      // 1. Try to find the carousel element (User request)
      const carouselAnswer = document.querySelector(
        ".srp-river-answer--NAVIGATION_ANSWER_COLLAPSIBLE_CAROUSEL"
      );
      if (carouselAnswer && carouselAnswer.parentElement) {
        return {
          parent: carouselAnswer.parentElement,
          reference: carouselAnswer.nextSibling,
        };
      }

      // 2. Try to find the srp-controls__row-2 element
      const srpControlsRow2 = document.querySelector(".srp-controls__row-2");
      if (srpControlsRow2) {
        return { parent: srpControlsRow2, reference: null };
      }

      // 3. Fallback: Insert before the results river
      const river = document.getElementById("srp-river-results");
      if (river && river.parentElement) {
        return { parent: river.parentElement, reference: river };
      }

      // 4. Last resort: Insert at the top of the main content
      const main = document.getElementById("mainContent");
      if (main) {
        return { parent: main, reference: null };
      }

      return null;
    };

    const ensureContainer = () => {
      // Check if already exists
      let container = document.getElementById(CONTAINER_ID);
      if (container) {
        return container;
      }

      // Find where to insert
      const insertionPoint = findInsertionPoint();
      if (!insertionPoint) {
        log("✗ Cannot insert summary - no suitable parent found");
        return null;
      }

      // Create container
      container = document.createElement("div");
      container.id = CONTAINER_ID;

      // Insert into DOM
      if (insertionPoint.reference) {
        insertionPoint.parent.insertBefore(container, insertionPoint.reference);
      } else {
        insertionPoint.parent.appendChild(container);
      }

      log("✓ Summary container inserted");
      return container;
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
        <EbaySummary
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

    const renderSummary = async () => {
      updateQueued = false;

      // Check if the feature is enabled in settings
      try {
        const result = await chrome.storage.sync.get(["cmdkSettings"]);
        const isEnabled = result.cmdkSettings?.ebaySummary?.enabled ?? true;

        if (!isEnabled) {
          log("✗ eBay Summary feature is disabled in settings");
          unmountComponent();
          return;
        }
      } catch (err) {
        log("⚠️ Failed to check settings, assuming enabled", err);
      }

      // Check if user has dismissed this summary
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
        if (!document.getElementById(CONTAINER_ID)) {
          renderSummary();
        }
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Listen for settings changes
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === "ebay-summary-settings-changed") {
        if (message.enabled) {
          isDismissed = false;
          renderSummary();
        } else {
          unmountComponent();
        }
      }
    });

    // Initial render
    renderSummary();
  },
});
