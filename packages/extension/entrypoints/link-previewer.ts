import { defineContentScript } from "wxt/utils/define-content-script";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main() {
    const log = (...args: any[]) => {
      console.log("[Volt - Link Previewer]", ...args);
    };

    // Check if extension context is still valid
    const isContextValid = () => !!chrome.runtime?.id;

    // Safe wrapper for sendMessage
    const safeSendMessage = (message: object) => {
      if (!isContextValid()) return;
      try {
        chrome.runtime.sendMessage(message);
      } catch {
        // Context invalidated, ignore silently
      }
    };

    window.addEventListener(
      "click",
      (e) => {
        // Only trigger on Shift + Click
        if (!e.shiftKey) return;

        // Find the closest anchor tag
        const target = e.target as HTMLElement;
        const anchor = target.closest("a");

        if (!anchor || !anchor.href) return;

        // Skip if it's not a real link or has no href
        if (
          anchor.href.startsWith("javascript:") ||
          anchor.href.startsWith("#") ||
          !anchor.href.startsWith("http")
        ) {
          return;
        }

        // Prevent default navigation
        e.preventDefault();
        e.stopPropagation();

        log("Opening preview for:", anchor.href);

        // Send message to background script to open the preview
        safeSendMessage({
          action: "openPreviewPopup",
          url: anchor.href,
          // Send mouse coordinates for potential positioning
          x: e.screenX,
          y: e.screenY,
        });
      },
      true // Use capture phase to intercept clicks before other handlers
    );

    // Auto-dismiss logic: if this window (the parent) gets focus,
    // we can notify the background script to close the popup.
    // This mimics the shopify-buttons.ts behavior.
    window.addEventListener("focus", () => {
      safeSendMessage({ action: "parentWindowFocused" });
    });
  },
});
