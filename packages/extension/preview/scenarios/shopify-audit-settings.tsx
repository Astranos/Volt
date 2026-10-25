import "@/entrypoints/options/options.css";
import { ShopifyAuditSettings } from "@/src/components/settings/ShopifyAuditSettings";
import { shopifyStatus } from "../fixtures/shopify";
import { waitFor } from "../dom";
import { defineScenario } from "../scenario";

// ?mode=tabs shows the tab group option selected; ?stores=0|1|3|5 sets how many stores
// are connected; &adding=1 opens "Connect another store".
export default defineScenario({
  description: "Settings: connected Shopify stores and 'Open audits in' choice (?stores=0|1|3|5, &adding=1, ?mode=tabs)",
  // Tall enough for five stores, the connect form, and hidden products.
  viewport: { width: 900, height: 1120 },
  chrome: {
    messages: {
      shopifyAuditStatus: shopifyStatus,
      shopifyAuditHiddenProducts: () => ({ success: true, value: [{ id: "gid://shopify/Product/105", title: "Apple iPhone 13 128GB Pink — Verizon (For parts)" }] }),
    },
    // A store open in a Shopify admin tab, offered when connecting another.
    apis: { "tabs.query": [{ id: 9, url: "https://admin.shopify.com/store/volt-demo-northside/products" }] },
  },
  render: (params) => {
    if (params.get("mode") === "tabs") void chrome.storage.sync.set({ shopifyAuditMode: "tabs" });
    return <div className="mx-auto max-w-3xl p-8"><ShopifyAuditSettings /></div>;
  },
  act: async (params) => {
    if (params.get("adding") !== "1") return;
    await waitFor("#shopify-audit li");
    [...document.querySelectorAll("button")].find((button) => button.textContent === "Connect another store")?.click();
    await waitFor("#shopify-audit select");
  },
});
