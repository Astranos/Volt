import { ConvexError } from "convex/values";
import { action, env } from "./_generated/server";
import { requestValidator, resultValidator, validAuditRequest, type AuditDecisionResult } from "./priceAudit/contracts";
import { createAuditDecisions } from "./priceAudit/decisions";
import { createJevClient } from "./priceAudit/jevClient";

export const decide = action({
  args: { request: requestValidator },
  returns: resultValidator,
  handler: async (ctx, { request }): Promise<AuditDecisionResult> => {
    if (!await ctx.auth.getUserIdentity()) throw new ConvexError("Sign in to Volt to use Price Audit.");
    if (!validAuditRequest(request)) throw new ConvexError("Price Audit received invalid or oversized evidence.");
    const apiKey = env.JEV_API_KEY?.trim();
    if (!apiKey) throw new ConvexError("Price Audit is not configured on this server. Contact your Volt administrator.");
    const decisions = createAuditDecisions(createJevClient({ apiKey }));
    const signal = new AbortController().signal;
    try {
      switch (request.kind) {
        case "reviewItem": return { kind: request.kind, accepted: await decisions.reviewItem(request.item, signal) };
        case "chooseQuery": return { kind: request.kind, query: await decisions.chooseQuery(request.item, signal) };
        case "selectComparables": return { kind: request.kind, comparables: await decisions.selectComparables(request.item, request.candidates, signal) };
        case "verifyResult": return { kind: request.kind, comparables: await decisions.verifyResult(request.item, request.comparables, signal) };
        case "chooseNextPage": return { kind: request.kind, url: await decisions.chooseNextPage(request.links, signal) };
      }
    } catch (error) {
      // Never send upstream response bodies, authorization headers, or server stack details to the client.
      throw new ConvexError("Jev could not complete this decision. Your partial results are retained; try again later.");
    }
  },
});
