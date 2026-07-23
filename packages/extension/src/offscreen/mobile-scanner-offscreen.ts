import type {
  CaptureMode,
  ScannerConnectionStatus,
} from "@volt/scanner-protocol";
import { buildScannerAppClipJoinUrl } from "@volt/scanner-protocol";
import { createClerkClient } from "@clerk/chrome-extension/client";
import { ConvexClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import {
  CLERK_PUBLISHABLE_KEY,
  CLERK_SYNC_HOST,
  convexDeploymentUrlFromHttpActionsUrl,
} from "../access/config";
import {
  MobileScannerSession,
  type BarcodeMessage,
  type ExtensionIdentity,
  type MobileScannerSessionState,
  type PhotoMessage,
  type SessionTarget,
} from "../domain/mobile-scanner-session";
import { getMobileScannerExtensionIdentity } from "../domain/mobile-scanner-identity";
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

function objectFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

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

async function getClerkToken() {
  if (!CLERK_PUBLISHABLE_KEY) return null;
  const clerk = await createClerkClient({
    publishableKey: CLERK_PUBLISHABLE_KEY,
    syncHost: CLERK_SYNC_HOST,
    background: true,
  });
  if (!clerk.session) return null;
  return clerk.session.getToken({
    template: "convex",
    organizationId: clerk.organization?.id,
    skipCache: true,
  });
}

function clerkSubjectFromToken(token: string | null) {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
    const record = objectFrom(decoded);
    return typeof record?.sub === "string" && record.sub ? record.sub : null;
  } catch {
    return null;
  }
}

class CloudWorkspaceSubscriptions {
  private readonly client = new ConvexClient(
    convexDeploymentUrlFromHttpActionsUrl(EXTENSION_SCANNER_SIGNAL_URL),
  );
  private workspaceSnapshotUnsubscribe: (() => void) | null = null;
  private cursorDeliveriesUnsubscribe: (() => void) | null = null;
  private installationId: string | null = null;
  private clerkSubject: string | null = null;
  private hasReconciledSubject = false;
  private lastSnapshot: unknown = null;
  private started = false;
  private reconciling: Promise<void> | null = null;

  constructor() {
    this.client.setAuth(getClerkToken, () => {
      void this.reconcileAuthentication();
    });
  }

  start() {
    if (this.started) return;
    this.started = true;
    void this.reconcileAuthentication();
    window.setInterval(() => {
      void this.reconcileAuthentication();
    }, 15_000);
  }

  private stopSubscriptions() {
    this.workspaceSnapshotUnsubscribe?.();
    this.cursorDeliveriesUnsubscribe?.();
    this.workspaceSnapshotUnsubscribe = null;
    this.cursorDeliveriesUnsubscribe = null;
  }

  private async reconcileAuthenticationNow() {
    const token = await getClerkToken();
    const subject = clerkSubjectFromToken(token);
    const subscriptionsActive =
      this.workspaceSnapshotUnsubscribe !== null
      && this.cursorDeliveriesUnsubscribe !== null;
    if (
      this.hasReconciledSubject
      && subject === this.clerkSubject
      && (subject === null || subscriptionsActive)
    ) return;

    this.stopSubscriptions();
    const accountResponse = await chrome.runtime.sendMessage({
      action: "workspaceOffscreenAccountChanged",
      subject,
    });
    const accountRecord = objectFrom(accountResponse);
    if (accountRecord?.success !== true) return;

    this.clerkSubject = subject;
    this.hasReconciledSubject = true;
    this.lastSnapshot = null;
    if (!subject) return;

    const identity = await getMobileScannerExtensionIdentity();
    this.installationId = identity.installId;
    this.workspaceSnapshotUnsubscribe = this.client.onUpdate(
      api.cloudWorkspace.workspaceSnapshot,
      {},
      (snapshot) => {
        this.lastSnapshot = snapshot;
        void chrome.runtime.sendMessage({
          action: "workspaceOffscreenSnapshotChanged",
          snapshot,
        }).catch(() => undefined);
      },
      (error) => console.warn("[Volt Cloud Workspace] snapshot subscription failed", error),
    );
    this.cursorDeliveriesUnsubscribe = this.client.onUpdate(
      api.cloudWorkspace.pendingCursorDeliveries,
      { installationId: identity.installId },
      (deliveries) => {
        void chrome.runtime.sendMessage({
          action: "workspaceOffscreenCursorDeliveriesChanged",
          deliveries,
        }).catch(() => undefined);
      },
      (error) => console.warn("[Volt Cloud Workspace] cursor subscription failed", error),
    );
  }

  reconcileAuthentication() {
    if (!this.reconciling) {
      this.reconciling = this.reconcileAuthenticationNow().finally(() => {
        this.reconciling = null;
      });
    }
    return this.reconciling;
  }

  async reconcileSnapshot() {
    await this.reconcileAuthentication();
    if (!this.clerkSubject) return null;
    try {
      const snapshot = await this.client.query(api.cloudWorkspace.workspaceSnapshot, {});
      this.lastSnapshot = snapshot;
      return snapshot;
    } catch (error) {
      if (this.lastSnapshot !== null) return this.lastSnapshot;
      throw error;
    }
  }

  async acknowledgeCursorDelivery(
    deliveryId: string,
    state: "delivered" | "failed",
    errorCode?: string,
  ) {
    await this.reconcileAuthentication();
    if (!this.installationId) throw new Error("Cloud workspace is not signed in.");
    return this.client.mutation(api.cloudWorkspace.acknowledgeCursorDelivery, {
      installationId: this.installationId,
      deliveryId,
      state,
      ...(errorCode ? { errorCode } : {}),
    });
  }
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    message.action === "workspaceOffscreenStartSubscriptions"
    || message.action === "workspaceOffscreenReconcile"
    || message.action === "workspaceOffscreenAcknowledgeCursorDelivery"
  ) {
    if (sender.id !== chrome.runtime.id || sender.tab) {
      sendResponse({ success: false, error: "unauthorized_extension_sender" });
      return false;
    }
    if (message.action === "workspaceOffscreenStartSubscriptions") {
      cloudWorkspaceSubscriptions.start();
      void cloudWorkspaceSubscriptions.reconcileAuthentication()
        .then(() => sendResponse({ success: true }))
        .catch((error: unknown) => sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      return true;
    }
    if (message.action === "workspaceOffscreenReconcile") {
      void cloudWorkspaceSubscriptions.reconcileSnapshot()
        .then((snapshot) => sendResponse({ success: true, snapshot }))
        .catch((error: unknown) => sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      return true;
    }
    const deliveryId = typeof message.deliveryId === "string" ? message.deliveryId : "";
    const state = message.state === "delivered" || message.state === "failed"
      ? message.state
      : null;
    if (!deliveryId || !state) {
      sendResponse({ success: false, error: "invalid_cursor_delivery_ack" });
      return false;
    }
    void cloudWorkspaceSubscriptions.acknowledgeCursorDelivery(
      deliveryId,
      state,
      typeof message.errorCode === "string" ? message.errorCode : undefined,
    ).then((value) => sendResponse({ success: true, value }))
      .catch((error: unknown) => sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    return true;
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
