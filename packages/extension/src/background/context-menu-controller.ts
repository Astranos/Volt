import type { LogFn } from "./runtime-action-registry";

type ContextMenuControllerOptions = {
  chromeApi: typeof chrome;
  getFallbackTabId: () => number | null;
  log: LogFn;
  toggleSidePanelForTab: (
    tabId: number | null | undefined,
    tool: string,
    mode?: string
  ) => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createContextMenuController({
  chromeApi,
  getFallbackTabId,
  log,
  toggleSidePanelForTab,
}: ContextMenuControllerOptions) {
  const ebaySoldBase =
    "https://www.ebay.com/sch/i.html?_nkw=iphone+15&_sacat=0&_from=R40&_dmd=2&rt=nc&LH_Sold=1&LH_Complete=1";
  const googleUpcBase = "https://www.google.com/search?q=";
  const priceChartingBase =
    "https://www.pricecharting.com/search-products?type=prices&q=grand+theft+auto&go=Go";

  function register() {
    try {
      try {
        chromeApi.contextMenus.removeAll(() => {});
      } catch (_) {}

      try {
        chromeApi.contextMenus.create({
          id: "pm-mobile",
          title: "Mobile",
          contexts: ["all"],
        });
        chromeApi.contextMenus.create({
          id: "pm-search-ebay-sold",
          title: "Search for sold listings on eBay",
          contexts: ["selection"],
        });
        chromeApi.contextMenus.create({
          id: "pm-search-google-upc",
          title: "Search for UPC on Google",
          contexts: ["selection"],
        });
        chromeApi.contextMenus.create({
          id: "pm-search-google-mpn",
          title: "Search for MPN on Google",
          contexts: ["selection"],
        });
        chromeApi.contextMenus.create({
          id: "pm-search-price-charting",
          title: "Search on PriceCharting",
          contexts: ["selection"],
        });
      } catch (error) {
        log("contextMenus.create error", errorMessage(error));
      }

      chromeApi.contextMenus.onClicked.addListener((info, tab) => {
        if (info.menuItemId === "pm-mobile") {
          const tabId = tab?.id ?? getFallbackTabId();
          toggleSidePanelForTab(tabId, "mobile-scanner", "open");
          return;
        }

        const selection = (info.selectionText || "").trim();
        if (!selection) return;

        if (info.menuItemId === "pm-search-ebay-sold") {
          try {
            const url = new URL(ebaySoldBase);
            url.searchParams.set("_nkw", selection);
            chromeApi.tabs.create({ url: url.href });
          } catch (_) {
            try {
              const q = encodeURIComponent(selection);
              chromeApi.tabs.create({
                url: ebaySoldBase.replace(/_nkw=[^&]*/, `_nkw=${q}`),
              });
            } catch (_) {
              log("Failed to open eBay search for selection", selection);
            }
          }
          return;
        }

        if (info.menuItemId === "pm-search-google-upc") {
          try {
            const query = encodeURIComponent(`UPC for ${selection}`);
            chromeApi.tabs.create({ url: `${googleUpcBase}${query}` });
          } catch (_) {
            log("Failed to open Google UPC search for selection", selection);
          }
          return;
        }

        if (info.menuItemId === "pm-search-google-mpn") {
          try {
            const query = encodeURIComponent(`MPN for ${selection}`);
            chromeApi.tabs.create({ url: `${googleUpcBase}${query}` });
          } catch (_) {
            log("Failed to open Google MPN search for selection", selection);
          }
          return;
        }

        if (info.menuItemId === "pm-search-price-charting") {
          try {
            const url = new URL(priceChartingBase);
            url.searchParams.set("q", selection);
            chromeApi.tabs.create({ url: url.href });
          } catch (_) {
            try {
              const q = encodeURIComponent(selection);
              chromeApi.tabs.create({
                url: priceChartingBase.replace(/q=[^&]*/, `q=${q}`),
              });
            } catch (_) {
              log("Failed to open PriceCharting search", selection);
            }
          }
        }
      });
    } catch (_) {}
  }

  return { register };
}
