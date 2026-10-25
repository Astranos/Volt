import "@/entrypoints/sidepanel/sidepanel.css";
import ShopifyAuditReview from "@/src/components/sidepanel/ShopifyAuditReview";
import { SHOPIFY_AUDIT_DAYS_KEY, SHOPIFY_AUDIT_REVIEW_KEY } from "@/src/domain/shopify-audit";
import { auditProducts, shop, shopifyStatus } from "../fixtures/shopify";
import { defineScenario } from "../scenario";

const date = "2026-10-17";
const ids = auditProducts.map((product) => product.id);
const states: Record<string, unknown> = {
  progress: {
    shop, date, days: 1, products: auditProducts, tabId: 1, currentId: ids[6],
    marks: { [ids[0]]: "done", [ids[1]]: "done", [ids[2]]: "done", [ids[3]]: "done", [ids[4]]: "done", [ids[5]]: "done", [ids[6]]: "done" },
  },
  done: {
    shop, date, products: auditProducts, tabId: 1, currentId: null,
    marks: Object.fromEntries(ids.map((id) => [id, "done"])),
  },
  empty: { shop, date, products: [], tabId: null, currentId: null, marks: {} },
};

// ?state=progress (default) | done | empty | start (no audit saved yet); ?days=2|3 widens the range;
// ?stores=1 hides the store picker shown when several stores are connected.
export default defineScenario({
  description: "Side panel Shopify audit review (?state=progress|done|empty|start, ?days=3, ?stores=1 for a single store)",
  viewport: { width: 380, height: 720 },
  chrome: {
    messages: {
      shopifyAuditStatus: shopifyStatus,
      shopifyAuditListYesterday: () => ({ success: true, value: { shop, date, products: auditProducts } }),
    },
  },
  render: (params) => {
    const state = params.get("state") ?? "progress";
    const days = Number(params.get("days") ?? 1);
    if (state in states) {
      const review = states[state] as Record<string, unknown>;
      void chrome.storage.local.set({
        [SHOPIFY_AUDIT_REVIEW_KEY]: { ...review, days, date: days === 3 ? "2026-10-15" : review.date },
        [SHOPIFY_AUDIT_DAYS_KEY]: days,
      });
    }
    return (
      <div id="volt-sidepanel-container" className="sidepanel-shell sidepanel-frame" style={{ height: "100vh" }}>
        <ShopifyAuditReview />
      </div>
    );
  },
});
