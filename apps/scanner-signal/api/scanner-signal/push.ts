import webPush from "web-push";

import {
  SCANNER_RECONNECT_REQUEST_TTL_MS,
  type ScannerWebPushSubscription,
} from "../../../../packages/scanner-protocol/src/index.ts";
import type { PairingRecord } from "./storage.ts";

export type WebPushSubscriptionRecord = ScannerWebPushSubscription;

const vapidPublicKey = process.env.SCANNER_PUSH_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.SCANNER_PUSH_VAPID_PRIVATE_KEY;
const vapidSubject = process.env.SCANNER_PUSH_VAPID_SUBJECT ?? "mailto:scanner-signal@volt.local";

function hasWebPushConfig() {
  return Boolean(vapidPublicKey && vapidPrivateKey);
}

export function publicPushKey() {
  return vapidPublicKey;
}

export function normalizePushSubscription(value: unknown): WebPushSubscriptionRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<WebPushSubscriptionRecord>;
  const keys = record.keys as Partial<WebPushSubscriptionRecord["keys"]> | undefined;
  if (
    typeof record.endpoint !== "string" ||
    !record.endpoint.startsWith("https://") ||
    record.endpoint.length > 2000 ||
    !keys ||
    typeof keys.auth !== "string" ||
    typeof keys.p256dh !== "string" ||
    keys.auth.length > 500 ||
    keys.p256dh.length > 500
  ) {
    return undefined;
  }

  return {
    endpoint: record.endpoint,
    expirationTime: typeof record.expirationTime === "number" ? record.expirationTime : null,
    keys: {
      auth: keys.auth,
      p256dh: keys.p256dh,
    },
  };
}

export async function sendReconnectWakePush(pairing: PairingRecord, requestId: string) {
  if (!hasWebPushConfig()) {
    console.info("[scanner-signal] Reconnect wake push skipped: VAPID is not configured", {
      pairingId: pairing.id,
      requestId,
    });
    return;
  }
  if (!pairing.pushSubscription) {
    console.info("[scanner-signal] Reconnect wake push skipped: pairing has no push subscription", {
      pairingId: pairing.id,
      requestId,
      browserSessionId: pairing.browserSessionId,
    });
    return;
  }

  try {
    webPush.setVapidDetails(vapidSubject, vapidPublicKey!, vapidPrivateKey!);
    await webPush.sendNotification(
      pairing.pushSubscription,
      JSON.stringify({
        type: "scanner_reconnect_requested",
        pairingId: pairing.id,
        requestId,
        browserSessionId: pairing.browserSessionId,
      }),
      { TTL: Math.ceil(SCANNER_RECONNECT_REQUEST_TTL_MS / 1000) }
    );
    console.info("[scanner-signal] Reconnect wake push sent", {
      pairingId: pairing.id,
      requestId,
      browserSessionId: pairing.browserSessionId,
    });
  } catch (error) {
    console.warn("[scanner-signal] Failed to send reconnect wake push", error);
  }
}
