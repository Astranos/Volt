import { readFile } from "node:fs/promises";

const paths = ["status", "yesterday", "search"].map((name) => `/api/shopify/admin/${name}`);
const router = await readFile(new URL("../convex/http.ts", import.meta.url), "utf8");
for (const path of paths) {
  if (!router.includes(`path: "${path}", method: "POST"`)) {
    throw new Error(`Backend release is missing the embedded Shopify route: ${path}`);
  }
}

if (!process.argv.includes("--source-only")) {
  for (const base of ["https://sincere-trout-414.convex.site", "https://voltresale.app"]) {
    for (const path of paths) {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(15_000),
      });
      // An unauthenticated request must reach the token verifier, not a missing route.
      if (response.status !== 401) {
        throw new Error(`${base}${path}: expected authentication rejection (401), got ${response.status}`);
      }
      console.log(`${base}${path}: authentication guard reached (401)`);
    }
  }
}
console.log("Embedded Shopify backend routes verified.");
