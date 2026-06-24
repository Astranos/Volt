import type {
  CaptureMode,
  ScannerConnectionStatus,
} from "@volt/scanner-protocol";
import {
  MobileScannerSession,
  type BarcodeMessage,
  type ExtensionIdentity,
  type MobileScannerSessionState,
  type PhotoMessage,
  type SessionTarget,
} from "../domain/mobile-scanner-session";

function serializeLogArg(arg: unknown) {
  if (arg instanceof Error) {
    return { name: arg.name, message: arg.message, stack: arg.stack };
  }
  return arg;
}

type ScannerState = {
  status: ScannerConnectionStatus;
  qrCodeUrl: string | null;
  error: string | null;
  mode: CaptureMode | null;
  connectedAt: string | null;
  connectedPeerCount?: number;
  joinWindowExpiresAt?: string | null;
  sessionId?: string;
  target?: SessionTarget | null;
  extensionIdentity?: ExtensionIdentity | null;
};

function normalizeCaptureMode(value: unknown): CaptureMode | null {
  return value === "ocr" || value === "barcode" || value === "dictation" || value === "photo"
    ? value
    : null;
}

function normalizeTarget(value: unknown): SessionTarget | null {
  return value && typeof value === "object" ? (value as SessionTarget) : null;
}

class MobileScannerOffscreenSession {
  private webRtcSession: MobileScannerSession;
  private state: ScannerState = {
    status: "disconnected",
    qrCodeUrl: null,
    error: null,
    mode: null,
    connectedAt: null,
  };

  constructor() {
    this.webRtcSession = new MobileScannerSession({
      onState: (state) => this.handleWebRtcState(state),
      onScan: (scan) => this.sendScan(scan),
      onPhoto: (photo) => this.sendPhoto(photo),
      log: (...args) => {
        console.warn(...args);
        void chrome.runtime.sendMessage({
          action: "scannerDebugLog",
          source: "scanner-offscreen",
          args: args.map(serializeLogArg),
        }).catch(() => {});
      },
    });
  }

  async getState() {
    return { ...this.state };
  }

  private handleWebRtcState(state: MobileScannerSessionState) {
    this.setState({
      status: state.status,
      qrCodeUrl: state.qrCodeUrl,
      error: state.error,
      connectedAt: state.connectedAt,
      connectedPeerCount: state.connectedPeerCount,
      joinWindowExpiresAt: state.joinWindowExpiresAt,
      sessionId: state.sessionId,
      target: state.target,
      extensionIdentity: state.extensionIdentity,
    });
  }

  private setState(patch: Partial<ScannerState>) {
    this.state = { ...this.state, ...patch };
    void chrome.runtime.sendMessage({
      action: "scannerStateChanged",
      source: "scanner-offscreen",
      state: { ...this.state },
    });
  }

  async start(force = false, mode: CaptureMode | null = null, target?: SessionTarget | null) {
    if (!force) {
      const webRtcState = this.webRtcSession.getState();
      if (webRtcState.qrCodeUrl) {
        this.handleWebRtcState(webRtcState);
        this.setState({ mode });
        return { ...this.state };
      }
    }
    const state = await this.webRtcSession.openJoinWindow(target);
    this.handleWebRtcState(state);
    this.setState({ mode });
    return { ...this.state };
  }

  async closeJoinWindow() {
    const state = await this.webRtcSession.closeJoinWindow();
    this.handleWebRtcState(state);
    return { ...this.state };
  }

  async disconnect() {
    const state = await this.webRtcSession.disconnect();
    this.handleWebRtcState(state);
    this.setState({ mode: null });
    return { ...this.state };
  }

  async updateTarget(target?: SessionTarget | null) {
    await this.webRtcSession.updateTarget(target);
    return this.getState();
  }

  async updateExtensionIdentity(identity?: ExtensionIdentity | null) {
    const state = await this.webRtcSession.updateExtensionIdentity(identity);
    this.handleWebRtcState(state);
    return this.getState();
  }

  async pollReconnectRequestsNow() {
    const state = await this.webRtcSession.pollReconnectRequestsNow();
    this.handleWebRtcState(state);
    return this.getState();
  }

  private async sendScan(data: BarcodeMessage) {
    const response = await chrome.runtime.sendMessage({
      action: "scannerOffscreenScan",
      scan: {
        ...data,
        id: data.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        scannedAt: data.scannedAt || new Date().toISOString(),
      },
    });
    return {
      saved: response?.success !== false,
      insertedIntoCursor: response?.insertedIntoCursor === true,
    };
  }

  private async sendPhoto(photo: PhotoMessage) {
    return chrome.runtime.sendMessage({
      action: "scannerOffscreenPhoto",
      photo: {
        ...photo,
        capturedAt: photo.capturedAt || new Date().toISOString(),
        sessionId: this.state.sessionId,
      },
    });
  }
}

const mobileScannerSession = new MobileScannerOffscreenSession();

function sendScannerError(sendResponse: (response?: unknown) => void, err: unknown) {
  sendResponse({
    status: "error",
    qrCodeUrl: null,
    error: err instanceof Error ? err.message : String(err),
    mode: null,
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "scannerOffscreenPing") {
    sendResponse({ ready: true });
    return false;
  }

  if (message.action === "scannerOffscreenStart") {
    mobileScannerSession
      .start(message.force === true, normalizeCaptureMode(message.mode), normalizeTarget(message.target))
      .then((state) => sendResponse(state))
      .catch((err) => sendScannerError(sendResponse, err));
    return true;
  }

  if (message.action === "scannerOffscreenCloseJoinWindow") {
    mobileScannerSession
      .closeJoinWindow()
      .then((state) => sendResponse(state))
      .catch((err) => sendScannerError(sendResponse, err));
    return true;
  }

  if (message.action === "scannerOffscreenDisconnect") {
    mobileScannerSession
      .disconnect()
      .then((state) => sendResponse(state))
      .catch((err) => sendScannerError(sendResponse, err));
    return true;
  }

  if (message.action === "scannerOffscreenUpdateTarget") {
    mobileScannerSession
      .updateTarget(normalizeTarget(message.target))
      .then((state) => sendResponse(state))
      .catch((err) => sendScannerError(sendResponse, err));
    return true;
  }

  if (message.action === "scannerOffscreenUpdateExtensionIdentity") {
    mobileScannerSession
      .updateExtensionIdentity(
        message.identity && typeof message.identity === "object"
          ? (message.identity as ExtensionIdentity)
          : null,
      )
      .then((state) => sendResponse(state))
      .catch((err) => sendScannerError(sendResponse, err));
    return true;
  }

  if (message.action === "scannerOffscreenPollReconnectRequests") {
    console.warn("[Volt Scanner Reconnect] offscreen poll requested", {
      reason: message.reason,
    });
    mobileScannerSession
      .pollReconnectRequestsNow()
      .then((state) => {
        console.warn("[Volt Scanner Reconnect] offscreen poll completed", {
          reason: message.reason,
          status: state.status,
          sessionId: state.sessionId,
          connectedPeerCount: state.connectedPeerCount,
        });
        sendResponse(state);
      })
      .catch((err) => sendScannerError(sendResponse, err));
    return true;
  }

  if (message.action === "scannerOffscreenGetState") {
    mobileScannerSession
      .getState()
      .then((state) => sendResponse(state))
      .catch((err) => sendScannerError(sendResponse, err));
    return true;
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
