import { createRoot } from "react-dom/client";
import { ShopifyComparePage } from "../../src/components/shopify-compare/ShopifyComparePage";

const container = document.getElementById("root");
if (container) createRoot(container).render(<ShopifyComparePage />);
