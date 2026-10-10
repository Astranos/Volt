import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";

export const stripeWebhook = httpAction(async (ctx, request) => {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Invalid signature", { status: 400 });
  // Keep the bytes represented by request.text() untouched for SDK verification.
  const rawBody = await request.text();
  try {
    const result = await ctx.runAction(internal.stripeBilling.processWebhook, {
      rawBody,
      signature,
    });
    return new Response(
      result.status === 200 ? "Received" : "Webhook unavailable or invalid",
      { status: result.status },
    );
  } catch {
    // A non-2xx lets Stripe retry API outages and failed database transactions.
    return new Response("Webhook processing failed", { status: 500 });
  }
});
