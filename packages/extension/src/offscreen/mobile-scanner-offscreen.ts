import type { CaptureMode, ScannerConnectionStatus } from "@volt/scanner-protocol";
import { buildScannerAppClipJoinUrl } from "@volt/scanner-protocol";
import {
  MobileScannerSession,
  type BarcodeMessage,
  type ExtensionIdentity,
  type MobileScannerSessionState,
  type PhotoMessage,
  type SessionTarget,
} from "../domain/mobile-scanner-session";
import { CloudWorkspaceSubscriptions, getClerkToken, objectFrom } from "./cloud-workspace-subscriptions";
import { EXTENSION_SCANNER_SIGNAL_URL } from "../domain/mobile-scanner-signal-url";

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
  usageSessionId?: string;
  target?: SessionTarget | null;
  extensionIdentity?: ExtensionIdentity | null;
};

function accessErrorMessage(response: unknown) {
  const record = objectFrom(response);
  const status = objectFrom(record?.accessStatus);
  if (status?.requiresSignIn === true) {
    return "Your five free sessions are used. Sign in to continue.";
  }
  if (status?.requiresSubscription === true) {
    return "A Volt Pro subscription is required. Subscribe in the full iPhone app.";
  }
  return typeof record?.error === "string"
    ? record.error
    : "Scanner access could not be verified.";
}

function normalizeCaptureMode(value: unknown): CaptureMode | null {
  return value === "ocr" || value === "barcode" || value === "dictation" || value === "photo"
    ? value
    : null;
}

function normalizeTarget(value: unknown): SessionTarget | null {
  return value && typeof value === "object" ? (value as SessionTarget) : null;
}

