import { createRoot } from "react-dom/client";
import { ShopifyAuditApp } from "./shopify-audit-app";
import "../styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing Shopify application root");

createRoot(root).render(<ShopifyAuditApp />);
