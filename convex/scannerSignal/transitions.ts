import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export function requireActiveJoinToken(token: Doc<"scannerJoinTokens">, now: number) {
  if (token.revokedAt) return { statusCode: 410, body: { error: "Join token revoked" } };
  if (token.expiresAt <= now) return { statusCode: 410, body: { error: "Join token expired" } };
  return null;
}

export function requireBrowserClaim(
  token: Doc<"scannerJoinTokens">,
  browserClaim: string | undefined,
) {
  return !token.browserClaim || token.browserClaim === browserClaim;
}

export function requirePairingSecret(
  pairing: Doc<"scannerPairings">,
  pairingSecret: string | undefined,
) {
  return pairing.secret === pairingSecret;
}

export function requireActivePairing(pairing: Doc<"scannerPairings">, now: number) {
  return pairing.status === "active" && pairing.expiresAt > now;
}

export async function expireAttemptIfNeeded(
  ctx: MutationCtx,
  attempt: Doc<"scannerJoinAttempts">,
  now: number,
) {
  if (attempt.expiresAt > now || attempt.status === "answer_posted" || attempt.status === "expired") {
    return attempt;
  }
  await ctx.db.patch(attempt._id, { status: "expired" });
  return { ...attempt, status: "expired" as const };
}

export async function expireReconnectIfNeeded(
  ctx: MutationCtx,
  request: Doc<"scannerReconnectRequests">,
  now: number,
) {
  if (request.expiresAt > now || request.status !== "waiting_for_browser") return request;
  await ctx.db.patch(request._id, { status: "expired" });
  return { ...request, status: "expired" as const };
}
