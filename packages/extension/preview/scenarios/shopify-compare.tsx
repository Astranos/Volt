import { ShopifyComparePage } from "@/src/components/shopify-compare/ShopifyComparePage";
import { compareDetails } from "../fixtures/shopify";
import { waitFor } from "../dom";
import { defineScenario } from "../scenario";

// The compare page reads ?ids= from the address; ?photo=1 opens the full-screen photo viewer.
export default defineScenario({
  description: "Compare page for two products (?ids=101,102; ?photo=1 enlarges the first photo)",
  viewport: { width: 1280, height: 900 },
  chrome: { messages: { shopifyAuditProductDetails: () => ({ success: true, value: compareDetails }) } },
  render: () => <ShopifyComparePage />,
  act: async (params) => {
    if (params.get("photo") !== "1") return;
    (await waitFor<HTMLButtonElement>(".compare-gallery-zoom")).click();
    await waitFor(".compare-lightbox img");
  },
});
