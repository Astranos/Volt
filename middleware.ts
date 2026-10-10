import { next } from "@vercel/functions";

export const config = {
  matcher: ["/shopify", "/shopify/", "/shopify.html"],
};

const shopDomain = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/;

export default function middleware(request: Request) {
  const shop = new URL(request.url).searchParams.get("shop")?.toLowerCase() ?? "";
  const frameAncestors = shopDomain.test(shop)
    ? `https://${shop} https://admin.shopify.com`
    : "'none'";
  const response = next();
  response.headers.set("Content-Security-Policy", `frame-ancestors ${frameAncestors}`);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
