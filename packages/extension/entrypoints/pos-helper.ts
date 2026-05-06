/**
 * POS Helper Content Script
 * For pos.paymore.tech - handles inventory page data extraction
 */
// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
/* global chrome */

import { defineContentScript } from "wxt/utils/define-content-script";

export default defineContentScript({
  matches: ["https://pos.paymore.tech/*"],
  runAt: "document_idle",
  main() {
    // Track current route
    let currentRoute = "";
    let scrollObserver: MutationObserver | null = null;
    let debounceTimeout: ReturnType<typeof setTimeout> | null = null;

    const log = (...args: any[]) => {
      console.log("[POS Helper]", ...args);
    };

    // Detect route changes in React SPA
    function detectRouteChange() {
      const path = window.location.pathname;
      if (path !== currentRoute) {
        currentRoute = path;
        handleRouteChange(path);
      }
    }

    // Main route handler
    function handleRouteChange(path: string) {
      log("Route changed to:", path);

      // Cleanup previous observers
      cleanup();

      if (path.includes("/inventory")) {
        initInventoryHelper();
      }

      // Notify sidepanel of route change
      notifySidepanel({ type: "ROUTE_CHANGE", route: path });
    }

    function cleanup() {
      if (scrollObserver) {
        scrollObserver.disconnect();
        scrollObserver = null;
      }
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
        debounceTimeout = null;
      }
    }

    function debounce(fn: () => void, delay: number) {
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }
      debounceTimeout = setTimeout(fn, delay);
    }

    // ============================================
    // INVENTORY HELPER
    // ============================================

    interface InventoryProduct {
      orderId: string;
      customer: string;
      numProducts: number;
      purchaseAmount: number;
      estimatedValue: number;
      estimatedMargin: number;
      grossMarginPercent: number;
      location: string;
      purchaseDate: Date;
      employeeName: string;
      daysInQueue: number;
    }

    interface InventorySummary {
      totalProducts: number;
      rollOffTomorrow: number;
      readyToList: number;
      readyToListValue: number;
      pendingProducts: number;
      pendingValue: number;
      products: InventoryProduct[];
    }

    async function initInventoryHelper() {
      log("Initializing inventory helper");

      // First, scroll to load all data
      await scrollToLoadAll();

      // Then parse inventory data
      parseInventoryData();

      // Set up observer for dynamic updates
      observeInventoryUpdates();
    }

    async function scrollToLoadAll(): Promise<void> {
      log("Starting auto-scroll to load all table data");
      notifySidepanel({
        type: "INVENTORY_LOADING",
        loading: true,
        message: "Loading table data...",
      });

      return new Promise((resolve) => {
        const scrollContainer = document.querySelector(
          ".table-responsive, [class*='scroll'], main"
        );
        const table = document.querySelector("table tbody");

        if (!scrollContainer && !table) {
          log("No scrollable container found");
          notifySidepanel({ type: "INVENTORY_LOADING", loading: false });
          resolve();
          return;
        }

        let lastRowCount = 0;
        let sameCountIterations = 0;
        const maxIterations = 50;
        let currentIteration = 0;

        const scrollInterval = setInterval(() => {
          // Scroll to bottom
          window.scrollTo(0, document.body.scrollHeight);

          // Also try scrolling any overflow containers
          const containers = document.querySelectorAll(
            '[style*="overflow"], .table-responsive'
          );
          containers.forEach((c) => {
            (c as HTMLElement).scrollTop = (c as HTMLElement).scrollHeight;
          });

          // Count current rows
          const rows = document.querySelectorAll("table tbody tr");
          const currentRowCount = rows.length;

          if (currentRowCount === lastRowCount) {
            sameCountIterations++;
          } else {
            sameCountIterations = 0;
            lastRowCount = currentRowCount;
          }

          currentIteration++;

          // Stop if row count stabilized or max iterations reached
          if (sameCountIterations >= 5 || currentIteration >= maxIterations) {
            clearInterval(scrollInterval);
            log(`Scroll complete. Total rows: ${currentRowCount}`);
            notifySidepanel({
              type: "INVENTORY_LOADING",
              loading: false,
              message: `Loaded ${currentRowCount} rows`,
            });
            // Scroll back to top
            window.scrollTo(0, 0);
            setTimeout(resolve, 500);
          }
        }, 200);
      });
    }

    function parseInventoryData() {
      log("Parsing inventory data");

      const products: InventoryProduct[] = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Find the main inventory table
      const tables = document.querySelectorAll("table");
      let inventoryTable: HTMLTableElement | null = null;

      tables.forEach((table) => {
        const headers = table.querySelectorAll("th");
        headers.forEach((th) => {
          if (
            th.textContent?.includes("Order #") ||
            th.textContent?.includes("Purchase Date") ||
            th.textContent?.includes("Purchase Amt")
          ) {
            inventoryTable = table;
          }
        });
      });

      if (!inventoryTable) {
        log("Inventory table not found");
        notifySidepanel({ type: "INVENTORY_DATA", data: null });
        return;
      }

      // Parse table rows
      const rows = inventoryTable.querySelectorAll("tbody tr");

      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 5) return;

        // Check if this is a main order row or a sub-item row
        // If it has collapse data, it's a sub-item row - skip
        if (row.id?.includes("collapse")) {
          return;
        }

        // Check if this is a section header (like "Microsoft", "Sony", etc.)
        if (cells.length === 1 || (cells[0] as HTMLElement)?.colSpan > 1) {
          return;
        }

        // Try to parse as a main order row
        // Typical columns: [expand arrow], Order #, Customer, # Products, Purchase Amt, Est. Val, Est. Margin, Margin %, Location, Purchase Date, Emp. Name, Days In Queue
        const orderIdCell = Array.from(cells).find((c) =>
          c.textContent?.trim().match(/^[A-Z]{2}\d{2}-\d+$/)
        );

        if (orderIdCell) {
          const cellArray = Array.from(cells);
          const orderIdIndex = cellArray.indexOf(orderIdCell);

          // Parse the purchase date
          let purchaseDate = new Date();
          const dateCell = cellArray.find((c) =>
            c.textContent?.trim().match(/^\d{2}-\d{2}-\d{4}$/)
          );
          if (dateCell) {
            const dateStr = dateCell.textContent?.trim() || "";
            const [month, day, year] = dateStr.split("-").map(Number);
            purchaseDate = new Date(year, month - 1, day);
          }

          // Parse numeric values
          const parseMoneyValue = (text: string): number => {
            const cleaned = text.replace(/[^0-9.-]/g, "");
            return parseFloat(cleaned) || 0;
          };

          // Calculate days in queue
          const daysDiff = Math.floor(
            (today.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24)
          );

          // Find cells by content patterns
          let purchaseAmt = 0;
          let estimatedVal = 0;
          let numProducts = 1;
          let location = "";
          let employeeName = "";

          cellArray.forEach((cell, idx) => {
            const text = cell.textContent?.trim() || "";

            // Number of products is typically a small integer in a specific column
            if (/^\d+$/.test(text) && parseInt(text) < 100) {
              const num = parseInt(text);
              if (num > 0 && num < 50) {
                numProducts = num;
              }
            }

            // Purchase amount (usually has "cash" or "$" in it)
            if (text.includes("$") && text.toLowerCase().includes("cash")) {
              purchaseAmt = parseMoneyValue(text);
            } else if (text.startsWith("$") && purchaseAmt === 0) {
              const val = parseMoneyValue(text);
              if (val > 0 && val < 10000) {
                if (purchaseAmt === 0) {
                  purchaseAmt = val;
                } else if (estimatedVal === 0) {
                  estimatedVal = val;
                }
              }
            }

            // Location (like "P1", "P2", etc.)
            if (/^P\d+$/i.test(text)) {
              location = text;
            }
          });

          // Estimated value is often the second dollar amount
          const dollarValues = cellArray
            .map((c) => c.textContent?.trim() || "")
            .filter((t) => t.startsWith("$") && !t.includes("cash"))
            .map(parseMoneyValue)
            .filter((v) => v > 0);

          if (dollarValues.length >= 1) {
            estimatedVal = dollarValues[0];
          }
          if (dollarValues.length >= 2 && purchaseAmt === 0) {
            purchaseAmt = dollarValues[1];
          }

          // Try to get employee name (usually last text column before days)
          const textCells = cellArray.filter((c) => {
            const text = c.textContent?.trim() || "";
            return (
              text.length > 0 &&
              !text.startsWith("$") &&
              !text.includes("%") &&
              !/^\d+$/.test(text) &&
              !/^\d+-\d+-\d+$/.test(text) &&
              !/^P\d+$/i.test(text) &&
              !/Days?$/i.test(text) &&
              !text.match(/^[A-Z]{2}\d{2}-\d+$/)
            );
          });

          // Customer is usually right after order ID
          const customer = cellArray[orderIdIndex + 1]?.textContent?.trim() || "";

          // Employee name is typically one of the later text cells
          if (textCells.length > 1) {
            employeeName = textCells[textCells.length - 1]?.textContent?.trim() || "";
          }

          const product: InventoryProduct = {
            orderId: orderIdCell.textContent?.trim() || "",
            customer,
            numProducts,
            purchaseAmount: purchaseAmt,
            estimatedValue: estimatedVal,
            estimatedMargin: estimatedVal - purchaseAmt,
            grossMarginPercent:
              purchaseAmt > 0
                ? ((estimatedVal - purchaseAmt) / purchaseAmt) * 100
                : 0,
            location,
            purchaseDate,
            employeeName,
            daysInQueue: daysDiff,
          };

          products.push(product);
        }
      });

      // Calculate summary
      const summary: InventorySummary = {
        totalProducts: products.reduce((sum, p) => sum + p.numProducts, 0),
        rollOffTomorrow: 0,
        readyToList: 0,
        readyToListValue: 0,
        pendingProducts: 0,
        pendingValue: 0,
        products,
      };

      products.forEach((p) => {
        // Roll off is 3 days from purchase
        // So products bought 2 days ago will roll off tomorrow
        if (p.daysInQueue === 2) {
          summary.rollOffTomorrow += p.numProducts;
        }

        // Ready to list: >= 3 days from purchase
        if (p.daysInQueue >= 3) {
          summary.readyToList += p.numProducts;
          summary.readyToListValue += p.estimatedValue;
        } else {
          // Pending (< 3 days)
          summary.pendingProducts += p.numProducts;
          summary.pendingValue += p.estimatedValue;
        }
      });

      log("Inventory summary:", summary);
      notifySidepanel({ type: "INVENTORY_DATA", data: summary });
    }

    function observeInventoryUpdates() {
      // Re-parse on table updates
      scrollObserver = new MutationObserver(() => {
        debounce(() => parseInventoryData(), 1000);
      });

      const table = document.querySelector("table");
      if (table) {
        scrollObserver.observe(table, {
          subtree: true,
          childList: true,
        });
      }
    }

    // ============================================
    // COMMUNICATION
    // ============================================

    function notifySidepanel(message: any) {
      try {
        chrome.runtime.sendMessage({
          action: "POS_HELPER_MESSAGE",
          ...message,
        });
      } catch (e) {
        // Sidepanel might not be open
        log("Could not send message to sidepanel:", e);
      }
    }

    // Listen for messages from sidepanel
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "POS_GET_CURRENT_ROUTE") {
        sendResponse({ route: currentRoute || window.location.pathname });
        return true;
      }

      if (message.action === "POS_REFRESH_DATA") {
        handleRouteChange(window.location.pathname);
        sendResponse({ success: true });
        return true;
      }
    });

    // ============================================
    // INITIALIZATION
    // ============================================

    log("Content script loaded on", window.location.href);

    // Initial route detection
    detectRouteChange();

    // Listen for URL changes (History API)
    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      detectRouteChange();
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      detectRouteChange();
    };

    window.addEventListener("popstate", detectRouteChange);

    // Also check periodically for any missed route changes
    setInterval(detectRouteChange, 1000);
  },
});
