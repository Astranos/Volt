"use node";

import webPush from "web-push";
import { v } from "convex/values";

import { internalAction } from "./_generated/server";
import {
  logScannerSignalEvent,
  scannerSignalIdTail,
  scannerSignalRouteTemplate,
} from "./scannerSignal/logging";

const pushSubscriptionValidator = v.object({
  endpoint: v.string(),
  expirationTime: v.optional(v.union(v.number(), v.null())),
  keys: v.object({
    auth: v.string(),
    p256dh: v.string(),
  }),
});

function pushErrorStatusCode(error: unknown) {
  return typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
    ? error.statusCode
    : undefined;
}

export function logReconnectWakePushResult(args: {
  sent: boolean;
  pairingId: string;
  requestId: string;
  reason?: string;
  pushStatusCode?: number;
  elapsedMs?: number;
}) {
  logScannerSignalEvent(
    args.sent ? "push_wake_sent" : "push_wake_failed",
    {
      route: scannerSignalRouteTemplate("createReconnectRequest"),
      command: "createReconnectRequest",
      statusCode: args.sent ? 200 : undefined,
      elapsedMs: args.elapsedMs,
      pairingIdTail: scannerSignalIdTail(args.pairingId),
      requestIdTail: scannerSignalIdTail(args.requestId),
      pushStatusCode: args.pushStatusCode,
      reason: args.reason,
    },
    args.sent ? "info" : "warn",
  );
}

export const sendReconnectWakePush = internalAction({
  args: {
    subscription: v.union(pushSubscriptionValidator, v.null()),
    pairingId: v.string(),
    requestId: v.string(),
  },
  handler: async (_ctx, args) => {
    const startedAt = Date.now();
    const publicKey = process.env.SCANNER_PUSH_VAPID_PUBLIC_KEY;
    const privateKey = process.env.SCANNER_PUSH_VAPID_PRIVATE_KEY;
    const subject = process.env.SCANNER_PUSH_VAPID_SUBJECT ?? "mailto:scanner@volt.local";
    if (!args.subscription) {
      logReconnectWakePushResult({
        sent: false,
        pairingId: args.pairingId,
        requestId: args.requestId,
        reason: "missing_subscription",
        elapsedMs: Date.now() - startedAt,
      });
      return { sent: false };
    }
    if (!publicKey || !privateKey) {
      logReconnectWakePushResult({
        sent: false,
        pairingId: args.pairingId,
        requestId: args.requestId,
        reason: "missing_configuration",
        elapsedMs: Date.now() - startedAt,
      });
      return { sent: false };
    }

    webPush.setVapidDetails(subject, publicKey, privateKey);
    try {
      await webPush.sendNotification(
        args.subscription,
        JSON.stringify({
          type: "volt.scanner.reconnect",
          pairingId: args.pairingId,
          requestId: args.requestId,
          createdAt: new Date().toISOString(),
        }),
      );
      logReconnectWakePushResult({
        sent: true,
        pairingId: args.pairingId,
        requestId: args.requestId,
        elapsedMs: Date.now() - startedAt,
      });
      return { sent: true };
    } catch (error) {
      const pushStatusCode = pushErrorStatusCode(error);
      logReconnectWakePushResult({
        sent: false,
        pairingId: args.pairingId,
        requestId: args.requestId,
        reason: "send_failed",
        pushStatusCode,
        elapsedMs: Date.now() - startedAt,
      });
      return {
        sent: false,
        error: pushStatusCode ? `Push notification failed (${pushStatusCode})` : "Push notification failed",
      };
    }
  },
});
