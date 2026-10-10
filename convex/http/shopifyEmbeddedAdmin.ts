import { makeFunctionReference } from "convex/server";
import { httpAction, type ActionCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { bearerIdToken, InvalidShopifyIdToken, verifyShopifyIdToken } from "../shopifyEmbeddedAuth";
import { auditRange, decryptToken, encryptToken, fetchSearchProducts, fetchYesterday, nonce, object, productSearchQuery, requiredEnv, string } from "../shopifyHelpers";

type Installation = Doc<"shopifyEmbeddedInstallations">;
type Tokens = Pick<Installation, "encryptedAccessToken" | "encryptedRefreshToken" | "expiresAt" | "refreshExpiresAt">;
const read = makeFunctionReference<"query", { shop: string }, Installation | null>("shopifyEmbeddedStore:read");
const beginExchange = makeFunctionReference<"mutation", { shop: string; nonce: string }, "ready" | "leased" | "acquired">("shopifyEmbeddedStore:beginExchange");
const finishExchange = makeFunctionReference<"mutation", { shop: string; nonce: string } & Required<Tokens>, null>("shopifyEmbeddedStore:finishExchange");
const cancelExchange = makeFunctionReference<"mutation", { shop: string; nonce: string }, null>("shopifyEmbeddedStore:cancelExchange");

class AdminApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({ "Cache-Control": "no-store", "Vary": "Origin" });
  const origin = request.headers.get("Origin");
  if (origin && (origin === "https://voltresale.app" || /^http:\/\/localhost:(?:3000|4173|5173)$/.test(origin))) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  }
  return headers;
}

function json(request: Request, status: number, value: unknown, retry = false): Response {
  const headers = corsHeaders(request);
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (retry) headers.set("X-Shopify-Retry-Invalid-Session-Request", "1");
  return new Response(JSON.stringify(value), { status, headers });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) throw new AdminApiError(400, "Expected a JSON body.");
  const raw = await request.text();
  if (raw.length > 4096) throw new AdminApiError(413, "Request body is too large.");
  try { return object(JSON.parse(raw)); }
  catch { throw new AdminApiError(400, "Invalid JSON body."); }
}

async function exchangeIdToken(shop: string, idToken: string) {
  let response: Response;
  try {
    response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: requiredEnv("SHOPIFY_CLIENT_ID"),
        client_secret: requiredEnv("SHOPIFY_CLIENT_SECRET"),
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: idToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
        requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
        expiring: "1",
      }),
    });
  } catch { throw new AdminApiError(503, "Shopify is unavailable. Try again."); }
  if (response.status === 400) throw new InvalidShopifyIdToken();
  if (!response.ok) throw new AdminApiError(502, "Shopify authorization failed. Reload the app.");
  let result: Record<string, unknown>;
  try { result = object(await response.json()); }
  catch { throw new AdminApiError(502, "Shopify returned an invalid token response."); }
  const scope = string(result.scope).split(",");
  if (!scope.includes("read_products") && !scope.includes("write_products")) throw new AdminApiError(403, "Shopify did not grant product read access.");
  if (typeof result.expires_in !== "number" || !Number.isFinite(result.expires_in) || result.expires_in <= 0
    || typeof result.refresh_token_expires_in !== "number" || !Number.isFinite(result.refresh_token_expires_in) || result.refresh_token_expires_in <= 0) {
    throw new AdminApiError(502, "Shopify did not return an expiring offline token.");
  }
  return {
    access: string(result.access_token), refresh: string(result.refresh_token),
    expiresAt: Date.now() + result.expires_in * 1000,
    refreshExpiresAt: Date.now() + result.refresh_token_expires_in * 1000,
  };
}

async function installationAccess(ctx: ActionCtx, shop: string, idToken: string): Promise<{ row: Installation; access: string }> {
  const exchangeNonce = nonce();
  const state = await ctx.runMutation(beginExchange, { shop, nonce: exchangeNonce });
  if (state === "leased") throw new AdminApiError(409, "Shopify is connecting. Try again shortly.");
  if (state === "acquired") {
    try {
      const tokens = await exchangeIdToken(shop, idToken);
      const aad = `embedded|${shop}`;
      await ctx.runMutation(finishExchange, {
        shop, nonce: exchangeNonce,
        encryptedAccessToken: await encryptToken(tokens.access, aad),
        encryptedRefreshToken: await encryptToken(tokens.refresh, aad),
        expiresAt: tokens.expiresAt, refreshExpiresAt: tokens.refreshExpiresAt,
      });
    } catch (error) {
      await ctx.runMutation(cancelExchange, { shop, nonce: exchangeNonce }).catch(() => null);
      throw error;
    }
  }
  const row = await ctx.runQuery(read, { shop });
  if (!row?.encryptedAccessToken || !row.expiresAt || row.expiresAt <= Date.now()) {
    throw new AdminApiError(409, "Shopify installation changed. Reload the app.");
  }
  return { row, access: await decryptToken(row.encryptedAccessToken, `embedded|${shop}`) };
}

async function verifiedRequest(ctx: ActionCtx, request: Request, kind: "status" | "yesterday" | "search") {
  const idToken = bearerIdToken(request);
  const shop = await verifyShopifyIdToken(idToken);
  const input = await body(request);
  let range: ReturnType<typeof auditRange> | null = null;
  let search: string | null = null;
  if (kind === "yesterday") {
    if (typeof input.date !== "string" || typeof input.startUtc !== "string" || typeof input.endUtc !== "string") {
      throw new AdminApiError(400, "Invalid previous-day date range.");
    }
    range = auditRange(input.startUtc, input.endUtc, input.date);
  } else if (kind === "search") {
    if (typeof input.query !== "string") throw new AdminApiError(400, "Enter a product name, SKU, or barcode.");
    productSearchQuery(input.query);
    search = input.query;
  }
  const { row, access } = await installationAccess(ctx, shop, idToken);
  if (kind === "status") return { shop };
  const result = range ? await fetchYesterday(shop, access, range) : await fetchSearchProducts(shop, access, search ?? "");
  const current = await ctx.runQuery(read, { shop });
  if (current?._id !== row._id) throw new AdminApiError(409, "Shopify installation changed. Reload the app.");
  return result;
}

function handler(kind: "status" | "yesterday" | "search") {
  return httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");
    if (origin && !corsHeaders(request).has("Access-Control-Allow-Origin")) {
      return json(request, 403, { error: "Origin is not allowed." });
    }
    try { return json(request, 200, await verifiedRequest(ctx, request, kind)); }
    catch (error) {
      if (error instanceof InvalidShopifyIdToken) return json(request, 401, { error: error.message }, true);
      if (error instanceof AdminApiError) return json(request, error.status, { error: error.message });
      if (error instanceof Error && error.message.includes("Invalid previous-day date range")) return json(request, 400, { error: error.message });
      if (error instanceof Error && (error.message.includes("Search for 2 to 120") || error.message.includes("Enter a product"))) {
        return json(request, 400, { error: error.message });
      }
      return json(request, 502, { error: "Shopify request failed. Try again." });
    }
  });
}

export const status = handler("status");
export const yesterday = handler("yesterday");
export const search = handler("search");
export const options = httpAction(async (_ctx, request) => {
  const headers = corsHeaders(request);
  return new Response(null, { status: headers.has("Access-Control-Allow-Origin") ? 204 : 403, headers });
});
