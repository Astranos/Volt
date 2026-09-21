import { ConvexError, v } from "convex/values";
import { MINUTE, DAY, RateLimiter, isRateLimitError } from "@convex-dev/rate-limiter";
import { action, env, internalMutation } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { requestValidator, resultValidator, validAuditRequest, type AuditDecisionResult } from "./priceAudit/contracts";
import { createAuditDecisions } from "./priceAudit/decisions";
import { createJevClient } from "./priceAudit/jevClient";

const rateLimiter = new RateLimiter(components.rateLimiter, {
  priceAuditMinute: { kind: "token bucket", rate: 120, period: MINUTE, capacity: 30 },
  priceAuditDay: { kind: "fixed window", rate: 4000, period: DAY },
  priceAuditSharedDay: { kind: "fixed window", rate: 20_000, period: DAY },
});

// Reserve atomically for each upstream attempt, including transient-error retries.
export const reserve = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in to Volt to use Price Audit.");
    const key = identity.tokenIdentifier;
    await rateLimiter.limit(ctx, "priceAuditMinute", { key, throws: true });
    await rateLimiter.limit(ctx, "priceAuditDay", { key, throws: true });
    await rateLimiter.limit(ctx, "priceAuditSharedDay", { throws: true });
    return null;
  },
});

export const decide = action({
  args: { request: requestValidator },
  returns: resultValidator,
  handler: async (ctx, { request }): Promise<AuditDecisionResult> => {
    if (!await ctx.auth.getUserIdentity()) throw new ConvexError("Sign in to Volt to use Price Audit.");
    if (!validAuditRequest(request)) throw new ConvexError("Price Audit received invalid or oversized evidence.");
    const apiKey = env.JEV_API_KEY?.trim();
    if (!apiKey) throw new ConvexError("Price Audit is not configured on this server. Contact your Volt administrator.");
    const decisions = createAuditDecisions(createJevClient({
      apiKey,
      beforeRequest: async () => { await ctx.runMutation(internal.priceAudit.reserve, {}); },
    }));
    const signal = new AbortController().signal;
    try {
      switch (request.kind) {
        case "reviewItem": return { kind: request.kind, accepted: await decisions.reviewItem(request.item, signal) };
        case "chooseQuery": return { kind: request.kind, query: await decisions.chooseQuery(request.item, signal) };
        case "selectComparables": return { kind: request.kind, comparables: await decisions.selectComparables(request.item, request.candidates, signal) };
        case "verifyResult": return { kind: request.kind, verified: await decisions.verifyResult(request.item, request.comparables, signal) };
        case "chooseNextPage": return { kind: request.kind, url: await decisions.chooseNextPage(request.links, signal) };
      }
    } catch (error) {
      if (isRateLimitError(error)) {
        throw new ConvexError("Price Audit reached a server safety limit. Your partial results are retained; try again after the limit resets.");
      }
      // Never send upstream response bodies, authorization headers, or server stack details to the client.
      throw new ConvexError("Jev could not complete this decision. Your partial results are retained; try again later.");
    }
  },
});
