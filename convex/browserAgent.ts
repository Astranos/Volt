import { ConvexError } from "convex/values";
import { action, env } from "./_generated/server";
import { requestValidator, resultValidator, validBrowserAgentRequest, type BrowserAgentResult } from "./browserAgent/contracts";
import { chooseBrowserAction } from "./browserAgent/decision";
import { createJevClient } from "./priceAudit/jevClient";

export const decide = action({
  args: { request: requestValidator },
  returns: resultValidator,
  handler: async (ctx, { request }): Promise<BrowserAgentResult> => {
    if (!await ctx.auth.getUserIdentity()) throw new ConvexError("Sign in to Volt to use Agent.");
    if (!validBrowserAgentRequest(request)) throw new ConvexError("Agent received invalid or oversized page evidence.");
    const apiKey = env.JEV_API_KEY?.trim();
    if (!apiKey) throw new ConvexError("Agent is not configured on this server. Contact your Volt administrator.");
    try {
      return await chooseBrowserAction(createJevClient({ apiKey }), request);
    } catch {
      throw new ConvexError("Jev could not choose the next browser step. No action was authorized; please retry later.");
    }
  },
});
