import { next } from "@vercel/functions";

export const config = {
  matcher: [
    "/shopify", "/shopify/", "/shopify.html",
    "/sign-in/:path*", "/sign-up/:path*", "/dashboard/:path*",
    "/settings/:path*", "/handbook/:path*", "/scanner-results/:path*",
    "/app-sign-in/:path*", "/app-sign-in.html", "/clip/:path*", "/clip.html",
  ],
};

const shopDomain = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/;
const accountRoute = /^\/(?:sign-in|sign-up|dashboard|settings|handbook|scanner-results|app-sign-in|clip)(?:\/|\.html$|$)/;

export default function middleware(request: Request) {
  const url = new URL(request.url);
  // Keep the installed Chrome and iOS clients on their trusted auth origin.
  if (url.hostname === "donut.juanquenga.com" && accountRoute.test(url.pathname)) {
    url.hostname = "voltresale.app";
    return new Response(null, {
      status: 307,
      headers: { Location: url.href, "Cache-Control": "no-store" },
    });
  }
  if (!/^\/shopify(?:\/|\.html)?$/.test(url.pathname)) return next();
  const shop = url.searchParams.get("shop")?.toLowerCase() ?? "";
  const frameAncestors = shopDomain.test(shop)
    ? `https://${shop} https://admin.shopify.com`
    : "'none'";
  const response = next();
  response.headers.set("Content-Security-Policy", `frame-ancestors ${frameAncestors}`);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
