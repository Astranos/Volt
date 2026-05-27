const SCANNER_SIGNAL_URL = "https://scanner-signal.vercel.app/api/signal";
const SCANNER_APP_CLIP_BASE_URL = "https://scanner-signal.vercel.app/clip";
const SCANNER_RESULT_POLL_INTERVAL_MS = 500;
const SCANNER_RESULT_TIMEOUT_MS = 30 * 60 * 1000;
const SCANNER_RELAY_STATE_STORAGE_KEY = "volt.mobileScanner.relaySession.v1";

type ScannerState = {
  status: "disconnected" | "creating" | "waiting" | "connected" | "error";
  qrCodeUrl: string | null;
  error: string | null;
  mode: MobileCaptureMode | null;
};

type MobileCaptureMode = "ocr" | "barcode" | "dictation" | "photo";

type SessionTarget = {
  browser?: string;
  tabTitle?: string;
  url?: string;
  cursor?: string;
};

type BarcodeMessage = {
  barcode: string;
  dictationPhase?: "partial" | "final";
  dictationSessionId?: string;
  format?: string;
  insertIntoCursor?: boolean;
  kind?: "barcode" | "text";
  scannedAt?: string;
};

type PhotoMessage = {
  kind: "photo";
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  size: number;
  width?: number;
  height?: number;
  capturedAt?: string;
};

type PhotoChunkStartMessage = Omit<PhotoMessage, "kind" | "dataUrl"> & {
  kind: "photo-chunk-start";
  totalChunks: number;
};

type PhotoChunkMessage = {
  kind: "photo-chunk";
  id: string;
  index: number;
  data: string;
};

type PhotoChunkEndMessage = {
  kind: "photo-chunk-end";
  id: string;
};

type ScannerTransportMessage =
  | BarcodeMessage
  | PhotoMessage
  | PhotoChunkStartMessage
  | PhotoChunkMessage
  | PhotoChunkEndMessage;

type PendingPhoto = PhotoChunkStartMessage & {
  chunks: string[];
  receivedChunks: number;
  updatedAt: number;
};

type ScannerRelayResult = {
  id: string;
  mode: MobileCaptureMode;
  message: ScannerTransportMessage;
  createdAt: string;
};

type PersistedRelayState = {
  sessionId: string;
  qrCodeUrl: string;
  status: "waiting" | "connected";
  error: null;
  mode: MobileCaptureMode | null;
  seenResultIds: string[];
  createdAt: number;
  connectedAt?: string | null;
};

function decodeScannerTransportMessage(data: string): ScannerTransportMessage | null {
  try {
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== "object") return null;

    if (parsed.kind === "photo") {
      if (
        typeof parsed.id !== "string" ||
        typeof parsed.name !== "string" ||
        typeof parsed.mimeType !== "string" ||
        typeof parsed.dataUrl !== "string" ||
        typeof parsed.size !== "number"
      ) {
        return null;
      }

      return {
        kind: "photo",
        id: parsed.id,
        name: parsed.name,
        mimeType: parsed.mimeType,
        dataUrl: parsed.dataUrl,
        size: parsed.size,
        width: typeof parsed.width === "number" ? parsed.width : undefined,
        height: typeof parsed.height === "number" ? parsed.height : undefined,
        capturedAt: typeof parsed.capturedAt === "string" ? parsed.capturedAt : undefined,
      };
    }

    if (parsed.kind === "photo-chunk-start") {
      if (
        typeof parsed.id !== "string" ||
        typeof parsed.name !== "string" ||
        typeof parsed.mimeType !== "string" ||
        typeof parsed.size !== "number" ||
        typeof parsed.totalChunks !== "number"
      ) {
        return null;
      }

      return {
        kind: "photo-chunk-start",
        id: parsed.id,
        name: parsed.name,
        mimeType: parsed.mimeType,
        size: parsed.size,
        width: typeof parsed.width === "number" ? parsed.width : undefined,
        height: typeof parsed.height === "number" ? parsed.height : undefined,
        capturedAt: typeof parsed.capturedAt === "string" ? parsed.capturedAt : undefined,
        totalChunks: parsed.totalChunks,
      };
    }

    if (parsed.kind === "photo-chunk") {
      if (
        typeof parsed.id !== "string" ||
        typeof parsed.index !== "number" ||
        typeof parsed.data !== "string"
      ) {
        return null;
      }

      return {
        kind: "photo-chunk",
        id: parsed.id,
        index: parsed.index,
        data: parsed.data,
      };
    }

    if (parsed.kind === "photo-chunk-end") {
      return typeof parsed.id === "string" ? { kind: "photo-chunk-end", id: parsed.id } : null;
    }

    if (typeof parsed.barcode !== "string" || !parsed.barcode) {
      return null;
    }

    return {
      barcode: parsed.barcode,
      dictationPhase: parsed.dictationPhase === "partial" || parsed.dictationPhase === "final" ? parsed.dictationPhase : undefined,
      dictationSessionId: typeof parsed.dictationSessionId === "string" ? parsed.dictationSessionId : undefined,
      format: typeof parsed.format === "string" ? parsed.format : undefined,
      insertIntoCursor: typeof parsed.insertIntoCursor === "boolean" ? parsed.insertIntoCursor : undefined,
      kind: parsed.kind === "text" ? "text" : "barcode",
      scannedAt: typeof parsed.scannedAt === "string" ? parsed.scannedAt : undefined,
    };
  } catch (_e) {
    return null;
  }
}

