// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
/* global window, document */

import { defineContentScript } from "wxt/utils/define-content-script";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { initializeSidePanelContext } from "../src/lib/sidepanel-gesture";
import EbaySummary from "../src/components/content/EbaySummary";

/**
 * Adds a fixed pricing guardrail to eBay search result pages when
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

        #${SUMMARY_ID}::before {
          content: "";
          position: absolute;
          inset: 0;
          z-index: -1;
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 252, 0.9));
        }

        #${SUMMARY_ID}::after {
          content: "";
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 5px;
        }

        #${SUMMARY_ID}.volt-state-active {
          border: 1px solid rgba(234, 88, 12, 0.38);
        }

        #${SUMMARY_ID}.volt-state-active::after {
          background: #ea580c;
        }

        #${SUMMARY_ID} .volt-ebay-summary__status-icon {
          width: 36px;
          height: 36px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-top: 2px;
        }

        #${SUMMARY_ID}.volt-state-active .volt-ebay-summary__status-icon {
          color: #c2410c;
          background: rgba(249, 115, 22, 0.14);
        }

        #${SUMMARY_ID} .volt-ebay-summary__body {
          min-width: 0;
        }

        #${SUMMARY_ID} .volt-ebay-summary__title {
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
        #${SUMMARY_ID} .volt-ebay-summary__title img {
          width: 18px;
          height: 18px;
          border-radius: 4px;
        }
        #${SUMMARY_ID} .volt-ebay-summary__content {
          margin: 6px 0 0;
          font-size: 13px;
          color: #475569;
          line-height: 1.4;
        }
        #${SUMMARY_ID} .volt-ebay-summary__primary {
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
        #${SUMMARY_ID} .volt-ebay-summary__primary:hover {
          background: #1e293b;
          box-shadow: 0 10px 22px rgba(15, 23, 42, 0.22);
        }
        #${SUMMARY_ID} .volt-ebay-summary__primary:active {
          transform: translateY(1px);
        }

        #${SUMMARY_ID} .volt-ebay-summary__dismiss {
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
        #${SUMMARY_ID} .volt-ebay-summary__dismiss:hover {
          background: rgba(239, 68, 68, 0.1);
          color: #dc2626;
        }
        
        #${SUMMARY_ID} .volt-ebay-summary__settings {
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
        #${SUMMARY_ID} .volt-ebay-summary__settings:hover {
          background: rgba(59, 130, 246, 0.1);
          color: #2563eb;
        }

        @media (max-width: 640px) {
          #${SUMMARY_ID} {
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
