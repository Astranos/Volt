import {
  SCANNER_RESULT_POLL_INTERVAL_MS,
  SCANNER_SESSION_TTL_MS,
  SCANNER_SIGNAL_URL,
  createScannerMessageDuplicateGuard,
  decodeScannerTransportMessage,
  isAppClipCaptureMode,
  isCaptureMode,
  type CaptureMode,
  type PhotoChunkStartMessage,
  type PhotoMessage,
  type ScannerConnectionStatus,
  type ScannerRelayResult,
  type SessionTarget,
} from "../../../scanner-protocol/src";

const SCANNER_APP_CLIP_BASE_URL = SCANNER_SIGNAL_URL.replace("/api/signal", "/clip");
const SCANNER_RESULT_TIMEOUT_MS = SCANNER_SESSION_TTL_MS;
const SCANNER_RELAY_STATE_STORAGE_KEY = "volt.mobileScanner.relaySession.v1";

type ScannerState = {
  status: ScannerConnectionStatus;
  qrCodeUrl: string | null;
  error: string | null;
  mode: CaptureMode | null;
};

type PendingPhoto = PhotoChunkStartMessage & {
  chunks: string[];
  receivedChunks: number;
  updatedAt: number;
};

type PersistedRelayState = {
  sessionId: string;
  browserClaim?: string;
  qrCodeUrl: string;
  status: "waiting" | "connected";
  error: null;
  mode: CaptureMode | null;
  seenResultIds: string[];
  createdAt: number;
  connectedAt?: string | null;
};

class MobileScannerOffscreenSession {
  private resultPoll: number | null = null;
  private resultPollTimeout: number | null = null;
  private sessionId: string | null = null;
  private browserClaim: string | null = null;
  private shouldAcceptScannerMessage = createScannerMessageDuplicateGuard();
  private pendingPhotos = new Map<string, PendingPhoto>();
  private seenRelayResultIds = new Set<string>();
  private restorePromise: Promise<void> | null = null;
  private state: ScannerState = {
    status: "disconnected",
    qrCodeUrl: null,
    error: null,
    mode: null,
  };

  constructor() {
    this.restorePromise = this.restorePersistedSession();
  }

  async getState() {
    await this.restorePromise;
    return { ...this.state };
  }

  private setState(patch: Partial<ScannerState>) {
    this.state = { ...this.state, ...patch };
    void chrome.runtime.sendMessage({
      action: "scannerStateChanged",
      source: "scanner-offscreen",
      state: { ...this.state },
    });
    void this.persistActiveSession().catch(() => {});
  }

  async start(force = false, mode: CaptureMode | null = null, target?: SessionTarget | null) {
    await this.restorePromise;
    if (
      !force &&
      (this.state.status === "creating" ||
        this.state.status === "waiting" ||
        this.state.status === "connected")
    ) {
      if (this.sessionId && mode && mode !== this.state.mode) {
        this.setState({
          mode,
          qrCodeUrl: this.buildPairingUrl(this.sessionId, mode),
          error: null,
        });
        if (target) await this.updateTarget(target);
      }
      return { ...this.state };
    }

    await this.clearPersistedSession();
    this.cleanup(true);
    this.setState({ status: "creating", error: null, qrCodeUrl: null, mode: null });

    try {
      const sessionId = await this.createRelaySession(mode, target);
      this.sessionId = sessionId;
      this.setState({
        status: "waiting",
        qrCodeUrl: this.buildPairingUrl(sessionId, mode),
        error: null,
        mode,
      });
      this.pollForResult(sessionId);
    } catch (err) {
      this.setState({
        status: "error",
        error: err instanceof Error ? err.message : "Failed to start session",
      });
    }

    return { ...this.state };
  }

  async disconnect() {
    await this.restorePromise;
    this.sessionId = null;
    this.browserClaim = null;
    this.cleanup(true);
    this.seenRelayResultIds.clear();
    await this.clearPersistedSession();
    this.setState({ status: "disconnected", qrCodeUrl: null, error: null, mode: null });
    return { ...this.state };
  }

