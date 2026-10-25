import NewTab from "@/entrypoints/newtab/NewTab";
import "@/entrypoints/newtab/newtab.css";
import "@/src/components/cmdk-palette/styles.css";
import { RELEASE_NOTES_VERSION } from "@/src/components/newtab/release-notes";
import { TAB_ACTIONS } from "@/src/background/tab-message-handler";
import { typeInto, waitFor } from "../dom";
import { kioskQueue, shopifyMessages } from "../fixtures/shopify";
import { bookmarkTree, closedTabs } from "../fixtures/tabs";
import { defineScenario } from "../scenario";

// ?q=<text> types into the search box; "s iphone" searches the Shopify store.
export default defineScenario({
  description: "New tab page with closed tabs and bookmarks (?q= types a search, e.g. q=s+iphone; &compare=1 picks one; kiosk=1 shows kiosk requests; stores=1 hides the store picker; shopifyError=1 fails the search)",
  viewport: { width: 1440, height: 900 },
  chrome: {
    storage: { local: { voltWhatsNewSeenVersion: RELEASE_NOTES_VERSION } },
    messages: { [TAB_ACTIONS.getClosedTabs]: () => ({ tabs: closedTabs }), ...shopifyMessages },
    apis: { "bookmarks.getTree": bookmarkTree, "bookmarks.getSubTree": bookmarkTree[0].children },
  },
  // &kiosk=1 sets a kiosk store and answers the kiosk API with sample requests.
  render: (params) => {
    if (params.get("kiosk") === "1") {
      void chrome.storage.sync.set({ kioskStoreSlug: "taylormi" });
      const realFetch = window.fetch.bind(window);
      window.fetch = (input, init) => String(input).startsWith("https://pm.voltresale.app/")
        ? Promise.resolve(Response.json(kioskQueue()))
        : realFetch(input, init);
    }
    return <NewTab />;
  },
  act: async (params) => {
    const query = params.get("q");
    if (!query) return;
    await typeInto(".closed-tabs-search-input", query);
    if (query.startsWith("s ")) await waitFor(".shopify-product-card, .shopify-search-message");
    // ?compare=1 picks the first result, which turns on compare mode.
    if (params.get("compare") === "1") {
      (await waitFor<HTMLButtonElement>(".shopify-product-compare")).click();
      await waitFor(".shopify-compare-hint");
    }
  },
});