function isJoinWindowActive(state: MobileScannerSessionState) {
  if (!state.qrCodeUrl) return false;
  if (!state.joinWindowExpiresAt) return true;
  const expiresAt = Date.parse(state.joinWindowExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
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
      createJoinWindow: async (input) => {
        const response = await chrome.runtime.sendMessage({
          action: "accessCreateJoinWindow",
          ...input,
        });
        const responseRecord = objectFrom(response);
        const value = objectFrom(responseRecord?.value);
        if (responseRecord?.success !== true || !value) {
          throw new Error(accessErrorMessage(response));
        }
        const joinToken =
          typeof value.token === "string"
            ? value.token
            : typeof value.joinToken === "string"
              ? value.joinToken
              : "";
        const sessionId =
          typeof value.sessionId === "string" ? value.sessionId : input.sessionId;
        const usageSessionId =
          typeof value.usageSessionId === "string" ? value.usageSessionId : "";
        if (!joinToken || !usageSessionId) {
          throw new Error("Scanner access response omitted session credentials.");
        }
        const qrCodeUrl =
          typeof value.qrCodeUrl === "string"
            ? value.qrCodeUrl
            : buildScannerAppClipJoinUrl({
                token: joinToken,
                sessionId,
                label: input.deviceLabel,
                signalUrl: EXTENSION_SCANNER_SIGNAL_URL,
              });
        return {
          joinToken,
          qrCodeUrl,
          sessionId,
          usageSessionId,
          expiresAt:
            typeof value.expiresAt === "string" ? value.expiresAt : undefined,
        };
      },
      onSessionReady: async ({ joinToken, usageSessionId }) => {
        const response = await chrome.runtime.sendMessage({
          action: "accessSessionReady",
          joinToken,
          usageSessionId,
        });
        const record = objectFrom(response);
        return record?.success === true
          ? { allowed: true }
          : { allowed: false, error: accessErrorMessage(response) };
      },
      onSessionDisconnected: async (usageSessionId) => {
        await chrome.runtime
          .sendMessage({
            action: "accessSessionDisconnected",
            usageSessionId,
          })
          .catch(() => undefined);
      },
      onSessionEnded: async (usageSessionId) => {
        await chrome.runtime
          .sendMessage({ action: "accessSessionEnded", usageSessionId })
          .catch(() => undefined);
      },
      log: (...args) => {
        console.debug(...args);
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
      usageSessionId: state.usageSessionId,
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
      if (isJoinWindowActive(webRtcState)) {
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

// Answering the readiness ping is what keeps the service worker from closing
// this document, so claim it before opening sockets or scheduling any work.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== "scannerOffscreenPing") return false;
  sendResponse({ ready: true });
  return false;
});

const mobileScannerSession = new MobileScannerOffscreenSession();
const cloudWorkspaceSubscriptions = new CloudWorkspaceSubscriptions();
cloudWorkspaceSubscriptions.start();

function sendScannerError(sendResponse: (response?: unknown) => void, err: unknown) {
  sendResponse({
    status: "error",
    qrCodeUrl: null,
    error: err instanceof Error ? err.message : String(err),
    mode: null,
  });
}

function sendWorkspaceOperation(
  sendResponse: (response?: unknown) => void,
  operation: Promise<unknown>,
) {
  void operation
    .then((value) => sendResponse({ success: true, value }))
    .catch((error: unknown) => sendResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }));
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    message.action === "workspaceOffscreenStartSubscriptions"
    || message.action === "workspaceOffscreenReconcile"
    || message.action === "workspaceOffscreenCreateEnrollment"
    || message.action === "workspaceOffscreenCreatePhotoDownloadUrl"
    || message.action === "workspaceOffscreenDeleteResults"
    || message.action === "workspaceOffscreenRestoreResults"
    || message.action === "workspaceOffscreenAcknowledgeCursorDelivery"
    || message.action === "extensionSettingsOffscreenGet"
    || message.action === "extensionSettingsOffscreenSave"
    || message.action === "shopifyAuditOffscreenStatus"
    || message.action === "shopifyAuditOffscreenConnect"
    || message.action === "shopifyAuditOffscreenDisconnect"
    || message.action === "shopifyAuditOffscreenListYesterday"
    || message.action === "shopifyAuditOffscreenSearchProducts"
  ) {
    if (sender.id !== chrome.runtime.id || sender.tab) {
      sendResponse({ success: false, error: "unauthorized_extension_sender" });
      return false;
    }
    if (message.action === "workspaceOffscreenStartSubscriptions") {
      if (typeof message.accountEpoch !== "string" || !message.accountEpoch) {
        sendResponse({ success: false, error: "missing_workspace_account_epoch" });
        return false;
      }
      cloudWorkspaceSubscriptions.start();
      return sendWorkspaceOperation(
        sendResponse,
        cloudWorkspaceSubscriptions.accountChanged(message.accountEpoch, message.accountChanged === true),
      );
    }
    if (message.action === "extensionSettingsOffscreenGet") {
      return sendWorkspaceOperation(
        sendResponse,
        cloudWorkspaceSubscriptions.getExtensionSettings(),
      );
    }
    if (message.action === "extensionSettingsOffscreenSave") {
      if (typeof message.payload !== "string" || typeof message.expectedSubject !== "string"
        || (message.expectedRevision !== null
          && (typeof message.expectedRevision !== "number" || !Number.isInteger(message.expectedRevision)))) {
        sendResponse({ success: false, error: "invalid_extension_settings_payload" });
        return false;
      }
      return sendWorkspaceOperation(
        sendResponse,
        cloudWorkspaceSubscriptions.saveExtensionSettings(
          message.payload,
          message.expectedRevision,
          message.expectedSubject,
        ),
      );
    }
    if (message.action === "shopifyAuditOffscreenStatus") {
      return sendWorkspaceOperation(sendResponse, cloudWorkspaceSubscriptions.getShopifyConnection());
    }
    if (message.action === "shopifyAuditOffscreenConnect") {
      if (typeof message.shop !== "string") {
        sendResponse({ success: false, error: "invalid_shopify_shop" });
        return false;
      }
      return sendWorkspaceOperation(sendResponse, cloudWorkspaceSubscriptions.startShopifyConnection(message.shop));
    }
    if (message.action === "shopifyAuditOffscreenDisconnect") {
      return sendWorkspaceOperation(sendResponse, cloudWorkspaceSubscriptions.disconnectShopify());
    }
    if (message.action === "shopifyAuditOffscreenListYesterday") {
      if (typeof message.startUtc !== "string" || typeof message.endUtc !== "string" || typeof message.date !== "string") {
        sendResponse({ success: false, error: "invalid_shopify_audit_date" });
        return false;
      }
      return sendWorkspaceOperation(sendResponse, cloudWorkspaceSubscriptions.listShopifyYesterday(message.startUtc, message.endUtc, message.date));
    }
    if (message.action === "shopifyAuditOffscreenSearchProducts") {
      if (typeof message.query !== "string") {
        sendResponse({ success: false, error: "invalid_shopify_search_query" });
        return false;
      }
      return sendWorkspaceOperation(sendResponse, cloudWorkspaceSubscriptions.searchShopifyProducts(message.query));
    }
    if (message.action === "workspaceOffscreenReconcile") {
      void cloudWorkspaceSubscriptions.reconcileSnapshot()
        .then((envelope) => sendResponse({ success: true, ...envelope }))
        .catch((error: unknown) => sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      return true;
    }
    if (message.action === "workspaceOffscreenCreateEnrollment") {
      const label = typeof message.label === "string" ? message.label.trim().slice(0, 80) : "";
      if (!label) {
        sendResponse({ success: false, error: "invalid_enrollment_label" });
        return false;
      }
      return sendWorkspaceOperation(
        sendResponse,
        cloudWorkspaceSubscriptions.createEnrollment(label),
      );
    }
    if (message.action === "workspaceOffscreenCreatePhotoDownloadUrl") {
      const batchId = typeof message.batchId === "string" ? message.batchId : "";
      const resultId = typeof message.resultId === "string" ? message.resultId : "";
      if (!batchId || !resultId) {
        sendResponse({ success: false, error: "invalid_photo_download_request" });
        return false;
      }
      return sendWorkspaceOperation(
        sendResponse,
        cloudWorkspaceSubscriptions.createPhotoDownloadUrl(batchId, resultId),
      );
    }
    if (
      message.action === "workspaceOffscreenDeleteResults"
      || message.action === "workspaceOffscreenRestoreResults"
    ) {
      const resultIds = Array.isArray(message.resultIds)
        ? message.resultIds
          .filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
          .slice(0, 100)
        : [];
      if (resultIds.length === 0) {
        sendResponse({ success: false, error: "invalid_workspace_result_ids" });
        return false;
      }
      return sendWorkspaceOperation(
        sendResponse,
        message.action === "workspaceOffscreenDeleteResults"
          ? cloudWorkspaceSubscriptions.deleteWorkspaceResults(resultIds)
          : cloudWorkspaceSubscriptions.restoreWorkspaceResults(resultIds),
      );
    }
    const deliveryId = typeof message.deliveryId === "string" ? message.deliveryId : "";
    const state = message.state === "delivered" || message.state === "failed"
      ? message.state
      : null;
    if (!deliveryId || !state) {
      sendResponse({ success: false, error: "invalid_cursor_delivery_ack" });
      return false;
    }
    return sendWorkspaceOperation(
      sendResponse,
      cloudWorkspaceSubscriptions.acknowledgeCursorDelivery(
        deliveryId,
        state,
        typeof message.errorCode === "string" ? message.errorCode : undefined,
      ),
    );
  }

  if (message.action === "accessOffscreenGetClerkToken") {
    if (sender.id !== chrome.runtime.id || sender.tab) {
      sendResponse({ success: false, error: "unauthorized_extension_sender" });
      return false;
    }
    getClerkToken()
      .then((token) => sendResponse({ success: true, token }))
      .catch((error: unknown) =>
        sendResponse({
          success: false,
          token: null,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
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
    console.debug("[Volt Scanner Reconnect] offscreen poll requested", {
      reason: message.reason,
    });
    mobileScannerSession
      .pollReconnectRequestsNow()
      .then((state) => {
        console.debug("[Volt Scanner Reconnect] offscreen poll completed", {
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
