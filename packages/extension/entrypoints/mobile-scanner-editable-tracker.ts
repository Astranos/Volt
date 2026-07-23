import { defineContentScript } from "wxt/utils/define-content-script";
import { installEditableTracker } from "../src/components/sidepanel/mobile-scanner-page-bridge";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  allFrames: true,
  matchAboutBlank: true,
  main() {
    installEditableTracker();
  },
});
