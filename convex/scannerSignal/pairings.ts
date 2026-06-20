import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import {
  SCANNER_PAIRING_TTL_MS,
  isScannerJoinToken,
  isScannerPairingId,
  isScannerSessionId,
  scannerSignalIso,
} from "@volt/scanner-protocol";
import { getPairingByPairingId } from "./lookups";
import { optionalString, pushSubscriptionValidator } from "./validators";

export const registerPairing = internalMutation({
  args: {
    pairingId: v.string(),
    pairingSecret: v.string(),
    browserSessionId: v.string(),
    displayName: optionalString,
    phoneDeviceId: optionalString,
    phoneLabel: optionalString,
    pushSubscription: v.optional(pushSubscriptionValidator),
  },
  handler: async (ctx, args) => {
    if (!isScannerPairingId(args.pairingId)) return { statusCode: 400, body: { error: "Invalid pairing id" } };
    if (!isScannerJoinToken(args.pairingSecret)) return { statusCode: 400, body: { error: "Invalid pairing secret" } };
    if (!isScannerSessionId(args.browserSessionId)) return { statusCode: 400, body: { error: "Invalid browser session id" } };
    const existing = await getPairingByPairingId(ctx, args.pairingId);
    if (existing && existing.secret !== args.pairingSecret) {
      return { statusCode: 409, body: { error: "Pairing already exists" } };
    }
    const now = Date.now();
    const nextPairing = {
      pairingId: args.pairingId,
      secret: args.pairingSecret,
      browserSessionId: args.browserSessionId,
      status: "active" as const,
      ...(args.displayName ? { displayName: args.displayName } : {}),
      ...(args.phoneDeviceId ? { phoneDeviceId: args.phoneDeviceId } : {}),
      ...(args.phoneLabel ? { phoneLabel: args.phoneLabel } : {}),
      ...(args.pushSubscription ?? existing?.pushSubscription ? { pushSubscription: args.pushSubscription ?? existing?.pushSubscription } : {}),
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now,
      expiresAt: now + SCANNER_PAIRING_TTL_MS,
    };
    if (existing) await ctx.db.replace(existing._id, nextPairing);
    else await ctx.db.insert("scannerPairings", nextPairing);
    const pairing = await getPairingByPairingId(ctx, args.pairingId);
    if (!pairing) throw new Error("Pairing upsert failed");
    return {
      statusCode: 200,
      body: {
        pairingId: pairing.pairingId,
        browserSessionId: pairing.browserSessionId,
        ...(pairing.displayName ? { displayName: pairing.displayName } : {}),
        expiresAt: scannerSignalIso(pairing.expiresAt),
      },
    };
  },
});
