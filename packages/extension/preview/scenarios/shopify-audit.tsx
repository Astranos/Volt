import "@/entrypoints/sidepanel/sidepanel.css";
import ShopifyAuditReview from "@/src/components/sidepanel/ShopifyAuditReview";
import { SHOPIFY_AUDIT_REVIEW_KEY } from "@/src/domain/shopify-audit";
import { auditProducts, shop } from "../fixtures/shopify";
import { defineScenario } from "../scenario";

const date = "2026-10-17";
const ids = auditProducts.map((product) => product.id);
const states: Record<string, unknown> = {
  progress: {
    shop, date, products: auditProducts, tabId: 1, currentId: ids[6],
    marks: { [ids[0]]: "done", [ids[1]]: "done", [ids[2]]: "done", [ids[3]]: "done", [ids[4]]: "done", [ids[5]]: "done" },
  },
  done: {
    shop, date, products: auditProducts, tabId: 1, currentId: null,
    marks: Object.fromEntries(ids.map((id) => [id, "done"])),
  },
  empty: { shop, date, products: [], tabId: null, currentId: null, marks: {} },
};

// ?state=progress (default) | done | empty | start (no audit saved yet)
export default defineScenario({
  description: "Side panel Shopify audit review (?state=progress|done|empty|start)",
  viewport: { width: 380, height: 720 },
  chrome: {
    messages: {
      shopifyAuditStatus: () => ({ success: true, value: { shop } }),
      shopifyAuditListYesterday: () => ({ success: true, value: { shop, date, products: auditProducts } }),
    },
  },
  render: (params) => {
    const state = params.get("state") ?? "progress";
    if (state in states) void chrome.storage.local.set({ [SHOPIFY_AUDIT_REVIEW_KEY]: states[state] });
    return (
      <div id="volt-sidepanel-container" className="sidepanel-shell sidepanel-frame" style={{ height: "100vh" }}>
        <ShopifyAuditReview />
      </div>
    );
  },
});