class MobileScannerOffscreenSession {
  private resultPoll: number | null = null;
  private resultPollTimeout: number | null = null;
  private sessionId: string | null = null;
  private recentMessages = new Map<string, number>();
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

  async start(force = false, _mode: MobileCaptureMode | null = null, target?: SessionTarget | null) {
    await this.restorePromise;
    if (
      !force &&
      (this.state.status === "creating" ||
        this.state.status === "waiting" ||
        this.state.status === "connected")
    ) {
      return { ...this.state };
    }

    await this.clearPersistedSession();
    this.cleanup(true);
    this.setState({ status: "creating", error: null, qrCodeUrl: null, mode: null });

    try {
      const sessionId = await this.createRelaySession(null, target);
      this.sessionId = sessionId;
      this.setState({
        status: "waiting",
        qrCodeUrl: this.buildPairingUrl(sessionId),
        error: null,
        mode: null,
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
      this.seenRelayResultIds = new Set(
        Array.isArray(persisted.seenResultIds) ? persisted.seenResultIds.filter((id) => typeof id === "string") : [],
      );
      this.state = {
        status: persisted.connectedAt || persisted.status === "connected" ? "connected" : "waiting",
        qrCodeUrl: persisted.qrCodeUrl || this.buildPairingUrl(persisted.sessionId),
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
      qrCodeUrl: this.state.qrCodeUrl || this.buildPairingUrl(this.sessionId),
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

  private buildPairingUrl(sessionId: string) {
    const encodedSession = encodeURIComponent(sessionId);
    return `${SCANNER_APP_CLIP_BASE_URL}?session=${encodedSession}`;
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

    if (data.format !== "dictation" && this.isDuplicateMessage(data)) return false;
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

  private isDuplicateMessage(message: BarcodeMessage) {
    const now = Date.now();
    const key = [
      message.kind || "barcode",
      message.format || "",
      message.barcode.trim().toLowerCase(),
    ].join(":");
    const lastSeenAt = this.recentMessages.get(key);

    for (const [recentKey, seenAt] of this.recentMessages) {
      if (now - seenAt > 2500) {
        this.recentMessages.delete(recentKey);
      }
    }

    if (lastSeenAt && now - lastSeenAt < 1500) {
      return true;
    }

    this.recentMessages.set(key, now);
    return false;
  }

  private async createRelaySession(mode: MobileCaptureMode | null, target?: SessionTarget | null) {
    const sessionResponse = await fetch(SCANNER_SIGNAL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mode ? { relay: true, mode, target } : { relay: true, target }),
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

    const { sessionId } = await sessionResponse.json();
    if (typeof sessionId !== "string" || !sessionId) {
      throw new Error("Invalid App Clip session");
    }
    return sessionId;
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
        if (!resultResponse.ok) return;

        const payload = (await resultResponse.json()) as {
          result?: ScannerRelayResult | null;
          results?: ScannerRelayResult[];
        };
        const results = Array.isArray(payload.results) ? payload.results : payload.result ? [payload.result] : [];
        const unseenResults = results.filter((result) => result?.id && !this.seenRelayResultIds.has(result.id));
        if (unseenResults.length === 0) return;

        let inferredMode: MobileCaptureMode | null = null;
        const photoAckIds: string[] = [];
        for (const result of unseenResults) {
          this.seenRelayResultIds.add(result.id);
          if (
            result.mode &&
            (result.mode === "ocr" ||
              result.mode === "barcode" ||
              result.mode === "dictation" ||
              result.mode === "photo")
          ) {
            inferredMode = result.mode;
          }
          if (result.message) {
            const stored = await this.handleDataChannelMessage(JSON.stringify(result.message));
            if (stored && result.mode === "photo") photoAckIds.push(result.id);
          }
        }
        await this.acknowledgeRelayResults(sessionId, photoAckIds);
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
