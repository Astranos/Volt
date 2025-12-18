// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
/* global chrome */

import { defineContentScript } from "wxt/utils/define-content-script";
import {
  initializeSidePanelContext,
  triggerSidepanelToolFromContentScript,
  isSidePanelApiAvailable,
} from "../src/lib/sidepanel-gesture";

/**
 * PriceCharting Game Page Content Script
 *
 * Adds clickable price buttons on PriceCharting game pages.
 * When clicked, the price is saved to the lot in the sidepanel.
 * If the sidepanel isn't open, it opens with the PriceCharting tool.
 */
export default defineContentScript({
  matches: ["https://www.pricecharting.com/game/*"],
  runAt: "document_idle",
  allFrames: false,
  main() {
    const log = (...args: any[]) => {
      try {
        console.log("[Scout - PriceCharting Game]", ...args);
      } catch (_) {}
    };

    log("Content script loaded on game page");

    // Styles for the Scout enhancements
    const STYLES = `
      .scout-add-to-lot-btn {
        background: #22c55e !important;
        color: white !important;
        border: none !important;
        padding: 4px 8px !important;
        border-radius: 4px !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        cursor: pointer !important;
        transition: all 0.2s ease !important;
        white-space: nowrap !important;
        display: inline-block !important;
        text-decoration: none !important;
        line-height: 1.2 !important;
      }
      .scout-add-to-lot-btn:hover {
        background: #16a34a !important;
        transform: translateY(-1px) !important;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1) !important;
      }
      .scout-add-to-lot-btn:active {
        transform: translateY(0) !important;
      }
      .scout-col-header {
        font-size: 11px !important;
        color: #666 !important;
        text-align: center !important;
        width: 100px !important;
      }
      .scout-pc-added-flash {
        animation: scout-pc-flash 0.5s ease;
      }
      @keyframes scout-pc-flash {
        0% { background: rgba(34, 197, 94, 0.5) !important; }
        100% { background: transparent !important; }
      }
    `;

    // Inject styles
    const injectStyles = () => {
      if (!document.getElementById("scout-pc-game-styles")) {
        const styleElement = document.createElement("style");
        styleElement.textContent = STYLES;
        styleElement.id = "scout-pc-game-styles";
        (document.head || document.documentElement).appendChild(styleElement);
      }
    };

    // Parse price string like "$12.50" to number
    const parsePrice = (str: string): number => {
      const match = str.match(/[\d,.]+/);
      return match ? parseFloat(match[0].replace(/,/g, "")) : 0;
    };

    // Get game info from the page
    const getGameInfo = () => {
      const titleEl = document.querySelector("#product_name");
      if (!titleEl) return null;

      // Title is like "Grand Theft Auto V" with console as a child link
      const consoleLink = titleEl.querySelector("a");
      const consoleName = consoleLink?.textContent?.trim() || "";

      // Get just the title text (excluding the console link)
      let title = "";
      for (const node of titleEl.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          title += node.textContent;
        }
      }
      title = title.trim();

      // Extract UPC from the details table
      let upc = "";
      const upcElements = document.querySelectorAll(
        ".scout-upc-highlight[data-upc]"
      );
      if (upcElements.length > 0) {
        // Get the first UPC
        upc = upcElements[0].getAttribute("data-upc") || "";
      }

      return {
        title,
        console: consoleName,
        url: window.location.href,
        upc,
      };
    };

    // Condition mapping for sales table containers
    const CONTAINER_CONDITION_MAP: Record<string, string> = {
      "completed-auctions-used": "Loose",
      "completed-auctions-cib": "CIB",
      "completed-auctions-new": "New",
      "completed-auctions-graded": "Graded",
      "completed-auctions-box-only": "Box Only",
      "completed-auctions-manual-only": "Manual Only",
    };

    // Add "Add To Game Lot" buttons to sales tables
    const setupSalesTableButtons = () => {
      const gameInfo = getGameInfo();
      if (!gameInfo) {
        log("Could not get game info from page");
        return;
      }

      const salesTables = document.querySelectorAll(
        "table.hoverable-rows.sortable"
      );
      salesTables.forEach((table) => {
        // Find condition from parent container
        let condition = "Loose"; // Default
        const container = table.closest("div[class*='completed-auctions-']");
        if (container) {
          for (const [className, cond] of Object.entries(
            CONTAINER_CONDITION_MAP
          )) {
            if (container.classList.contains(className)) {
              condition = cond;
              break;
            }
          }
        }

        // Add header if not present
        const headerRow = table.querySelector("thead tr");
        if (headerRow && !headerRow.querySelector(".scout-col-header")) {
          const scoutHeader = document.createElement("th");
          scoutHeader.className = "scout-col-header";
          scoutHeader.textContent = "";
          // Insert before the last column (which is usually the "Report" column)
          const lastHeader = headerRow.cells[headerRow.cells.length - 1];
          if (lastHeader) {
            headerRow.insertBefore(scoutHeader, lastHeader);
          } else {
            headerRow.appendChild(scoutHeader);
          }
        }

        // Add buttons to rows
        const rows = table.querySelectorAll("tbody tr");
        rows.forEach((row) => {
          // Skip if already set up
          if (row.querySelector(".scout-add-to-lot-btn")) return;

          const priceSpan = row.querySelector("td.numeric span.js-price");
          if (!priceSpan) return;

          const priceText = priceSpan.textContent?.trim() || "";
          const price = parsePrice(priceText);
          if (price <= 0) return;

          // Create button cell
          const buttonCell = document.createElement("td");
          buttonCell.className = "numeric";

          const button = document.createElement("button");
          button.className = "scout-add-to-lot-btn";
          button.textContent = "Add To Game Lot";
          button.type = "button";

          button.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const itemData = {
              id: Math.random().toString(36).substring(7),
              title: gameInfo.title,
              console: gameInfo.console,
              price,
              condition,
              url: window.location.href, // Use current URL
              saleTitle:
                row.querySelector("td.title a")?.textContent?.trim() || "",
              upc: gameInfo.upc || "",
            };

            log("Adding sale item to lot:", itemData);

            try {
              // Queue the item via the background service worker
              chrome.runtime.sendMessage({
                type: "PC_ITEM_SELECTED",
                data: itemData,
              });

              // Try to open/switch the sidepanel to the PriceCharting tool
              try {
                if (isSidePanelApiAvailable()) {
                  triggerSidepanelToolFromContentScript("price-charting-tool", {
                    source: "pricecharting-game",
                    mode: "open",
                  }).catch((err) => {
                    log(
                      "Sidepanel trigger error from PriceCharting game:",
                      err
                    );
                  });
                } else {
                  // Fallback: ask background to open the sidepanel tool
                  chrome.runtime.sendMessage({
                    action: "openInSidebar",
                    tool: "price-charting-tool",
                    mode: "open",
                  });
                }
              } catch (panelErr) {
                log(
                  "Error triggering sidepanel from PriceCharting game:",
                  panelErr
                );
              }

              // Visual feedback
              row.classList.add("scout-pc-added-flash");
              setTimeout(() => {
                row.classList.remove("scout-pc-added-flash");
              }, 500);
            } catch (err) {
              log("Error sending message:", err);
            }
          });

          buttonCell.appendChild(button);

          // Insert before the last cell
          const lastCell = row.cells[row.cells.length - 1];
          if (lastCell) {
            row.insertBefore(buttonCell, lastCell);
          } else {
            row.appendChild(buttonCell);
          }
        });
      });
    };

    // Initialize
    const init = () => {
      log("Initializing PriceCharting game page enhancements");

      // Prime sidepanel context so we can open the PriceCharting tool reliably.
      try {
        initializeSidePanelContext();
      } catch (_) {}

      injectStyles();

      // Initial setup with delay to ensure DOM is ready
      setTimeout(() => {
        setupSalesTableButtons();
        log("Initial setup complete");
      }, 500);

      // Watch for dynamic content changes (some price updates happen via AJAX)
      const observer = new MutationObserver(() => {
        setupSalesTableButtons();
      });

      // Observe the main content area where sales tables are located
      const contentArea = document.querySelector("#content") || document.body;
      if (contentArea) {
        log("Observing content area for changes");
        observer.observe(contentArea, {
          childList: true,
          subtree: true,
        });
      }
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  },
});
