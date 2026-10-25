import "@/entrypoints/options/options.css";
import { ShopifyAuditSettings } from "@/src/components/settings/ShopifyAuditSettings";
import { shopifyStatus } from "../fixtures/shopify";
import { defineScenario } from "../scenario";

// ?mode=tabs shows the tab group option selected.
export default defineScenario({
  description: "Settings: Shopify audit connection and 'Open audits in' choice (?mode=tabs)",
  viewport: { width: 900, height: 560 },
  chrome: {
    messages: {
      shopifyAuditStatus: shopifyStatus,
      shopifyAuditHiddenProducts: () => ({ success: true, value: [] }),
    },
    apis: { "tabs.query": [] },
  },
  render: (params) => {
    if (params.get("mode") === "tabs") void chrome.storage.sync.set({ shopifyAuditMode: "tabs" });
    return <div className="mx-auto max-w-3xl p-8"><ShopifyAuditSettings /></div>;
  },
});
