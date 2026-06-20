import type { MutationCtx } from "../_generated/server";

export async function getJoinTokenByToken(ctx: MutationCtx, token: string) {
  return await ctx.db
    .query("scannerJoinTokens")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
}

export async function getJoinAttemptByTokenAndAttemptId(
  ctx: MutationCtx,
  token: string,
  attemptId: string,
) {
  return await ctx.db
    .query("scannerJoinAttempts")
    .withIndex("by_token_and_attemptId", (q) =>
      q.eq("token", token).eq("attemptId", attemptId),
    )
    .unique();
}

export async function getPairingByPairingId(ctx: MutationCtx, pairingId: string) {
  return await ctx.db
    .query("scannerPairings")
    .withIndex("by_pairingId", (q) => q.eq("pairingId", pairingId))
    .unique();
}

export async function getReconnectRequestByPairingAndRequestId(
  ctx: MutationCtx,
  pairingId: string,
  requestId: string,
) {
  return await ctx.db
    .query("scannerReconnectRequests")
    .withIndex("by_pairingId_and_requestId", (q) =>
      q.eq("pairingId", pairingId).eq("requestId", requestId),
    )
    .unique();
}
