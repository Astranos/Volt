"use node";

import webPush from "web-push";
import { v } from "convex/values";

import { internalAction } from "./_generated/server";

const pushSubscriptionValidator = v.object({
  endpoint: v.string(),
  expirationTime: v.optional(v.union(v.number(), v.null())),
  keys: v.object({
    auth: v.string(),
    p256dh: v.string(),
  }),
});

export const sendReconnectWakePush = internalAction({
  args: {
    subscription: v.union(pushSubscriptionValidator, v.null()),
    pairingId: v.string(),
    requestId: v.string(),
  },
  handler: async (_ctx, args) => {
    const publicKey = process.env.SCANNER_PUSH_VAPID_PUBLIC_KEY;
    const privateKey = process.env.SCANNER_PUSH_VAPID_PRIVATE_KEY;
    const subject = process.env.SCANNER_PUSH_VAPID_SUBJECT ?? "mailto:scanner@volt.local";
    if (!args.subscription || !publicKey || !privateKey) return { sent: false };

    webPush.setVapidDetails(subject, publicKey, privateKey);
    await webPush.sendNotification(
      args.subscription,
      JSON.stringify({
        type: "volt.scanner.reconnect",
        pairingId: args.pairingId,
        requestId: args.requestId,
        createdAt: new Date().toISOString(),
      }),
    );
    return { sent: true };
  },
});
