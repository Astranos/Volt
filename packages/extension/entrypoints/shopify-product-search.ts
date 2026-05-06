import { defineContentScript } from "wxt/utils/define-content-script";

export default defineContentScript({
  matches: ["https://admin.shopify.com/store/*/products*"],
  runAt: "document_idle",
  main() {
    let lastUrl = location.href;

    const notifySidepanel = () => {
      const url = new URL(location.href);
      const query = url.searchParams.get("query") || "";
      
      // Extract store name from URL
      // Format: https://admin.shopify.com/store/[storeName]/products
      const match = location.href.match(/\/store\/([^/]+)\/products/);
      const storeName = match ? match[1] : "";

      chrome.runtime.sendMessage({
        type: "SHOPIFY_SEARCH_UPDATE",
        data: {
          query,
          storeName,
          url: location.href
        }
      }).catch(() => {
        // Ignore errors if sidepanel is closed
      });
    };

    // Initial notification
    notifySidepanel();

    // Watch for URL changes (SPA navigation)
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            notifySidepanel();
        }
    }, 1000);
  },
});
