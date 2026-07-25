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

// A cold offscreen document has to fetch and evaluate its whole module graph
// before it can answer. 10 x 150ms only covered a warm start, so an ordinary
// slow load looked like a broken document and got one torn down. The backoff
// keeps the common case fast and still waits ~8s before giving up.
type EnsureResult = { ok: true } | { ok: false; reason: string };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const PING_ATTEMPTS = 12;
const PING_RETRY_DELAY_MS = 100;
const PING_MAX_RETRY_DELAY_MS = 1_000;

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
  let ensurePromise: Promise<EnsureResult> | null = null;

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // A freshly created offscreen document has no message listener until its
  // module finishes evaluating, so a single missed ping means "not ready yet",
  // not "broken". Treating the two as the same tore the document down while it
  // was still starting.
  async function pingScannerOffscreen(attempts = 1) {
    let lastError: unknown = null;
    let lastResponse: unknown = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await chromeApi.runtime.sendMessage({
          action: "scannerOffscreenPing",
        });
        if (response?.ready === true) return { ready: true as const };
        lastResponse = response;
      } catch (error) {
        // No listener yet; fall through to the retry delay.
        lastError = error;
      }
      if (attempt + 1 < attempts) {
        await delay(
          Math.min(PING_RETRY_DELAY_MS * 2 ** attempt, PING_MAX_RETRY_DELAY_MS),
        );
      }
    }
    // Which of these it is matters: an error every time means the document has
    // no listener at all (still loading, or its module threw), while a reply
    // that is not `ready` means something else in the extension answered first.
    return {
      ready: false as const,
      detail: lastError
        ? `no listener (${errorMessage(lastError)})`
        : `unexpected ping reply (${JSON.stringify(lastResponse) ?? "undefined"})`,
    };
  }

  async function ensureScannerOffscreenDocumentOnce(): Promise<EnsureResult> {
    const offscreenCreated = await createOffscreenDocument();
    if (!offscreenCreated) return { ok: false, reason: "offscreen.createDocument failed" };

    const firstPing = await pingScannerOffscreen(PING_ATTEMPTS);
    if (firstPing.ready) return { ok: true };

    const existingContexts = await getOffscreenContexts();
    if (existingContexts.length > 0) {
      try {
        await chromeApi.offscreen.closeDocument();
      } catch (error) {
        return {
          ok: false,
          reason: `unresponsive document could not be closed: ${errorMessage(error)}`,
        };
      }
    }

    const recreated = await createOffscreenDocument();
    if (!recreated) {
      return { ok: false, reason: "offscreen.createDocument failed after close" };
    }
    const secondPing = await pingScannerOffscreen(PING_ATTEMPTS);
    if (secondPing.ready) return { ok: true };
    return {
      ok: false,
      reason: `document never became ready — ${secondPing.detail}; contexts before recreate: ${existingContexts.length}`,
    };
  }

  // Callers race at startup and again on every 1-minute alarm. Without a single
  // flight, one caller could close the document another had just created and
  // was about to message, which stranded the cloud workspace with no error.
  async function ensureScannerOffscreenDocumentDetailed() {
    if (ensurePromise) return ensurePromise;
    ensurePromise = ensureScannerOffscreenDocumentOnce()
      .then((result) => {
        if (!result.ok) log("Scanner offscreen document not ready:", result.reason);
        return result;
      })
      .finally(() => {
        ensurePromise = null;
      });
    return ensurePromise;
  }

  async function ensureScannerOffscreenDocument() {
    return (await ensureScannerOffscreenDocumentDetailed()).ok;
  }

  async function sendScannerOffscreenMessage<TResponse = unknown>(message: unknown): Promise<TResponse> {
    const ensured = await ensureScannerOffscreenDocumentDetailed();
    if (!ensured.ok) {
      // Callers only ever log this string, so it has to carry the reason or the
      // failure is indistinguishable from every other way this can go wrong.
      throw new Error(`Failed to initialize scanner offscreen document: ${ensured.reason}`);
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
