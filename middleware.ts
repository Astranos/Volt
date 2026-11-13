import { next } from "@vercel/functions";

// While the site moves to its new domain, every page shows the
// under-construction notice instead. The pages themselves are untouched:
// set this to false to bring them all back.
export const UNDER_CONSTRUCTION = true;

// Everything except the paths the apps rely on: the Shopify API proxy,
// iOS universal-link/App Clip association files, robots.txt and the
// service worker script.
export const config = {
  matcher: ["/((?!api/|\\.well-known/|apple-app-site-association|robots\\.txt|sw\\.js).*)"],
};

const shopifyPaths = new Set(["/shopify", "/shopify/", "/shopify.html"]);
const shopDomain = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/;

export default function middleware(request: Request) {
  return handle(request, UNDER_CONSTRUCTION);
}

export function handle(request: Request, underConstructionMode: boolean) {
  if (underConstructionMode) return underConstruction();

  const url = new URL(request.url);
  if (!shopifyPaths.has(url.pathname)) return next();

  const shop = url.searchParams.get("shop")?.toLowerCase() ?? "";
  const frameAncestors = shopDomain.test(shop)
    ? `https://${shop} https://admin.shopify.com`
    : "'none'";
  const response = next();
  response.headers.set("Content-Security-Policy", `frame-ancestors ${frameAncestors}`);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function underConstruction() {
  // 503 + Retry-After tells search engines this is temporary.
  return new Response(underConstructionPage, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "86400",
    },
  });
}

const underConstructionPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Under construction</title>
<style>
  :root { color-scheme: light dark; --bg: #f7f7f5; --fg: #1a1a1a; --muted: #5c5c5c; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111; --fg: #f2f2f2; --muted: #a3a3a3; } }
  html, body { height: 100%; margin: 0; }
  body {
    display: grid; place-items: center; padding: 16px; box-sizing: border-box;
    background: var(--bg); color: var(--fg);
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    text-align: center;
  }
  h1 { font-size: clamp(1.5rem, 5vw, 2.25rem); margin: 0 0 .5rem; letter-spacing: -0.01em; }
  p { margin: 0; color: var(--muted); }
</style>
</head>
<body>
  <main>
    <h1>Sorry, the site is under construction</h1>
    <p>We're moving to a new home. Please check back soon.</p>
  </main>
</body>
</html>
`;
