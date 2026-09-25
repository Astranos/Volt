import { makeFunctionReference } from "convex/server";
import { httpAction } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { encryptToken, exchangeToken, verifyCallback } from "../shopifyHelpers";

const consume = makeFunctionReference<"mutation", { shop: string; state: string }, { id: Id<"shopifyOAuthStates">; ownerTokenIdentifier: string }>("shopifyStore:consume");
const finish = makeFunctionReference<"mutation", { stateId: Id<"shopifyOAuthStates"> } & Pick<Doc<"shopifyConnections">, "encryptedAccessToken" | "encryptedRefreshToken" | "expiresAt" | "refreshExpiresAt">, null>("shopifyStore:finish");

export const shopifyCallback = httpAction(async (ctx, request) => {
  const headers = {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "Referrer-Policy": "no-referrer",
  };
  try {
    const { shop, state, code } = await verifyCallback(new URL(request.url).searchParams);
    const owner = await ctx.runMutation(consume, { shop, state });
    const tokens = await exchangeToken(shop, { code, expiring: "1" });
    const aad = `${owner.ownerTokenIdentifier}|${shop}`;
    await ctx.runMutation(finish, {
      stateId: owner.id,
      encryptedAccessToken: await encryptToken(tokens.access, aad),
      encryptedRefreshToken: await encryptToken(tokens.refresh, aad),
      expiresAt: tokens.expiresAt, refreshExpiresAt: tokens.refreshExpiresAt,
    });
    return new Response("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Shopify connected</title><h1>Shopify connected</h1><p>You can close this tab and return to Volt.</p></html>", { headers });
  } catch {
    return new Response("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Shopify connection failed</title><h1>Shopify connection failed</h1><p>Return to Volt and connect your store again. Check that the app has product read access.</p></html>", { status: 400, headers });
  }
});
