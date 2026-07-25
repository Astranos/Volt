type LogFn = (...args: unknown[]) => void;

type OffscreenContext = {
  documentUrl?: string;
};

type ScannerPushEvent = Event & {
  data?: {
    json?: () => unknown;
  };
  waitUntil: (promise: Promise<unknown>) => void;
};

type ScannerOffscreenControllerOptions = {
  chromeApi: typeof chrome;
  log: LogFn;
  createOffscreenDocument: () => Promise<boolean>;
  getOffscreenContexts: () => Promise<OffscreenContext[]>;
  signalUrl: string;
  reconnectAlarmName: string;
};

const PING_ATTEMPTS = 10;
const PING_RETRY_DELAY_MS = 150;

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

export function createScannerOffscreenController({
  chromeApi,
  log,
  createOffscreenDocument,
  getOffscreenContexts,
  signalUrl,
  reconnectAlarmName,
}: ScannerOffscreenControllerOptions) {
  let pushSubscriptionPromise: Promise<PushSubscriptionJSON | null> | null = null;
  let ensurePromise: Promise<boolean> | null = null;

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // A freshly created offscreen document has no message listener until its
  // module finishes evaluating, so a single missed ping means "not ready yet",
  // not "broken". Treating the two as the same tore the document down while it
  // was still starting.
  async function pingScannerOffscreen(attempts = 1) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await chromeApi.runtime.sendMessage({
          action: "scannerOffscreenPing",
        });
        if (response?.ready === true) return true;
      } catch (_) {
        // No listener yet; fall through to the retry delay.
      }
      if (attempt + 1 < attempts) await delay(PING_RETRY_DELAY_MS);
    }
    return false;
  }

  async function ensureScannerOffscreenDocumentOnce() {
    const offscreenCreated = await createOffscreenDocument();
    if (!offscreenCreated) return false;

    if (await pingScannerOffscreen(PING_ATTEMPTS)) return true;

    const existingContexts = await getOffscreenContexts();
    if (existingContexts.length > 0) {
      try {
        await chromeApi.offscreen.closeDocument();
      } catch (error) {
        log("Failed to close stale offscreen document", error instanceof Error ? error.message : error);
        return false;
      }
    }

    const recreated = await createOffscreenDocument();
    if (!recreated) return false;
    return pingScannerOffscreen(PING_ATTEMPTS);
  }

  // Callers race at startup and again on every 1-minute alarm. Without a single
  // flight, one caller could close the document another had just created and
  // was about to message, which stranded the cloud workspace with no error.
  async function ensureScannerOffscreenDocument() {
    if (ensurePromise) return ensurePromise;
    ensurePromise = ensureScannerOffscreenDocumentOnce().finally(() => {
      ensurePromise = null;
    });
    return ensurePromise;
  }

  async function sendScannerOffscreenMessage<TResponse = unknown>(message: unknown): Promise<TResponse> {
    const offscreenReady = await ensureScannerOffscreenDocument();
    if (!offscreenReady) {
      throw new Error("Failed to initialize scanner offscreen document");
    }
    return chromeApi.runtime.sendMessage(message);
  }

  function bootstrapScannerReconnectListener(reason = "startup") {
    void ensureScannerOffscreenDocument().catch((error) => {
      log(
        "Failed to bootstrap scanner reconnect listener",
        reason,
        error instanceof Error ? error.message : error
      );
    });
  }

  async function pollScannerReconnectRequests(reason = "startup") {
    log("[Volt Scanner Reconnect] poll requested", { reason });
    const offscreenReady = await ensureScannerOffscreenDocument();
    if (!offscreenReady) {
      log("[Volt Scanner Reconnect] offscreen not ready", { reason });
      return false;
    }

    try {
      const response = await chromeApi.runtime.sendMessage({
        action: "scannerOffscreenPollReconnectRequests",
        reason,
      });
      log("[Volt Scanner Reconnect] poll completed", {
        reason,
        status: response?.status,
        error: response?.error,
        sessionId: response?.sessionId,
        connectedPeerCount: response?.connectedPeerCount,
      });
      return response?.status !== "error";
    } catch (error) {
      log("Failed to poll scanner reconnect requests", reason, error instanceof Error ? error.message : error);
      return false;
    }
  }

  function ensureScannerReconnectAlarm() {
    try {
      chromeApi.alarms?.create?.(reconnectAlarmName, {
        delayInMinutes: 1,
        periodInMinutes: 1,
      });
    } catch (error) {
      log("Failed to create scanner reconnect alarm", error instanceof Error ? error.message : error);
    }
  }

  async function getScannerPushSubscription() {
    if (pushSubscriptionPromise) return pushSubscriptionPromise;

    pushSubscriptionPromise = getScannerPushSubscriptionOnce().finally(() => {
      pushSubscriptionPromise = null;
    });
    return pushSubscriptionPromise;
  }

  async function getScannerPushSubscriptionOnce(): Promise<PushSubscriptionJSON | null> {
    try {
      const pushManager = (globalThis as unknown as { registration?: ServiceWorkerRegistration }).registration
        ?.pushManager;
      if (!pushManager) return null;

      const existing = await pushManager.getSubscription();
      if (existing) return existing.toJSON();

      const keyResponse = await fetch(`${signalUrl}/push/public-key`);
      if (!keyResponse.ok) return null;
      const keyPayload = await keyResponse.json();
      const publicKey =
        typeof keyPayload?.publicKey === "string" ? keyPayload.publicKey : "";
      if (!publicKey) return null;

      const subscription = await pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(publicKey),
      });
      return subscription.toJSON();
    } catch (error) {
      log("Failed to create scanner push subscription", error instanceof Error ? error.message : error);
      return null;
    }
  }

  function handlePushEvent(event: ScannerPushEvent) {
    let payload = null;
    try {
      payload = event.data?.json?.() ?? null;
    } catch (_error) {}
    log("[Volt Scanner Reconnect] push event received", { payload });
    event.waitUntil(pollScannerReconnectRequests("push"));
  }

  return {
    alarmName: reconnectAlarmName,
    bootstrapScannerReconnectListener,
    ensureScannerOffscreenDocument,
    ensureScannerReconnectAlarm,
    getScannerPushSubscription,
    handlePushEvent,
    pollScannerReconnectRequests,
    sendScannerOffscreenMessage,
  };
}