  async updateTarget(target?: SessionTarget | null) {
    await this.restorePromise;
    if (!this.sessionId || !target) return this.getState();
    try {
      await fetch(`${SCANNER_SIGNAL_URL}/${encodeURIComponent(this.sessionId)}/target`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
    } catch (error) {
      console.warn("Failed to update App Clip target", error);
    }
    return this.getState();
  }

  private async restorePersistedSession() {
    try {
      const persisted = await this.getPersistedRelayState();
      if (
        !persisted ||
        typeof persisted.sessionId !== "string" ||
        !persisted.sessionId ||
        typeof persisted.createdAt !== "number" ||
        Date.now() - persisted.createdAt >= SCANNER_RESULT_TIMEOUT_MS
      ) {
        await this.clearPersistedSession();
        return;
      }

      this.sessionId = persisted.sessionId;
      this.browserClaim = typeof persisted.browserClaim === "string" ? persisted.browserClaim : null;
      this.seenRelayResultIds = new Set(
        Array.isArray(persisted.seenResultIds) ? persisted.seenResultIds.filter((id) => typeof id === "string") : [],
      );
      this.state = {
        status: persisted.connectedAt || persisted.status === "connected" ? "connected" : "waiting",
        qrCodeUrl: persisted.qrCodeUrl || this.buildPairingUrl(persisted.sessionId, persisted.mode ?? null),
        error: null,
        mode: persisted.mode ?? null,
      };
      this.pollForResult(persisted.sessionId, persisted.createdAt);
    } catch (_error) {
      await this.clearPersistedSession();
    }
  }

  private async persistActiveSession() {
    if (!this.sessionId || (this.state.status !== "waiting" && this.state.status !== "connected")) return;
    const previous = await this.getPersistedRelayState();
    const persisted: PersistedRelayState = {
      sessionId: this.sessionId,
      browserClaim: this.browserClaim ?? undefined,
      qrCodeUrl: this.state.qrCodeUrl || this.buildPairingUrl(this.sessionId, this.state.mode),
      status: this.state.status,
      error: null,
      mode: this.state.mode,
      seenResultIds: Array.from(this.seenRelayResultIds).slice(-200),
      createdAt:
        previous?.sessionId === this.sessionId && typeof previous.createdAt === "number"
          ? previous.createdAt
          : Date.now(),
      connectedAt: previous?.sessionId === this.sessionId ? previous.connectedAt ?? null : null,
    };
    await this.setPersistedRelayState(persisted);
  }

  private async markPersistedConnected(connectedAt: string | null) {
    const previous = await this.getPersistedRelayState();
    if (!previous || previous.sessionId !== this.sessionId) return;
    await this.setPersistedRelayState({
      ...previous,
      status: "connected",
      connectedAt,
    });
  }

  private async clearPersistedSession() {
    await chrome.runtime.sendMessage({
      action: "scannerRelayStateRemove",
      key: SCANNER_RELAY_STATE_STORAGE_KEY,
    });
  }

  private async getPersistedRelayState() {
    const response = await chrome.runtime.sendMessage({
      action: "scannerRelayStateGet",
      key: SCANNER_RELAY_STATE_STORAGE_KEY,
    });
    return response?.state as PersistedRelayState | undefined;
  }

  private async setPersistedRelayState(state: PersistedRelayState) {
    await chrome.runtime.sendMessage({
      action: "scannerRelayStateSet",
      key: SCANNER_RELAY_STATE_STORAGE_KEY,
      state,
    });
  }

  private buildPairingUrl(sessionId: string, mode: CaptureMode | null = null) {
    const encodedSession = encodeURIComponent(sessionId);
    return mode && isAppClipCaptureMode(mode)
      ? `${SCANNER_APP_CLIP_BASE_URL}/${encodeURIComponent(mode)}?session=${encodedSession}`
      : `${SCANNER_APP_CLIP_BASE_URL}?session=${encodedSession}`;
  }

  private cleanup(_intentional = true) {
    if (this.resultPoll) {
      window.clearInterval(this.resultPoll);
      this.resultPoll = null;
    }
    if (this.resultPollTimeout) {
      window.clearTimeout(this.resultPollTimeout);
      this.resultPollTimeout = null;
    }
  }

  private async handleDataChannelMessage(rawData: string) {
    const data = decodeScannerTransportMessage(rawData);
    if (!data) return false;

    if (data.kind === "photo") {
      return this.sendPhoto(data);
    }

    if (data.kind === "photo-chunk-start") {
      this.cleanupStalePhotos();
      this.pendingPhotos.set(data.id, {
        ...data,
        chunks: Array.from({ length: data.totalChunks }),
        receivedChunks: 0,
        updatedAt: Date.now(),
      });
      return false;
    }

    if (data.kind === "photo-chunk") {
      const pending = this.pendingPhotos.get(data.id);
      if (!pending || data.index < 0 || data.index >= pending.totalChunks) return false;
      if (!pending.chunks[data.index]) pending.receivedChunks += 1;
      pending.chunks[data.index] = data.data;
      pending.updatedAt = Date.now();
      return false;
    }

    if (data.kind === "photo-chunk-end") {
      const pending = this.pendingPhotos.get(data.id);
      if (!pending || pending.receivedChunks !== pending.totalChunks) return false;
      this.pendingPhotos.delete(data.id);
      const { chunks, receivedChunks, totalChunks, updatedAt, kind, ...photo } = pending;
      return this.sendPhoto({
        ...photo,
        kind: "photo",
        dataUrl: `data:${pending.mimeType};base64,${chunks.join("")}`,
      });
    }

    if (data.format !== "dictation" && !this.shouldAcceptScannerMessage(data)) return false;
    void chrome.runtime.sendMessage({
      action: "scannerOffscreenScan",
      scan: {
        ...data,
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        scannedAt: data.scannedAt || new Date().toISOString(),
      },
    });
    return true;
  }

  private async sendPhoto(photo: PhotoMessage) {
    const response = await chrome.runtime.sendMessage({
      action: "scannerOffscreenPhoto",
      photo: {
        ...photo,
        capturedAt: photo.capturedAt || new Date().toISOString(),
        sessionId: this.sessionId ?? undefined,
      },
    });
    return response?.success === true;
  }

  private async acknowledgeRelayResults(sessionId: string, ids: string[]) {
    if (ids.length === 0) return;
    try {
      await fetch(`${SCANNER_SIGNAL_URL}/${sessionId}/result/ack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
    } catch (error) {
      console.warn("Failed to acknowledge App Clip relay results", error);
    }
  }

  private cleanupStalePhotos() {
    const staleBefore = Date.now() - 2 * 60 * 1000;
    for (const [id, pending] of this.pendingPhotos) {
      if (pending.updatedAt < staleBefore) this.pendingPhotos.delete(id);
    }
  }

  private async createRelaySession(mode: CaptureMode | null, target?: SessionTarget | null) {
    const browserClaim = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    const sessionResponse = await fetch(SCANNER_SIGNAL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mode ? { relay: true, mode, target, browserClaim } : { relay: true, target, browserClaim }),
    });

    if (!sessionResponse.ok) {
      let details = "";
      try {
        const payload = await sessionResponse.json();
        details =
          typeof payload?.error === "string" && payload.error
            ? `: ${payload.error}`
            : "";
      } catch (_error) {}
      throw new Error(
        `Failed to create App Clip session (${sessionResponse.status})${details}`
      );
    }

    const { sessionId, browserClaim: storedBrowserClaim } = await sessionResponse.json();
    if (typeof sessionId !== "string" || !sessionId) {
      throw new Error("Invalid App Clip session");
    }
    this.browserClaim = typeof storedBrowserClaim === "string" && storedBrowserClaim ? storedBrowserClaim : browserClaim;
    return sessionId;
  }

  private async fetchPhotoManifest(sessionId: string) {
    if (!this.browserClaim) return [];
    const response = await fetch(`${SCANNER_SIGNAL_URL}/${sessionId}/photo/manifest`, {
      headers: { "X-Volt-Browser-Claim": this.browserClaim },
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { photos?: PhotoMessage[] };
    return Array.isArray(payload.photos) ? payload.photos : [];
  }

  private async acknowledgePhotos(sessionId: string, ids: string[]) {
    if (!this.browserClaim || ids.length === 0) return;
    await fetch(`${SCANNER_SIGNAL_URL}/${sessionId}/photo/ack`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Volt-Browser-Claim": this.browserClaim },
      body: JSON.stringify({ ids }),
    });
  }

  private async recordPhotoFailure(sessionId: string, id: string, error: string) {
    if (!this.browserClaim) return;
    await fetch(`${SCANNER_SIGNAL_URL}/${sessionId}/photo/failure`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Volt-Browser-Claim": this.browserClaim },
      body: JSON.stringify({ id, error }),
    });
  }

  private pollForResult(sessionId: string, createdAt = Date.now()) {
    if (this.resultPoll) {
      window.clearInterval(this.resultPoll);
      this.resultPoll = null;
    }
    if (this.resultPollTimeout) {
      window.clearTimeout(this.resultPollTimeout);
    }

    const timeoutDelay = Math.max(0, SCANNER_RESULT_TIMEOUT_MS - (Date.now() - createdAt));
    this.resultPollTimeout = window.setTimeout(() => {
      if (this.sessionId !== sessionId) return;
      if (this.resultPoll) {
        window.clearInterval(this.resultPoll);
        this.resultPoll = null;
      }
      this.resultPollTimeout = null;
      void this.clearPersistedSession();
      this.setState({
        status: "error",
        qrCodeUrl: null,
        error: "App Clip session timed out. Start a new scan and use the latest QR code.",
      });
    }, timeoutDelay);

    this.resultPoll = window.setInterval(async () => {
      try {
        if (this.sessionId !== sessionId) {
          if (this.resultPoll) {
            window.clearInterval(this.resultPoll);
            this.resultPoll = null;
          }
          return;
        }

        const sessionResponse = await fetch(`${SCANNER_SIGNAL_URL}/${sessionId}`);
        if (sessionResponse.ok) {
          const sessionPayload = (await sessionResponse.json()) as { connectedAt?: string | null };
          if (sessionPayload.connectedAt && this.state.status === "waiting") {
            this.setState({ status: "connected", error: null });
            void this.markPersistedConnected(sessionPayload.connectedAt).catch(() => {});
          }
        }

        const resultResponse = await fetch(`${SCANNER_SIGNAL_URL}/${sessionId}/result`);
        let inferredMode: CaptureMode | null = null;
        const photoAckIds: string[] = [];
        if (resultResponse.ok) {
          const payload = (await resultResponse.json()) as {
            result?: ScannerRelayResult | null;
            results?: ScannerRelayResult[];
          };
          const results = Array.isArray(payload.results) ? payload.results : payload.result ? [payload.result] : [];
          const unseenResults = results.filter((result) => result?.id && !this.seenRelayResultIds.has(result.id));

          for (const result of unseenResults) {
            this.seenRelayResultIds.add(result.id);
            if (isCaptureMode(result.mode)) {
              inferredMode = result.mode;
            }
            if (result.message) {
              const stored = await this.handleDataChannelMessage(JSON.stringify(result.message));
              if (stored && result.mode === "photo") photoAckIds.push(result.id);
            }
          }
          await this.acknowledgeRelayResults(sessionId, photoAckIds);
        }

        const manifestPhotos = await this.fetchPhotoManifest(sessionId);
        const unseenPhotos = manifestPhotos.filter(
          (photo) =>
            photo?.id &&
            photo.status !== "browser_received" &&
            !this.seenRelayResultIds.has(`photo:${photo.id}`)
        );
        const acknowledgedPhotoIds: string[] = [];
        for (const photo of unseenPhotos) {
          const stored = await this.sendPhoto({ ...photo, kind: "photo" });
          if (stored) {
            this.seenRelayResultIds.add(`photo:${photo.id}`);
            acknowledgedPhotoIds.push(photo.id);
          } else {
            await this.recordPhotoFailure(sessionId, photo.id, "download_failed");
          }
        }
        await this.acknowledgePhotos(sessionId, acknowledgedPhotoIds);

        const patch: Partial<ScannerState> = { status: "connected", error: null };
        if (inferredMode && inferredMode !== this.state.mode) {
          patch.mode = inferredMode;
        }
        this.setState(patch);
        void this.persistActiveSession().catch(() => {});
      } catch (err) {
        console.error("Failed to poll scanner result", err);
      }
    }, SCANNER_RESULT_POLL_INTERVAL_MS);
  }
}

const mobileScannerSession = new MobileScannerOffscreenSession();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "scannerOffscreenPing") {
    sendResponse({ ready: true });
    return false;
  }

  if (message.action === "scannerOffscreenStart") {
    mobileScannerSession
      .start(
        message.force === true,
        message.mode === "ocr" || message.mode === "barcode" || message.mode === "dictation" || message.mode === "photo"
          ? message.mode
          : null,
        message.target && typeof message.target === "object" ? message.target : null
      )
      .then((state) => sendResponse(state))
      .catch((err) =>
        sendResponse({
          status: "error",
          qrCodeUrl: null,
          error: err instanceof Error ? err.message : String(err),
          mode: null,
        })
      );
    return true;
  }

  if (message.action === "scannerOffscreenDisconnect") {
    mobileScannerSession
      .disconnect()
      .then((state) => sendResponse(state))
      .catch((err) =>
        sendResponse({
          status: "error",
          qrCodeUrl: null,
          error: err instanceof Error ? err.message : String(err),
          mode: null,
        })
      );
    return true;
  }

  if (message.action === "scannerOffscreenUpdateTarget") {
    mobileScannerSession
      .updateTarget(message.target && typeof message.target === "object" ? message.target : null)
      .then((state) => sendResponse(state))
      .catch((err) =>
        sendResponse({
          status: "error",
          qrCodeUrl: null,
          error: err instanceof Error ? err.message : String(err),
          mode: null,
        })
      );
    return true;
  }

  if (message.action === "scannerOffscreenGetState") {
    mobileScannerSession
      .getState()
      .then((state) => sendResponse(state))
      .catch((err) =>
        sendResponse({
          status: "error",
          qrCodeUrl: null,
          error: err instanceof Error ? err.message : String(err),
          mode: null,
        })
      );
    return true;
  }

  if (message.action === "checkGamepads") {
    try {
      const gamepads = navigator.getGamepads?.() || [];
      let connectedCount = 0;
      let controllerInfo = null;

      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) {
          connectedCount++;
          if (!controllerInfo) {
            controllerInfo = {
              index: i,
              id: gamepads[i]?.id,
              mapping: gamepads[i]?.mapping,
            };
          }
        }
      }

      sendResponse({
        success: true,
        data: {
          connectedCount,
          controllerInfo,
        },
      });
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return false;
  }

  if (message.action === "copyToClipboard") {
    try {
      const text = message.text;
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);
      if (!successful) {
        navigator.clipboard
          .writeText(text)
          .then(() => sendResponse({ success: true }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;
      }
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return false;
  }

  if (message.action === "readFromClipboard") {
    try {
      const textArea = document.createElement("textarea");
      document.body.appendChild(textArea);
      textArea.focus();
      const successful = document.execCommand("paste");
      const text = textArea.value;
      document.body.removeChild(textArea);
      if (!successful && !text) {
        navigator.clipboard
          .readText()
          .then((clipboardText) => sendResponse({ success: true, text: clipboardText }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;
      }
      sendResponse({ success: true, text });
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return false;
  }

  return false;
});

window.addEventListener("gamepadconnected", (event) => {
  void chrome.runtime.sendMessage({
    action: "gamepadConnected",
    gamepad: {
      index: event.gamepad.index,
      id: event.gamepad.id,
      mapping: event.gamepad.mapping,
    },
  });
});

window.addEventListener("gamepaddisconnected", (event) => {
  void chrome.runtime.sendMessage({
    action: "gamepadDisconnected",
    gamepad: {
      index: event.gamepad.index,
      id: event.gamepad.id,
    },
  });
});
