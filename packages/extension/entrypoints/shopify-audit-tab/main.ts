import { isShopifyAdminProductUrl } from "../../src/domain/shopify-audit";

// Stands in for a queued audit product so background tabs stay cheap; the real
// Shopify admin page loads only once the tab is actually viewed.
const params = new URLSearchParams(location.search);
const target = params.get("u") ?? "";
const title = params.get("t")?.trim() || "Shopify product";
document.title = title;
const heading = document.getElementById("title");
if (heading) heading.textContent = title;

if (isShopifyAdminProductUrl(target)) {
  const open = () => {
    if (document.visibilityState === "visible") location.replace(target);
  };
  open();
  document.addEventListener("visibilitychange", open);
} else {
  if (heading) heading.textContent = "This audit link is invalid.";
  const status = document.getElementById("status");
  if (status) status.textContent = "Start the audit again from the Volt new tab.";
}
