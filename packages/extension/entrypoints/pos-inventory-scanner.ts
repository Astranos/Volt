/**
 * POS Inventory Scanner Content Script
 * Scans the inventory table on pos.paymore.tech/inventory
 * and sends data to the sidepanel for analysis
 */

import { defineContentScript } from "wxt/utils/define-content-script";

export interface POSProduct {
  // Order info
  orderId: string;
  customer: string;
  purchaseDate: string;
  employeeName: string;
  daysRemaining: number;
  isOnHold: boolean;
  // Product info
  artNumber: string;
  make: string;
  model: string;
  condition: string;
  color: string;
  storageSize: string;
  carrier: string;
  batteryHealth: string;
  serial: string;
  imei: string;
  location: string;
  estPrice: string;
  offerPrice: string;
  staffNotes: string;
  osNotes: string;
  collectionName: string;
}

export interface POSInventoryData {
  products: POSProduct[];
  scannedAt: number;
  totalProducts: number;
  totalOrders: number;
  url: string;
}

export default defineContentScript({
  matches: ["https://pos.paymore.tech/*"],
  runAt: "document_idle",
  main() {
    console.log("[POS Scanner] Content script loaded");

    let lastScannedData: POSInventoryData | null = null;
    let isScanning = false;
    let scanInterval: ReturnType<typeof setInterval> | null = null;

    function isInventoryPage(): boolean {
      const isInventory = window.location.href.includes("/inventory");
      return isInventory;
    }

    function parseDate(dateStr: string): Date | null {
      // Parse dates in format "01-05-2026" or "01/05/2026"
      const parts = dateStr.split(/[-/]/);
      if (parts.length === 3) {
        const month = parseInt(parts[0], 10) - 1;
        const day = parseInt(parts[1], 10);
        const year = parseInt(parts[2], 10);
        return new Date(year, month, day);
      }
      return null;
    }

    function calculateDaysRemaining(purchaseDate: string): number {
      const date = parseDate(purchaseDate);
      if (!date) return 0;

      const now = new Date();
      now.setHours(0, 0, 0, 0);
      date.setHours(0, 0, 0, 0);

      const diffTime = now.getTime() - date.getTime();
      const daysSincePurchase = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      // 3 day hold period - calculate remaining days
      const daysRemaining = 3 - daysSincePurchase;
      return Math.max(0, daysRemaining);
    }

    function findInventoryTable(): HTMLTableElement | null {
      // Try multiple selectors to find the inventory table
      const selectors = [
        ".table-responsive > table",
        "table.table-row-bordered",
        "table.table",
        "table",
      ];

      for (const selector of selectors) {
        const tables = document.querySelectorAll<HTMLTableElement>(selector);

        for (const table of tables) {
          const thead = table.querySelector("thead");
          if (!thead) continue;

          // Get all header text
          const headerText = thead.textContent?.toLowerCase() || "";

          // Check for inventory table headers
          const hasOrderHeader =
            headerText.includes("order") || headerText.includes("order #");
          const hasPurchaseDateHeader =
            headerText.includes("purchase date") ||
            headerText.includes("purchase");
          const hasCustomerHeader = headerText.includes("customer");

          if (hasOrderHeader && (hasPurchaseDateHeader || hasCustomerHeader)) {
            // Make sure this isn't a nested detail table
            const firstHeaderRow = thead.querySelector("tr");
            const headerCells = firstHeaderRow?.querySelectorAll("th");
            if (headerCells && headerCells.length >= 8) {
              console.log("[POS Scanner] Found inventory table with selector:", selector);
              return table;
            }
          }
        }
      }

      console.log("[POS Scanner] No inventory table found");
      return null;
    }

    function parseProductAttributes(attributesCell: Element): {
      color: string;
      storageSize: string;
      carrier: string;
      batteryHealth: string;
      collectionName: string;
    } {
      const text = attributesCell.textContent || "";
      const getAttr = (label: string): string => {
        const regex = new RegExp(`${label}:\\s*([^\\n]+)`, "i");
        const match = text.match(regex);
        return match ? match[1].trim() : "";
      };

      return {
        color: getAttr("Color"),
        storageSize: getAttr("Storage Size"),
        carrier: getAttr("Carrier Service"),
        batteryHealth: getAttr("Battery Health"),
        collectionName: getAttr("Collection name"),
      };
    }

    function parseSerialImei(serialCell: Element): { serial: string; imei: string } {
      const text = serialCell.textContent || "";
      const serialMatch = text.match(/Serial:\s*([^\s]+)/i);
      const imeiMatch = text.match(/IMEI:\s*([^\s]+)/i);
      return {
        serial: serialMatch ? serialMatch[1].trim() : "",
        imei: imeiMatch ? imeiMatch[1].trim() : "",
      };
    }

    function scanInventoryTable(): POSProduct[] {
      const products: POSProduct[] = [];
      const table = findInventoryTable();

      if (!table) {
        console.log("[POS Scanner] No table to scan");
        return products;
      }

      // Get tbody - might be implicit
      const tbody = table.querySelector("tbody") || table;

      // Get all rows from tbody
      const rows = tbody.querySelectorAll("tr");
      console.log("[POS Scanner] Found", rows.length, "rows in table");

      let currentOrder: {
        orderId: string;
        customer: string;
        purchaseDate: string;
        employeeName: string;
        daysRemaining: number;
        isOnHold: boolean;
      } | null = null;

      rows.forEach((row) => {
        // Skip header rows
        if (row.closest("thead")) return;

        const cells = row.querySelectorAll("td");

        // Check if this is an order row (has expand icon and order data)
        if (cells.length >= 10 && !row.id?.startsWith("collapse")) {
          // Skip rows that contain nested tables or modals
          if (row.querySelector("table") || row.querySelector(".modal")) return;

          // Extract order data
          const orderId = cells[1]?.textContent?.trim() || "";
          const customer = cells[2]?.textContent?.trim() || "";
          const purchaseDate = cells[9]?.textContent?.trim() || "";
          const employeeName = cells[10]?.textContent?.trim() || "";

          // Skip rows without a valid order ID
          if (!orderId || orderId.length < 2) return;
          if (orderId.toLowerCase().includes("order")) return;

          const daysRemaining = calculateDaysRemaining(purchaseDate);
          const isOnHold =
            row.classList.contains("bg-light-danger") ||
            row.classList.contains("bg-danger");

          currentOrder = {
            orderId,
            customer,
            purchaseDate,
            employeeName,
            daysRemaining,
            isOnHold,
          };
        }

        // Check if this is a collapse row containing products
        if (row.id?.startsWith("collapse") && currentOrder) {
          const orderContext = currentOrder;
          const nestedTable = row.querySelector("table");
          if (!nestedTable) return;

          const productRows = nestedTable.querySelectorAll("tbody tr");
          productRows.forEach((productRow) => {
            const allCells = Array.from(productRow.querySelectorAll("td"));
            if (allCells.length < 10) return;

            // Check if first cell is a checkbox (Select column) - skip it if so
            const firstCellHasCheckbox = allCells[0]?.querySelector('input[type="checkbox"]');
            const cells = firstCellHasCheckbox ? allCells.slice(1) : allCells;

            // Product cell structure (after skipping checkbox if present):
            // 0: Art#, 1: Make, 2: Model, 3: Condition, 4: Attributes, 
            // 5: Serial/IMEI, 6: Location, 7: Est. Price, 8: Offer Price, 
            // 9: Staff Notes, 10: OS Notes

            const artNumber = cells[0]?.textContent?.trim() || "";
            const make = cells[1]?.textContent?.trim() || "";
            const model = cells[2]?.textContent?.trim() || "";
            const condition = cells[3]?.textContent?.trim() || "";
            const attributes = parseProductAttributes(cells[4]);
            const serialImei = parseSerialImei(cells[5]);
            const location = cells[6]?.textContent?.trim() || "";
            const estPrice = cells[7]?.textContent?.trim() || "";
            const offerPrice = cells[8]?.textContent?.trim() || "";
            const staffNotes = cells[9]?.textContent?.trim() || "";
            const osNotes = cells[10]?.textContent?.trim() || "";

            // Skip empty product rows
            if (!make && !model) return;

            products.push({
              ...orderContext,
              artNumber,
              make,
              model,
              condition,
              ...attributes,
              ...serialImei,
              location,
              estPrice,
              offerPrice,
              staffNotes,
              osNotes,
            });
          });
        }
      });

      console.log("[POS Scanner] Scanned", products.length, "products");
      return products;
    }

    async function performScan(): Promise<POSInventoryData | null> {
      if (!isInventoryPage()) {
        console.log("[POS Scanner] Not on inventory page");
        return null;
      }

      if (isScanning) {
        console.log("[POS Scanner] Already scanning");
        return lastScannedData;
      }

      isScanning = true;
      console.log("[POS Scanner] Starting scan...");

      try {
        const products = scanInventoryTable();

        // Count unique orders
        const uniqueOrders = new Set(products.map((p) => p.orderId));

        const data: POSInventoryData = {
          products,
          scannedAt: Date.now(),
          totalProducts: products.length,
          totalOrders: uniqueOrders.size,
          url: window.location.href,
        };

        lastScannedData = data;
        console.log("[POS Scanner] Scan complete:", data.totalOrders, "orders,", data.totalProducts, "products");

        // Send to extension
        try {
          await chrome.runtime.sendMessage({
            action: "posInventoryData",
            data,
          });
          console.log("[POS Scanner] Sent data to extension");
        } catch (e) {
          // Extension context may not be available
          console.debug("[POS Scanner] Could not send inventory data:", e);
        }

        return data;
      } finally {
        isScanning = false;
      }
    }

    function startContinuousScan(): void {
      console.log("[POS Scanner] Starting continuous scan");

      // Clear any existing interval
      if (scanInterval) {
        clearInterval(scanInterval);
      }

      // Initial scan
      performScan();

      // Scan every 2 seconds to catch lazy-loaded content
      scanInterval = setInterval(() => {
        if (isInventoryPage()) {
          performScan();
        } else {
          stopContinuousScan();
        }
      }, 2000);
    }

    function stopContinuousScan(): void {
      if (scanInterval) {
        clearInterval(scanInterval);
        scanInterval = null;
        console.log("[POS Scanner] Stopped continuous scan");
      }
    }

    // Listen for messages from sidepanel
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      console.log("[POS Scanner] Received message:", message.action);

      if (message.action === "requestPosInventoryScan") {
        performScan().then((data) => {
          console.log(
            "[POS Scanner] Responding with data:",
            data?.products.length ?? 0,
            "items"
          );
          sendResponse({ success: true, data });
        });
        return true; // Async response
      }

      if (message.action === "getPosInventoryData") {
        sendResponse({ success: true, data: lastScannedData });
        return true;
      }

      if (message.action === "startPosInventoryScan") {
        startContinuousScan();
        sendResponse({ success: true });
        return true;
      }

      if (message.action === "stopPosInventoryScan") {
        stopContinuousScan();
        sendResponse({ success: true });
        return true;
      }
    });

    // Monitor for URL changes (React router)
    let lastUrl = window.location.href;

    const urlObserver = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        console.log("[POS Scanner] URL changed to:", lastUrl);

        if (isInventoryPage()) {
          // Wait for page to render, then start scanning
          setTimeout(() => {
            startContinuousScan();
          }, 1000);
        } else {
          stopContinuousScan();
          lastScannedData = null;
        }
      }
    });

    // Start observing
    urlObserver.observe(document.body, { childList: true, subtree: true });

    // Initial check on load
    console.log("[POS Scanner] Initial URL:", window.location.href);
    if (isInventoryPage()) {
      console.log("[POS Scanner] On inventory page, starting scan in 1.5s");
      // Wait for initial render
      setTimeout(() => {
        startContinuousScan();
      }, 1500);
    }
  },
});
