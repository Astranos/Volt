import { makeFunctionReference } from "convex/server";
import { httpAction } from "../_generated/server";
import { requiredEnv, shopDomain } from "../shopifyHelpers";

type Topic = "customers/data_request" | "customers/redact" | "shop/redact";
const redactShop = makeFunctionReference<"mutation", { shop: string }, null>("shopifyCompliance:redactShop");
const encoder = new TextEncoder();

async function validHmac(body: ArrayBuffer, signature: string | null): Promise<boolean> {
  // Shopify signs the exact request bytes; Web Crypto verifies the MAC without a JS string comparison.
  if (!signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const decoded = Uint8Array.from(atob(signature), (character) => character.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", encoder.encode(requiredEnv("SHOPIFY_CLIENT_SECRET")),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, decoded, body);
}

function payloadShop(body: ArrayBuffer): string {
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid payload");
  const shop = (value as Record<string, unknown>).shop_domain;
  if (typeof shop !== "string") throw new Error("Invalid shop");
  return shopDomain(shop);
}

export function complianceHandler(topic: Topic) {
  return httpAction(async (ctx, request) => {
    const responseHeaders = { "Cache-Control": "no-store" };
    const body = await request.arrayBuffer();
    if (!await validHmac(body, request.headers.get("X-Shopify-Hmac-Sha256"))) {
      return new Response(null, { status: 401, headers: responseHeaders });
    }
    const headerTopic = request.headers.get("X-Shopify-Topic");
    if (headerTopic !== null && headerTopic !== topic) {
      return new Response(null, { status: 400, headers: responseHeaders });
    }
    let shop: string;
    try {
      shop = payloadShop(body);
    } catch {
      return new Response(null, { status: 400, headers: responseHeaders });
    }
    const headerShop = request.headers.get("X-Shopify-Shop-Domain");
    if (headerShop !== null && headerShop !== shop) {
      return new Response(null, { status: 400, headers: responseHeaders });
    }
    if (topic === "shop/redact") await ctx.runMutation(redactShop, { shop });
    return new Response(null, { status: 200, headers: responseHeaders });
  });
}

export const customerDataRequest = complianceHandler("customers/data_request");
export const customerRedact = complianceHandler("customers/redact");
export const shopRedact = complianceHandler("shop/redact");
