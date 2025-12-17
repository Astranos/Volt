// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
/* global chrome */

import { defineContentScript } from "wxt/utils/define-content-script";

/**
 * Minimal gamepad listener that logs controller connections for debugging.
 * Auto-opening of the controller sidepanel has been removed.
 */
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  allFrames: false,
  main() {
    // Only run once on the top-level browsing context
    if (window.top !== window) return;

    const log = (...args) => {
      try {
        console.log("[Scout CS]", ...args);
      } catch (_) {}
    };

    window.addEventListener("gamepadconnected", (event) => {
      log("gamepadconnected", {
        id: event?.gamepad?.id,
        index: event?.gamepad?.index,
      });
    });
  },
});
