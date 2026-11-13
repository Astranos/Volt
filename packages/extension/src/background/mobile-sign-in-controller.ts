import { isTrustedExtensionPageSender, type ExtensionMessageSender } from "../access/sender-policy";

// iPhone QR sign-in: the phone asks by email, every signed-in Chrome for that
// account gets a notification, and only the computer the user clicks opens a
// QR window. Notifications on the other computers clear once the request
// closes (scanned, dismissed or expired).
export const MOBILE_SIGN_IN_NOTIFICATION_PREFIX = "volt.mobileSignIn:";
export const MOBILE_SIGN_IN_POPUP_PATH = "/mobile-sign-in-popup.html";
const SHOWN_KEY = "volt.mobileSignIn.shownRequestIds";

export type MobileSignInRequest = { requestId: string; expiresAt: number; mfaRequired: boolean };

type ControllerOptions = {
  chromeApi: typeof chrome;
  sendOffscreenMessage: (message: unknown) => Promise<unknown>;
  log?: (...args: unknown[]) => void;
  now?: () => number;
};

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseSignInRequests(value: unknown, now: number): MobileSignInRequest[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = recordFrom(item);
    const requestId = typeof record?.requestId === "string" && record.requestId.length <= 64 ? record.requestId : null;
    const expiresAt = typeof record?.expiresAt === "number" && Number.isFinite(record.expiresAt) ? record.expiresAt : null;
    if (!requestId || expiresAt === null || expiresAt <= now) return [];
    return [{ requestId, expiresAt, mfaRequired: record?.mfaRequired === true }];
  });
}

export function createMobileSignInController(options: ControllerOptions) {
  const { chromeApi } = options;
  const log = options.log ?? ((...args: unknown[]) => console.warn("[Volt Mobile Sign-in]", ...args));
  const now = options.now ?? Date.now;
  let updating: Promise<void> = Promise.resolve();

  async function shownRequestIds(): Promise<string[]> {
    try {
      const stored = await chromeApi.storage.session.get(SHOWN_KEY);
      const value = stored[SHOWN_KEY];
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  }

  async function applyRequests(rawRequests: unknown) {
    const requests = parseSignInRequests(rawRequests, now());
    const live = new Set(requests.map((request) => request.requestId));
    const shown = await shownRequestIds();
    for (const requestId of shown) {
      if (live.has(requestId)) continue;
      await chromeApi.notifications.clear(`${MOBILE_SIGN_IN_NOTIFICATION_PREFIX}${requestId}`).catch(() => false);
      // Tell an open QR window that its request is finished.
      void chromeApi.runtime.sendMessage({ action: "mobileSignInRequestClosed", requestId }).catch(() => undefined);
    }
    const shownSet = new Set(shown);
    for (const request of requests) {
      // Shown once per request, so dismissing the notification sticks.
      if (shownSet.has(request.requestId)) continue;
      await chromeApi.notifications.create(`${MOBILE_SIGN_IN_NOTIFICATION_PREFIX}${request.requestId}`, {
        type: "basic",
        iconUrl: chromeApi.runtime.getURL("/assets/icons/logo-128.png"),
        title: "Sign in to Volt on your iPhone?",
        message: request.mfaRequired
          ? "Your account uses two-step verification. Click for details."
          : "Your iPhone asked to sign in. Click to show a QR code to scan.",
        priority: 2,
        requireInteraction: true,
      }).catch((error: unknown) => log("notification failed", error instanceof Error ? error.message : error));
    }
    await chromeApi.storage.session.set({ [SHOWN_KEY]: [...live] }).catch(() => undefined);
  }

  function handleRequests(rawRequests: unknown) {
    // Serialized so two quick updates cannot both create the same notification.
    updating = updating.then(() => applyRequests(rawRequests)).catch((error: unknown) => {
      log("request update failed", error instanceof Error ? error.message : error);
    });
    return updating;
  }

  async function handleNotificationClicked(notificationId: string) {
    if (!notificationId.startsWith(MOBILE_SIGN_IN_NOTIFICATION_PREFIX)) return false;
    const requestId = notificationId.slice(MOBILE_SIGN_IN_NOTIFICATION_PREFIX.length);
    await chromeApi.notifications.clear(notificationId).catch(() => false);
    const url = new URL(chromeApi.runtime.getURL(MOBILE_SIGN_IN_POPUP_PATH));
    url.searchParams.set("requestId", requestId);
    await chromeApi.windows.create({ url: url.toString(), type: "popup", width: 360, height: 500, focused: true });
    return true;
  }

  async function relay(action: string, requestId: string) {
    const response = recordFrom(await options.sendOffscreenMessage({ action, requestId }));
    if (response?.success !== true) {
      throw new Error(typeof response?.error === "string" ? response.error : "Sign-in request failed.");
    }
    return response.value;
  }

  function handleMessage(
    rawMessage: unknown,
    sender: ExtensionMessageSender,
    sendResponse: (response?: unknown) => void,
  ) {
    const record = recordFrom(rawMessage);
    if (record?.action !== "mobileSignInIssueQr" && record?.action !== "mobileSignInDismiss") return false;
    if (!isTrustedExtensionPageSender(sender, chromeApi.runtime.id, [MOBILE_SIGN_IN_POPUP_PATH])) {
      sendResponse({ success: false, error: "unauthorized_extension_sender" });
      return true;
    }
    const requestId = typeof record.requestId === "string" ? record.requestId.slice(0, 64) : "";
    if (!requestId) {
      sendResponse({ success: false, error: "invalid_sign_in_request" });
      return true;
    }
    const operation = record.action === "mobileSignInIssueQr"
      ? relay("workspaceOffscreenIssueMobileSignInQr", requestId)
      : relay("workspaceOffscreenDismissMobileSignIn", requestId);
    void operation
      .then((value) => sendResponse({ success: true, value }))
      .catch((error: unknown) => sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    return true;
  }

  return { handleRequests, handleNotificationClicked, handleMessage };
}
